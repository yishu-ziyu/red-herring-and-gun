import type { Claim, ClaimVerdict, Evidence, Pivot, Provenance } from "../casefile/schema.js";
import { extractPivots } from "../fetch/extractPivots.js";
import type { FetchedPage } from "../fetch/types.js";
import { tierOf } from "../rules/sourceTiers.js";
import {
  assessEvidenceGap,
  buildQueryPortfolio,
  selectPriorityQueries,
} from "../search/evidencePursuit/evidencePursuit.js";
import { canonicalizeUrl } from "../search/toEvidence.js";
import { runAssess } from "./assess.js";
import type { StageContext } from "./context.js";
import {
  CitesOutputSchema,
  InvestigateOutputSchema,
  type InvestigateAction,
  type InvestigateActionKind,
} from "./investigate.schema.js";
import { runJudge } from "./judgeStage.js";
import { parseJobOutput } from "./parseOutput.js";

export const INVESTIGATE_JOB = "investigate";
export const CITES_JOB = "cites";

const EXCERPT_MAX = 320;
const BODY_SNIPPET = 2000;
const CANDIDATE_CAP = 10;
const MAX_PIVOT_DEPTH = 3;
const ZERO_GAIN_STOP = 3;
const TOOL_FAIL_STOP = 3;

export const INVESTIGATE_SYSTEM_PROMPT = `你在决定下一步去哪里找证据，不是在裁定命题真假。

规则：
- 只能从给定候选里选一个动作，或输出 kind 为 stop。
- target 必须与候选里的 target 原文完全一致，不准编造、改写、补全 URL 或查询。图片候选的 target 是编号，不是 data URL。
- 不准判断命题真假，不准给分数，不准写证据正文，不准发明案内没有的来源。
- why 只说明这条候选为什么对当前缺口有用。
- 候选都无法缩小缺口时选 stop。
输出 JSON：{ "action": { "kind": "search|fetch|reverse_image|recall|stop", "target": "...", "why": "..." } }`;

export const CITES_SYSTEM_PROMPT = `你在标注这一页的引用关系，不是在裁定命题真假。

给定一页的标题、正文摘要、它抽出的外链，以及案内其它证据的编号。

只回答：
- citesEvidenceIds：这页正文在引用哪些案内已有证据（用它们的 id）。必须是输入里出现过的 id，不能是本页自己。
- primaryLinks：外链里哪些是它声称的原始来源。url 必须来自给定外链列表，不准编造。

不要判断真假，不要输出不在列表里的链接，不要写证据正文。`;

export type InvestigatorStopReason = "budget" | "no-gain" | "resolved" | "time" | "tool-failed";

export type InvestigatorTools = {
  search: (query: string) => Promise<Evidence[]>;
  fetch: (url: string) => Promise<FetchedPage>;
  reverseImage?: (imageUrl: string) => Promise<Evidence[]>;
  recall?: (text: string) => Promise<Evidence[]>;
};

export type InvestigatorInput = {
  role: "main" | "prosecutor" | "defender";
  budget?: number;
  deadline?: number;
  tools: InvestigatorTools;
  systemPromptSuffix?: string;
  claimIds?: string[];
};

export type InvestigatorResult = {
  stopReason: InvestigatorStopReason;
  steps: number;
};

type Candidate = {
  kind: Exclude<InvestigateActionKind, "stop">;
  target: string;
  label: string;
  why: string;
  expectedValue: 1 | 2 | 3;
  pivotId?: string;
  fromEvidenceId?: string;
};

type PendingCite = {
  canonicalUrl: string;
  fromId: string;
};

function defaultBudget(role: InvestigatorInput["role"]): number {
  return role === "main" ? 12 : 4;
}

function clipExcerpt(text: string): string {
  const points = [...text];
  if (points.length <= EXCERPT_MAX) return text;
  return points.slice(0, EXCERPT_MAX).join("");
}

function nextEvidenceId(ctx: StageContext): string {
  return `e${ctx.current.evidence.length + 1}`;
}

/** extractPivots 从 `${id}:p0` 递增；未读搜索命中从 p80 起，避免 fetch 后再抽外链撞号。 */
const UNREAD_PIVOT_BASE = 80;

