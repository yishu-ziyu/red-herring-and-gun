/**
 * attentionGuidance.ts - Change A/B/C/D
 *
 * A: conclusion -> ClaimSpan sequence (highlighter types)
 * B: attach outward source chips on assert/hedge spans
 * C: Attention Rail top-3 (what to look at first)
 * D: canSay / cannotSay boundary spans; blocked never masquerades as assert
 *
 * Product taste: no pseudo-human "可说/不可说" badges. Chips point to sources.
 * v1 is deterministic heuristics (no LLM).
 */

import type {
  AttentionGuidedText,
  AttentionPriority,
  AttentionTarget,
  BoundarySpan,
  ClaimSpan,
  FinalReport,
  LicenseSignal,
  SourceRef,
  SpanEvidenceRole,
  SpanType,
} from "./schemas";
import type { CandidateMaterial } from "./schemas";

export interface BuildAttentionGuidanceInput {
  conclusion: string;
  canSay?: string[];
  cannotSay?: string[];
  doNotInfer?: string[];
  nextEvidenceNeeded?: string[];
  /** Optional: already-aggregated license texts */
  licenseAllowed?: string[];
  licenseBlocked?: string[];
  /** Evidence materials for Change B source chips */
  candidates?: CandidateMaterial[];
  /** Max source chips per span (default 2) */
  maxSourcesPerSpan?: number;
  /** Max rail items (default 3) */
  maxRailItems?: number;
}

const GAP_MARKERS =
  /无法|未能|缺少|缺失|不足|不明|未提供|没有.*证据|证据不足|尚无|仍需|待核实|不可追溯|来源不明|不足以确认|不足以证明/;
// Hard boundary language only - do not treat "不足以确认" as blocked (that is a gap)
const BLOCKED_MARKERS =
  /不能(说|推出|从|把|将)|不可(说|推出)|禁止推断|不得|不能使用/;
const HEDGE_MARKERS =
  /可能|或许|似乎|倾向于|目前|现有材料|有限证据|尚不能|不一定|有待/;
const HARD_ASSERT_MARKERS =
  /已经|确定|证明|导致|必定|一定|就是|事实是|官方确认|已落地/;
const CLAUSE_SPLIT = /(?<=[。！？；;!?])\s*|(?<=，)(?=但|然而|因此|所以|不过|可是)/;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function includesLoose(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n || n.length < 4) return false;
  if (h.includes(n) || n.includes(h)) return true;
  // share a long contiguous fragment (>= 8 chars)
  const minLen = Math.min(12, Math.floor(n.length * 0.6));
  if (minLen < 6) return false;
  for (let i = 0; i <= n.length - minLen; i += 1) {
    const frag = n.slice(i, i + minLen);
    if (h.includes(frag)) return true;
  }
  return false;
}