function nextUnreadPivotId(ctx: StageContext, evidenceId: string): string {
  const prefix = `${evidenceId}:p`;
  let max = UNREAD_PIVOT_BASE - 1;
  const ids = [
    ...ctx.current.frontier.map((item) => item.id),
    ...ctx.current.consumedPivotIds,
  ];
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

function emitUnreadSearchHits(ctx: StageContext, addedIds: string[], depth: number): void {
  const unread = addedIds
    .map((id) => ctx.current.evidence.find((item) => item.id === id))
    .filter((item): item is Evidence => {
      if (!item) return false;
      if (item.text) return false;
      return item.tier === "A" || item.tier === "B";
    })
    .sort((a, b) => {
      if (a.tier === b.tier) return 0;
      return a.tier === "A" ? -1 : 1;
    })
    .slice(0, 3);
  if (unread.length === 0) return;
  const pivots: Pivot[] = unread.map((item) => ({
    id: nextUnreadPivotId(ctx, item.id),
    kind: "link",
    value: item.url,
    why: `搜索命中 ${item.tier} 级页，只有摘要，未读全文`,
    expectedValue: item.tier === "A" ? 3 : 2,
    fromEvidenceId: item.id,
    depth,
  }));
  ctx.emit({ type: "frontier.added", pivots });
}

function sameUrl(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = canonicalizeUrl(a);
  const cb = canonicalizeUrl(b);
  return ca !== null && ca === cb;
}

function focusedClaims(ctx: StageContext, claimIds: string[] | undefined): Claim[] {
  if (claimIds === undefined) return ctx.current.claims.filter((claim) => claim.checkable);
  const allow = new Set(claimIds);
  return ctx.current.claims.filter((claim) => allow.has(claim.id));
}

function verdictOf(ctx: StageContext, claimId: string): ClaimVerdict | undefined {
  return ctx.current.verdicts.find((item) => item.claimId === claimId);
}

function evidenceForStance(ctx: StageContext, stanceId: string): Evidence | undefined {
  const stance = ctx.current.stances.find((item) => item.id === stanceId);
  if (!stance) return undefined;
  return ctx.current.evidence.find((item) => item.id === stance.evidenceId);
}

function isGap(ctx: StageContext, claim: Claim): boolean {
  const verdict = verdictOf(ctx, claim.id);
  if (!verdict || verdict.verdict === "unverified" || verdict.verdict === "contested") return true;
  if (verdict.basis.length === 0) return true;
  return verdict.basis.every((stanceId) => {
    const evidence = evidenceForStance(ctx, stanceId);
    const tier = evidence?.tier ?? "unknown";
    return tier === "C" || tier === "unknown";
  });
}

function basisHasTierA(ctx: StageContext, verdict: ClaimVerdict): boolean {
  return verdict.basis.some((stanceId) => evidenceForStance(ctx, stanceId)?.tier === "A");
}

function isResolved(ctx: StageContext, claims: Claim[]): boolean {
  if (claims.length === 0) return true;
  return claims.every((claim) => {
    const verdict = verdictOf(ctx, claim.id);
    if (!verdict) return false;
    if (verdict.verdict !== "true" && verdict.verdict !== "false" && verdict.verdict !== "partial") {
      return false;
    }
    return basisHasTierA(ctx, verdict);
  });
}

function clusterKey(ctx: StageContext, stanceId: string): string | undefined {
  const evidence = evidenceForStance(ctx, stanceId);
  if (!evidence) return undefined;
  return evidence.clusterId ?? evidence.id;
}

function snapshotKeys(ctx: StageContext, claims: Claim[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const claim of claims) {
    const keys = new Set<string>();
    const verdict = verdictOf(ctx, claim.id);
    if (verdict) {
      for (const stanceId of verdict.basis) {
        const key = clusterKey(ctx, stanceId);
        if (key) keys.add(key);
      }
    }
    out.set(claim.id, keys);
  }
  return out;
}

function gainFromSnapshot(ctx: StageContext, claims: Claim[], before: Map<string, Set<string>>): 0 | 1 {
  for (const claim of claims) {
    const prev = before.get(claim.id) ?? new Set<string>();
    const verdict = verdictOf(ctx, claim.id);
    if (!verdict) continue;
    for (const stanceId of verdict.basis) {
      const key = clusterKey(ctx, stanceId);
      if (key && !prev.has(key)) return 1;
    }
  }
  return 0;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function findEvidenceByUrl(ctx: StageContext, url: string): Evidence | undefined {
  const canon = canonicalizeUrl(url);
  return ctx.current.evidence.find(
    (item) => item.url === url || item.canonicalUrl === url || (canon !== null && item.canonicalUrl === canon),
  );
}

function addCandidate(into: Candidate[], next: Candidate): void {
  const existing = into.find((item) => item.kind === next.kind && item.target === next.target);
  if (!existing) {
    into.push(next);
    return;
  }
  if (next.expectedValue > existing.expectedValue) {
    existing.expectedValue = next.expectedValue;
    existing.why = next.why;
  }
  if (!existing.pivotId && next.pivotId) {
    existing.pivotId = next.pivotId;
    existing.fromEvidenceId = next.fromEvidenceId;
  }
}

function buildCandidates(
  ctx: StageContext,
  gaps: Claim[],
  searchedQueries: Set<string>,
  tools: InvestigatorTools,
): Candidate[] {
  const out: Candidate[] = [];
  for (const claim of gaps) {
    const verdict = verdictOf(ctx, claim.id);
    const expectedValue: 1 | 2 | 3 = verdict?.verdict === "contested" ? 3 : 2;
    // 契约写 assessEvidenceGap→queriesForGap；执行说明改为 portfolio 取 2 条。
    const info = assessEvidenceGap({
      atom: claim.text,
      sources: ctx.current.evidence.map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.excerpt,
      })),
      trigger: verdict?.verdict === "contested" ? "conflict" : "unverified",
    });
    const missing = info.missingEvidence.length > 0 ? info.missingEvidence.join("、") : "证据";
    const picked = selectPriorityQueries(buildQueryPortfolio(claim.text, ctx.current.text), {
      max: 2,
      exclude: searchedQueries,
    });
    for (const row of picked) {
      addCandidate(out, {
        kind: "search",
        target: row.query,
        label: row.query,
        why: `补 ${claim.id} 缺的${missing}`,
        expectedValue,
      });
    }
  }

  const consumed = new Set(ctx.current.consumedPivotIds);
  for (const pivot of ctx.current.frontier) {
    if (consumed.has(pivot.id)) continue;
    if (pivot.depth > MAX_PIVOT_DEPTH) continue;
    const mapped = mapPivot(pivot, tools);
    if (!mapped) continue;
    addCandidate(out, mapped);
  }

  out.sort((a, b) => b.expectedValue - a.expectedValue);
  return out.slice(0, CANDIDATE_CAP);
}

function mapPivot(pivot: Pivot, tools: InvestigatorTools): Candidate | undefined {
  const base = {
    target: pivot.value,
    label: pivot.kind === "image" ? pivot.id : pivot.value,
    why: pivot.why,
    expectedValue: pivot.expectedValue,
    pivotId: pivot.id,
    fromEvidenceId: pivot.fromEvidenceId,
  };
  if (pivot.kind === "link") return { kind: "fetch", ...base };
  if (pivot.kind === "image") {
    if (!tools.reverseImage) return undefined;
    return { kind: "reverse_image", ...base };
  }
  if (
    pivot.kind === "entity" ||
    pivot.kind === "doc_number" ||
    pivot.kind === "date" ||
    pivot.kind === "query"
  ) {
    return { kind: "search", ...base };
  }
  return undefined;
}

function describeGaps(ctx: StageContext, gaps: Claim[]): { goal: string; gap: string } {
  const lines: string[] = [];
  let goal = "追索证据";
  for (const claim of gaps) {
    const verdict = verdictOf(ctx, claim.id);
    const info = assessEvidenceGap({
      atom: claim.text,
      sources: ctx.current.evidence.map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.excerpt,
      })),
      trigger: verdict?.verdict === "contested" ? "conflict" : "unverified",
    });
    if (lines.length === 0) goal = info.goalLabel;
    const missing = info.missingEvidence.length > 0 ? info.missingEvidence.join("、") : "证据";
    lines.push(`${claim.id} ${verdict?.verdict ?? "unverified"} 缺${missing}`);
  }
  return { goal, gap: lines.join("；") };
}

function formatClaims(ctx: StageContext, claims: Claim[]): string {
  return claims
    .map((claim) => {
      const verdict = verdictOf(ctx, claim.id);
      const tally = verdict?.tally ? JSON.stringify(verdict.tally) : "无";
      return `- ${claim.id}: ${claim.text}\n  判决: ${verdict?.verdict ?? "unverified"}\n  tally: ${tally}\n  basis: ${(verdict?.basis ?? []).join(", ") || "无"}`;
    })
    .join("\n");
}