/** Split into sentence-like units; keep trailing punctuation on the unit. */
export function splitIntoUnits(text: string): string[] {
  const raw = normalize(text);
  if (!raw) return [];

  // Split on sentence ends; also split "…，但…" style compounds for cleaner span types
  const parts = raw
    .split(CLAUSE_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return [raw];

  // Merge very short trailing glue into previous unit
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && part.length < 4) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function matchesAnyList(text: string, list: string[] | undefined): boolean {
  if (!list?.length) return false;
  return list.some((item) => includesLoose(text, item) || includesLoose(item, text));
}

export function classifyConclusionUnit(
  text: string,
  ctx: {
    cannotSay: string[];
    doNotInfer: string[];
    licenseBlocked: string[];
    nextEvidenceNeeded: string[];
  },
): { spanType: SpanType; license: LicenseSignal; attention: AttentionPriority; reason: string } {
  const t = normalize(text);

  // Hard rule: anything aligned with cannot-say / blocked license is blocked, never assert
  if (
    matchesAnyList(t, ctx.cannotSay) ||
    matchesAnyList(t, ctx.doNotInfer) ||
    matchesAnyList(t, ctx.licenseBlocked) ||
    BLOCKED_MARKERS.test(t)
  ) {
    return {
      spanType: "blocked",
      license: "blocked",
      attention: "p0",
      reason: "与 cannot-say / 禁止推断 对齐，不得写成可断言",
    };
  }

  if (GAP_MARKERS.test(t) || matchesAnyList(t, ctx.nextEvidenceNeeded)) {
    return {
      spanType: "gap",
      license: "insufficient",
      attention: "p2",
      reason: "标记证据缺口或仍需补充的材料",
    };
  }

  if (HEDGE_MARKERS.test(t) && !HARD_ASSERT_MARKERS.test(t)) {
    return {
      spanType: "hedge",
      license: "allowed",
      attention: "p3",
      reason: "谨慎表述，弱于硬断言",
    };
  }

  // Uncited hard assert without support language -> force gap (no bare assert certainty)
  if (HARD_ASSERT_MARKERS.test(t) && /导致|已经减少|已确认|证明/.test(t)) {
    // Still allow as assert if it is a denial / official response style
    if (/否认|未发布|不实|谣言|没有证据表明/.test(t)) {
      return {
        spanType: "assert",
        license: "allowed",
        attention: "p0",
        reason: "可核查的否定/官方回应类断言",
      };
    }
  }

  if (t.length <= 2 || /^[，、；：:\-—]+$/.test(t)) {
    return {
      spanType: "context",
      license: "not_checked",
      attention: "p4",
      reason: "连接性文本",
    };
  }

  return {
    spanType: "assert",
    license: "not_checked",
    attention: "p3",
    reason: "可核查断言（Change A 句级类型；Change B 来源芯片后补）",
  };
}

/**
 * Change D hard rule: cannot-say list items are always blocked.
 * can-say list items are assert (or gap if they look like missing-evidence notes).
 */
export function buildBoundarySpans(
  canSay: string[] | undefined,
  cannotSay: string[] | undefined,
): { canSaySpans: BoundarySpan[]; cannotSaySpans: BoundarySpan[] } {
  const canSaySpans: BoundarySpan[] = (canSay ?? [])
    .map((text, i) => normalize(text))
    .filter(Boolean)
    .map((text, i) => {
      const isGap = GAP_MARKERS.test(text);
      // Never emit blocked for can-say column
      const spanType: BoundarySpan["spanType"] = isGap ? "gap" : "assert";
      return {
        id: `can-${i + 1}`,
        text,
        spanType,
        license: isGap ? "insufficient" : "allowed",
        attention: isGap ? "p2" : "p3",
        attentionReason: isGap ? "可以说的边界内仍点名缺口" : "许可范围内可说",
      };
    });

  const cannotSaySpans: BoundarySpan[] = (cannotSay ?? [])
    .map((text) => normalize(text))
    .filter(Boolean)
    .map((text, i) => {
      // HARD RULE: always blocked. Never assert.
      return {
        id: `cannot-${i + 1}`,
        text,
        spanType: "blocked" as const,
        license: "blocked" as const,
        attention: "p0" as const,
        attentionReason: "cannot-say 强制 blocked，禁止伪装成 assert",
      };
    });

  // Safety pass: if any can-say text equals a cannot-say text, drop from can-say
  // (blocked wins; never masquerade)
  const blockedKeys = new Set(cannotSaySpans.map((s) => normalize(s.text)));
  const filteredCan = canSaySpans.filter((s) => !blockedKeys.has(normalize(s.text)));

  return { canSaySpans: filteredCan, cannotSaySpans };
}

export function buildConclusionSpans(
  conclusion: string,
  ctx: {
    cannotSay: string[];
    doNotInfer: string[];
    licenseBlocked: string[];
    nextEvidenceNeeded: string[];
  },
): ClaimSpan[] {
  const units = splitIntoUnits(conclusion);
  return units.map((text, i) => {
    const classified = classifyConclusionUnit(text, ctx);
    return {
      id: `cspan-${i + 1}`,
      text,
      spanType: classified.spanType,
      sourceIds: [],
      attention: classified.attention,
      license: classified.license,
      attentionReason: classified.reason,
      role:
        classified.spanType === "gap"
          ? "missing"
          : classified.spanType === "blocked"
            ? "limit"
            : classified.spanType === "assert"
              ? "support"
              : undefined,
    };
  });
}

/** Enforce Change D invariant on any span list. */
export function enforceNoBlockedAsAssert(
  spans: ClaimSpan[],
  cannotSay: string[],
  doNotInfer: string[],
): ClaimSpan[] {
  return spans.map((span) => {
    const blockedHit =
      span.spanType === "blocked" ||
      span.license === "blocked" ||
      matchesAnyList(span.text, cannotSay) ||
      matchesAnyList(span.text, doNotInfer) ||
      BLOCKED_MARKERS.test(span.text);

    if (blockedHit && span.spanType === "assert") {
      return {
        ...span,
        spanType: "blocked",
        license: "blocked",
        attention: "p0",
        attentionReason: "invariant: blocked content cannot be assert",
        role: "limit",
      };
    }
    if (blockedHit && span.spanType !== "blocked" && span.spanType !== "context") {
      return {
        ...span,
        spanType: "blocked",
        license: "blocked",
        attention: span.attention === "p4" ? "p0" : span.attention,
        attentionReason: span.attentionReason ?? "aligned with blocked boundary",
      };
    }
    return span;
  });
}

/** Short display name for a candidate (chip label). Prefer human title fragment. */
export function shortSourceTitle(title: string, maxLen = 14): string {
  const t = normalize(title)
    .replace(/^[「『"']+|[」』"']+$/g, "")
    .replace(/研究显示|报告显示|材料显示|文章|数据库显示/g, "")
    .trim();
  if (t.length <= maxLen) return t || title.slice(0, maxLen);
  return `${t.slice(0, maxLen).replace(/[，,、\s]+$/g, "")}…`;
}

function candidateToSourceRef(c: CandidateMaterial): SourceRef {
  const role: SpanEvidenceRole =
    c.targetSubclaimIds.includes("C5") || /反证|反向|新岗位/.test(c.matchedNeed + c.title)
      ? "contradict"
      : c.traceability === "低"
        ? "background"
        : "support";

  return {
    sourceId: c.id,
    title: shortSourceTitle(c.title),
    // Demo materials often lack URLs; chip still navigable via sourceId
    url: undefined,
    domain: c.sourceType,
    role,
    independence:
      c.independence === "高"
        ? "independent"
        : c.independence === "低"
          ? "folded_repost"
          : "unknown",
  };
}

function scoreSourceForSpan(span: ClaimSpan, source: SourceRef, candidate?: CandidateMaterial): number {
  let score = 0;
  const blob = normalize(
    `${source.title} ${source.domain ?? ""} ${candidate?.title ?? ""} ${candidate?.summary ?? ""} ${candidate?.matchedNeed ?? ""}`,
  );
  const text = normalize(span.text);

  // Keyword overlap
  const tokens = text
    .replace(/[，。！？、；：""''（）()\s]/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (const tok of tokens.slice(0, 12)) {
    if (blob.includes(tok)) score += 2;
  }

  if (span.spanType === "assert" && source.role === "support") score += 3;
  if (span.spanType === "assert" && source.role === "contradict") score += 1;
  if (span.spanType === "gap") score -= 5; // gaps usually have no good source
  if (span.spanType === "blocked") score -= 3;
  if (source.independence === "independent") score += 1;
  if (source.role === "background") score -= 1;

  // Hedge / soft claim + any related material gets a baseline match
  if (span.spanType === "hedge" || span.spanType === "assert") {
    if (/AI|岗位|内容|任务|招聘|暴露|机制/.test(blob)) score += 2;
  }

  // Hedge + mechanism/exposure materials
  if (span.spanType === "hedge" && /可能|任务|暴露|改变/.test(text) && /机制|暴露|任务|AI|岗位|招聘/.test(blob)) {
    score += 4;
  }

  // Counter-evidence language
  if (/反证|新增|提高|不能确认|不足以/.test(text) && source.role === "contradict") {
    score += 5;
  }

  return score;
}

/** Change B: attach best-matching sources to spans that can carry chips. */
export function attachSourcesToSpans(
  spans: ClaimSpan[],
  candidates: CandidateMaterial[] | undefined,
  maxPerSpan = 2,
): { spans: ClaimSpan[]; sources: SourceRef[] } {
  if (!candidates?.length) {
    return { spans, sources: [] };
  }

  const catalog = candidates.map(candidateToSourceRef);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const used = new Set<string>();

  const next = spans.map((span) => {
    // Only outward chips on readable claims; never decorate blocked with fake sources
    if (span.spanType === "blocked" || span.spanType === "context" || span.spanType === "gap") {
      return { ...span, sourceIds: [], sources: [] };
    }

    const ranked = catalog
      .map((src) => ({
        src,
        score: scoreSourceForSpan(span, src, byId.get(src.sourceId)),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const picked: SourceRef[] = [];
    for (const r of ranked) {
      if (picked.length >= maxPerSpan) break;
      // Prefer variety across spans, but allow reuse if best
      if (used.has(r.src.sourceId) && picked.length === 0 && r.score < 4) continue;
      picked.push(r.src);
      used.add(r.src.sourceId);
    }

    return {
      ...span,
      sourceIds: picked.map((p) => p.sourceId),
      sources: picked,
    };
  });

  const sources = catalog.filter((s) => used.has(s.sourceId));
  return { spans: next, sources };
}

function priorityRank(p: AttentionPriority): number {
  return { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4 }[p] ?? 9;
}

function clipReason(text: string, max = 36): string {
  const t = normalize(text).replace(/[。！？]+$/g, "");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Change C: build top-N attention targets from spans + boundary blocks.
 * Titles stay human (snippet of the claim), not meta jargon spam.
 */
export function buildAttentionRail(
  spans: ClaimSpan[],
  cannotSaySpans: BoundarySpan[],
  nextEvidenceNeeded: string[],
  maxItems = 3,
): AttentionTarget[] {
  const candidates: AttentionTarget[] = [];

  for (const s of spans) {
    if (s.spanType === "blocked") {
      candidates.push({
        id: `rail-${s.id}`,
        spanId: s.id,
        priority: "p0",
        title: clipReason(s.text, 22),
        reason: "这条推不出去，先别当结论转发",
        actionHint: "focus-span",
      });
    } else if (s.spanType === "gap") {
      candidates.push({
        id: `rail-${s.id}`,
        spanId: s.id,
        priority: "p2",
        title: clipReason(s.text, 22),
        reason: nextEvidenceNeeded[0]
          ? `还缺：${clipReason(nextEvidenceNeeded[0], 20)}`
          : "证据还没补上",
        actionHint: "focus-span",
      });
    } else if (s.spanType === "assert" && s.sources?.some((x) => x.role === "contradict")) {
      candidates.push({
        id: `rail-${s.id}-contra`,
        spanId: s.id,
        priority: "p0",
        title: clipReason(s.text, 22),
        reason: "这里有反方向材料，建议先点开",
        actionHint: "focus-span",
      });
    } else if (
      s.spanType === "assert" &&
      s.sources?.some((x) => x.independence === "folded_repost")
    ) {
      candidates.push({
        id: `rail-${s.id}-fold`,
        spanId: s.id,
        priority: "p1",
        title: clipReason(s.text, 22),
        reason: "多条转载可能同源，别当成多源共识",
        actionHint: "focus-span",
      });
    }
  }

  // If conclusion had no gap span but we know missing evidence, surface one rail item
  if (!candidates.some((c) => c.priority === "p2") && nextEvidenceNeeded[0]) {
    const gapSpan = spans.find((s) => s.spanType === "gap") ?? spans[0];
    if (gapSpan) {
      candidates.push({
        id: "rail-needed-0",
        spanId: gapSpan.id,
        priority: "p2",
        title: clipReason(nextEvidenceNeeded[0], 22),
        reason: "优先补这条，结论才站得住",
        actionHint: "focus-span",
      });
    }
  }

  // Dedup by spanId+title, sort by priority, take top N
  const seen = new Set<string>();
  const sorted = candidates
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .filter((c) => {
      const key = `${c.spanId}:${c.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);

  // Ensure cannot-say severity appears if rail empty
  if (sorted.length === 0 && cannotSaySpans[0]) {
    sorted.push({
      id: `rail-${cannotSaySpans[0].id}`,
      spanId: cannotSaySpans[0].id,
      priority: "p0",
      title: clipReason(cannotSaySpans[0].text, 22),
      reason: "边界外的说法，不要越线表述",
      actionHint: "focus-boundary",
    });
  }

  return sorted;
}

export function buildAttentionGuidance(
  input: BuildAttentionGuidanceInput,
): AttentionGuidedText {
  const conclusion = normalize(input.conclusion);
  const canSay = (input.canSay ?? []).map(normalize).filter(Boolean);
  const cannotSay = (input.cannotSay ?? []).map(normalize).filter(Boolean);
  const doNotInfer = (input.doNotInfer ?? []).map(normalize).filter(Boolean);
  const nextEvidenceNeeded = (input.nextEvidenceNeeded ?? []).map(normalize).filter(Boolean);
  const licenseBlocked = (input.licenseBlocked ?? []).map(normalize).filter(Boolean);
  const maxSourcesPerSpan = input.maxSourcesPerSpan ?? 2;
  const maxRailItems = input.maxRailItems ?? 3;

  const ctx = { cannotSay, doNotInfer, licenseBlocked, nextEvidenceNeeded };
  let spans = buildConclusionSpans(conclusion, ctx);
  spans = enforceNoBlockedAsAssert(spans, cannotSay, doNotInfer);

  const attached = attachSourcesToSpans(spans, input.candidates, maxSourcesPerSpan);
  spans = attached.spans;

  const { canSaySpans, cannotSaySpans } = buildBoundarySpans(canSay, cannotSay);
  const attentionRail = buildAttentionRail(
    spans,
    cannotSaySpans,
    nextEvidenceNeeded,
    maxRailItems,
  );

  return {
    plainText: conclusion,
    spans,
    canSaySpans,
    cannotSaySpans,
    attentionRail,
    sources: attached.sources,
  };
}

/** Convenience: build from FinalReport + optional handoff + demo candidates. */
export function buildAttentionGuidanceFromReport(
  report: FinalReport,
  handoff?: {
    conclusion?: string;
    canSay?: string[];
    cannotSay?: string[];
  },
  candidates?: CandidateMaterial[],
): AttentionGuidedText {
  const conclusion =
    handoff?.conclusion ??
    report.rewrittenClaim?.cautious ??
    report.allowedConclusion ??
    "";

  const canSay =
    handoff?.canSay ??
    report.inferenceLicense?.allowed.map((a) => a.text) ??
    [];

  const cannotSay =
    handoff?.cannotSay ??
    [
      ...(report.inferenceLicense?.blocked.map((b) => b.text) ?? []),
      ...(report.doNotInfer ?? []),
    ];

  return buildAttentionGuidance({
    conclusion,
    canSay,
    cannotSay,
    doNotInfer: report.doNotInfer,
    nextEvidenceNeeded: report.nextEvidenceNeeded,
    licenseAllowed: report.inferenceLicense?.allowed.map((a) => a.text),
    licenseBlocked: report.inferenceLicense?.blocked.map((b) => b.text),
    candidates,
  });
}