function formatCandidates(candidates: Candidate[]): string {
  return candidates
    .map(
      (item, index) =>
        `${index + 1}. ${JSON.stringify({
          kind: item.kind,
          target: item.label,
          why: item.why,
          expectedValue: item.expectedValue,
        })}`,
    )
    .join("\n");
}

function buildInvestigateUserContent(
  ctx: StageContext,
  claims: Claim[],
  gaps: Claim[],
  candidates: Candidate[],
  remaining: number,
  role: InvestigatorInput["role"],
): string {
  const gapLines = gaps
    .map((claim) => `- ${claim.id} ${verdictOf(ctx, claim.id)?.verdict ?? "unverified"}: ${claim.text}`)
    .join("\n");
  return `案件原句：
${ctx.current.text}

命题（id、文本、判决、tally）：
${formatClaims(ctx, claims)}

缺口：
${gapLines || "无"}

候选（从中选一个；target 必须原文一致）：
${formatCandidates(candidates)}

剩余步数：${remaining}
role：${role}`;
}

function pickFallback(candidates: Candidate[], whyPrefix: string): InvestigateAction {
  const best = candidates[0];
  if (!best) {
    return { kind: "stop", target: "", why: `${whyPrefix}no-candidate` };
  }
  return {
    kind: best.kind,
    target: best.label,
    why: `${whyPrefix}${best.why}`,
  };
}

function matchCandidate(action: InvestigateAction, candidates: Candidate[]): Candidate | undefined {
  const both = candidates.find((item) => item.kind === action.kind && item.label === action.target);
  if (both) return both;
  return candidates.find((item) => item.label === action.target);
}

async function decideAction(
  ctx: StageContext,
  input: InvestigatorInput,
  claims: Claim[],
  gaps: Claim[],
  candidates: Candidate[],
  remaining: number,
): Promise<{ action: InvestigateAction; candidate: Candidate | undefined }> {
  const systemPrompt = input.systemPromptSuffix
    ? `${INVESTIGATE_SYSTEM_PROMPT}\n\n${input.systemPromptSuffix}`
    : INVESTIGATE_SYSTEM_PROMPT;
  const userContent = buildInvestigateUserContent(
    ctx,
    claims,
    gaps,
    candidates,
    remaining,
    input.role,
  );

  try {
    const result = await ctx.llm({
      job: INVESTIGATE_JOB,
      systemPrompt,
      userContent,
      responseSchema: InvestigateOutputSchema,
    });
    const parsed = parseJobOutput(InvestigateOutputSchema, result.output);
    if (!parsed.ok) {
      ctx.emit({ type: "error", stage: INVESTIGATE_JOB, message: parsed.reason });
      const action = pickFallback(candidates, "fallback: ");
      return { action, candidate: matchCandidate(action, candidates) };
    }
    const proposed = parsed.value.action;
    if (proposed.kind === "stop") {
      return { action: proposed, candidate: undefined };
    }
    const candidate = matchCandidate(proposed, candidates);
    if (!candidate) {
      const action = pickFallback(candidates, "fallback: ");
      return { action, candidate: matchCandidate(action, candidates) };
    }
    if (candidate.pivotId && ctx.current.consumedPivotIds.includes(candidate.pivotId)) {
      const action = pickFallback(candidates, "fallback: ");
      return { action, candidate: matchCandidate(action, candidates) };
    }
    return {
      action: { ...proposed, kind: candidate.kind, target: candidate.label },
      candidate,
    };
  } catch {
    const action = pickFallback(candidates, "fallback: ");
    return { action, candidate: matchCandidate(action, candidates) };
  }
}

function emitCite(ctx: StageContext, from: string, to: string): void {
  if (from === to) return;
  if (!ctx.current.evidence.some((item) => item.id === from)) return;
  if (!ctx.current.evidence.some((item) => item.id === to)) return;
  if (ctx.current.cites.some((edge) => edge.from === from && edge.to === to)) return;
  ctx.emit({ type: "evidence.cites", from, to });
}

function resolvePending(ctx: StageContext, pending: PendingCite[], evidence: Evidence): void {
  const left: PendingCite[] = [];
  for (const row of pending) {
    if (row.canonicalUrl !== evidence.canonicalUrl) {
      left.push(row);
      continue;
    }
    emitCite(ctx, row.fromId, evidence.id);
  }
  pending.length = 0;
  pending.push(...left);
}

function ingestOne(
  ctx: StageContext,
  item: Evidence,
  provenance: Provenance,
  pending: PendingCite[],
): string | undefined {
  const canon = canonicalizeUrl(item.canonicalUrl || item.url);
  if (!canon) return undefined;
  if (ctx.current.evidence.some((row) => row.canonicalUrl === canon)) return undefined;
  const host = item.host || new URL(canon).hostname;
  const evidence: Evidence = {
    ...item,
    id: nextEvidenceId(ctx),
    canonicalUrl: canon,
    host,
    excerpt: clipExcerpt(item.excerpt),
    tier: tierOf(host),
    retrievedAt: ctx.now(),
    provenance,
  };
  ctx.emit({ type: "evidence.added", evidence });
  resolvePending(ctx, pending, evidence);
  return evidence.id;
}

function ingestMany(
  ctx: StageContext,
  items: Evidence[],
  provenanceFor: (item: Evidence) => Provenance,
  pending: PendingCite[],
): string[] {
  const added: string[] = [];
  for (const item of items) {
    const id = ingestOne(ctx, item, provenanceFor(item), pending);
    if (id) added.push(id);
  }
  return added;
}

async function annotateCites(
  ctx: StageContext,
  pageId: string,
  page: FetchedPage,
  pivots: Pivot[],
  pending: PendingCite[],
): Promise<void> {
  const others = ctx.current.evidence
    .filter((item) => item.id !== pageId)
    .map((item) => ({ id: item.id, title: item.title, host: item.host }));
  const outbound = page.links.slice();
  if (outbound.length === 0 && others.length === 0) return;
  const userContent = `本页 id：${pageId}
标题：${page.title ?? ""}
正文：
${page.text.slice(0, BODY_SNIPPET)}

外链：
${outbound.length > 0 ? outbound.map((url) => `- ${url}`).join("\n") : "无"}

案内其它证据：
${others.length > 0 ? JSON.stringify(others, null, 2) : "无"}`;

  let output: unknown;
  try {
    const result = await ctx.llm({
      job: CITES_JOB,
      systemPrompt: CITES_SYSTEM_PROMPT,
      userContent,
      responseSchema: CitesOutputSchema,
    });
    output = result.output;
  } catch {
    return;
  }
  const parsed = parseJobOutput(CitesOutputSchema, output);
  if (!parsed.ok) {
    ctx.emit({ type: "error", stage: CITES_JOB, message: parsed.reason });
    return;
  }

  const knownIds = new Set(ctx.current.evidence.map((item) => item.id));
  for (const to of parsed.value.citesEvidenceIds) {
    if (!knownIds.has(to) || to === pageId) continue;
    emitCite(ctx, pageId, to);
  }

  for (const link of parsed.value.primaryLinks) {
    if (!outbound.some((url) => sameUrl(url, link.url))) continue;
    for (const pivot of pivots) {
      if (pivot.kind === "link" && sameUrl(pivot.value, link.url)) {
        pivot.expectedValue = 3;
      }
    }
    const canon = canonicalizeUrl(link.url);
    if (!canon) continue;
    const existing = ctx.current.evidence.find((item) => item.canonicalUrl === canon);
    if (existing) {
      emitCite(ctx, pageId, existing.id);
      continue;
    }
    if (!pending.some((row) => row.canonicalUrl === canon && row.fromId === pageId)) {
      pending.push({ canonicalUrl: canon, fromId: pageId });
    }
  }
}

async function afterFetch(
  ctx: StageContext,
  pageId: string,
  page: FetchedPage,
  depth: number,
  pending: PendingCite[],
): Promise<void> {
  if (!page.reachable || page.text.length === 0) return;
  const evidence = ctx.current.evidence.find((item) => item.id === pageId);
  const host = evidence?.host ?? "";
  const known = new Set(ctx.current.evidence.map((item) => item.canonicalUrl));
  const extracted = extractPivots(
    { id: pageId, host, text: page.text, links: page.links, images: page.images },
    depth,
  );
  const pivots = extracted.filter((pivot) => {
    if (ctx.current.frontier.some((item) => item.id === pivot.id)) return false;
    if (ctx.current.consumedPivotIds.includes(pivot.id)) return false;
    if (pivot.kind !== "link") return true;
    const canon = canonicalizeUrl(pivot.value);
    return !(canon && known.has(canon));
  });
  await annotateCites(ctx, pageId, page, pivots, pending);
  if (pivots.length > 0) {
    ctx.emit({ type: "frontier.added", pivots });
  }
}

function consumePivot(ctx: StageContext, candidate: Candidate | undefined): void {
  if (!candidate?.pivotId) return;
  if (ctx.current.consumedPivotIds.includes(candidate.pivotId)) return;
  if (!ctx.current.frontier.some((item) => item.id === candidate.pivotId)) return;
  ctx.emit({ type: "frontier.consumed", pivotId: candidate.pivotId });
}

function pivotProvenance(candidate: Candidate): Provenance {
  return {
    kind: "pivot",
    fromEvidenceId: candidate.fromEvidenceId ?? "",
    pivotId: candidate.pivotId ?? "",
  };
}

function pivotDepthPlusOne(ctx: StageContext, candidate: Candidate | undefined): number {
  if (!candidate?.pivotId) return 1;
  const pivot = ctx.current.frontier.find((item) => item.id === candidate.pivotId);
  return (pivot?.depth ?? 0) + 1;
}

function fetchResultLabel(id: string, page: FetchedPage, verb: "updated" | "added"): string {
  if (!page.reachable) return `unreachable ${id}`;
  if (page.text.length === 0) return `empty ${id}`;
  return `${verb} ${id}`;
}

async function act(
  ctx: StageContext,
  action: InvestigateAction,
  candidate: Candidate | undefined,
  tools: InvestigatorTools,
  searchedQueries: Set<string>,
  pending: PendingCite[],
  role: InvestigatorInput["role"],
  claimIds: string[],
): Promise<{ result: string; mutated: boolean }> {
  const nextDepth = pivotDepthPlusOne(ctx, candidate);
  consumePivot(ctx, candidate);
  if (action.kind === "search") {
    const query = candidate?.target ?? action.target;
    searchedQueries.add(query);
    const found = await tools.search(query);
    const added = ingestMany(
      ctx,
      found,
      (item) => (candidate?.pivotId ? pivotProvenance(candidate) : item.provenance),
      pending,
    );
    emitUnreadSearchHits(ctx, added, nextDepth);
    return {
      result: added.length > 0 ? `added ${added.join(", ")}` : "added 0",
      mutated: added.length > 0,
    };
  }
  if (action.kind === "reverse_image") {
    if (!tools.reverseImage) throw new Error("no reverseImage tool");
    const imageUrl = candidate?.target ?? action.target;
    const found = await tools.reverseImage(imageUrl);
    const added = ingestMany(
      ctx,
      found,
      () => ({ kind: "reverse-image", imageUrl }),
      pending,
    );
    return {
      result: added.length > 0 ? `added ${added.join(", ")}` : "added 0",
      mutated: added.length > 0,
    };
  }
  if (action.kind === "recall") {
    if (!tools.recall) throw new Error("no recall tool");
    const found = await tools.recall(candidate?.target ?? action.target);
    const added = ingestMany(ctx, found, () => ({ kind: "memory" }), pending);
    return {
      result: added.length > 0 ? `added ${added.join(", ")}` : "added 0",
      mutated: added.length > 0,
    };
  }
  if (action.kind === "fetch") {
    const url = candidate?.target ?? action.target;
    const page = await tools.fetch(url);
    const existing =
      findEvidenceByUrl(ctx, url) ?? (page.finalUrl ? findEvidenceByUrl(ctx, page.finalUrl) : undefined);
    const mutated = page.reachable && page.text.length > 0;

    if (existing) {
      ctx.emit({
        type: "evidence.updated",
        id: existing.id,
        ...(page.text.length > 0 ? { text: page.text } : {}),
        ...(page.title !== undefined ? { title: page.title } : {}),
        ...(page.publishedAt !== undefined ? { publishedAt: page.publishedAt } : {}),
        reachable: page.reachable,
      });
      await afterFetch(ctx, existing.id, page, nextDepth, pending);
      if (mutated) {
        await runAssess(ctx, { claimIds, by: role, evidenceIds: [existing.id] });
      }
      return { result: fetchResultLabel(existing.id, page, "updated"), mutated };
    }

    const rawUrl = page.finalUrl || url;
    const canon = canonicalizeUrl(rawUrl) ?? canonicalizeUrl(url);
    if (!canon) return { result: "bad-url", mutated: false };
    const host = new URL(canon).hostname;
    const evidence: Evidence = {
      id: nextEvidenceId(ctx),
      url: rawUrl,
      canonicalUrl: canon,
      host,
      excerpt: clipExcerpt(page.text || page.title || ""),
      retrievedAt: ctx.now(),
      tier: tierOf(host),
      provenance: candidate?.pivotId ? pivotProvenance(candidate) : { kind: "pivot", fromEvidenceId: "", pivotId: "" },
      reachable: page.reachable,
    };
    if (page.title !== undefined) evidence.title = page.title;
    if (page.text.length > 0) evidence.text = page.text;
    if (page.publishedAt !== undefined) evidence.publishedAt = page.publishedAt;
    ctx.emit({ type: "evidence.added", evidence });
    resolvePending(ctx, pending, evidence);
    await afterFetch(ctx, evidence.id, page, nextDepth, pending);
    return { result: fetchResultLabel(evidence.id, page, "added"), mutated };
  }
  return { result: "stop", mutated: false };
}

export async function runInvestigator(
  ctx: StageContext,
  input: InvestigatorInput,
): Promise<InvestigatorResult> {
  const role = input.role;
  const budget = input.budget ?? defaultBudget(role);
  const searchedQueries = new Set<string>();
  const pending: PendingCite[] = [];
  let steps = 0;
  let consecutiveZeroGain = 0;
  let consecutiveToolFail = 0;

  const stop = (reason: InvestigatorStopReason): InvestigatorResult => {
    ctx.emit({ type: "investigator.stopped", role, reason });
    return { stopReason: reason, steps };
  };

  while (true) {
    if (input.deadline !== undefined && Date.now() >= input.deadline) return stop("time");
    if (steps >= budget) return stop("budget");
    if (consecutiveZeroGain >= ZERO_GAIN_STOP) return stop("no-gain");
    if (consecutiveToolFail >= TOOL_FAIL_STOP) return stop("tool-failed");

    const focused = focusedClaims(ctx, input.claimIds);
    if (isResolved(ctx, focused)) return stop("resolved");

    const gaps = focused.filter((claim) => isGap(ctx, claim));
    if (gaps.length === 0) return stop("resolved");

    const candidates = buildCandidates(ctx, gaps, searchedQueries, input.tools);
    if (candidates.length === 0) return stop("no-gain");

    const remaining = Math.max(0, budget - steps);
    const { action, candidate } = await decideAction(ctx, input, focused, gaps, candidates, remaining);
    if (action.kind === "stop") {
      return stop(gaps.some((claim) => isGap(ctx, claim)) ? "no-gain" : "resolved");
    }

    const labeled = describeGaps(ctx, gaps);
    const before = snapshotKeys(ctx, gaps);
    steps += 1;

    let result: string;
    let mutated = false;
    try {
      const acted = await act(
        ctx,
        action,
        candidate,
        input.tools,
        searchedQueries,
        pending,
        role,
        gaps.map((claim) => claim.id),
      );
      result = acted.result;
      mutated = acted.mutated;
      consecutiveToolFail = 0;
    } catch (error) {
      result = `tool-failed: ${errorText(error)}`;
      consecutiveToolFail += 1;
      ctx.emit({
        type: "investigator.step",
        n: steps,
        role,
        goal: labeled.goal,
        gap: labeled.gap,
        action: { kind: action.kind, target: action.target },
        why: action.why,
        result,
        gain: 0,
      });
      continue;
    }

    if (mutated) {
      await runAssess(ctx, { claimIds: gaps.map((claim) => claim.id), by: role });
      await runJudge(ctx, { claimIds: gaps.map((claim) => claim.id) });
    }

    const gain = gainFromSnapshot(ctx, gaps, before);
    if (gain === 1) consecutiveZeroGain = 0;
    else consecutiveZeroGain += 1;

    ctx.emit({
      type: "investigator.step",
      n: steps,
      role,
      goal: labeled.goal,
      gap: labeled.gap,
      action: { kind: action.kind, target: action.target },
      why: action.why,
      result,
      gain,
    });
  }
}
