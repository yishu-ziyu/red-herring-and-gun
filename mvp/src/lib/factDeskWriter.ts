/**
 * factDeskWriter.ts - Prompt A (conclusion rewrite) + Prompt F (self-critique loop)
 *
 * Deterministic fact-desk voice for composeReport and offline demos.
 * LLM report_composer system prompt should mirror FACT_DESK_WRITING_RULES.
 *
 * Voice: AFP plain + Full Fact uncertainty + 较真 brevity.
 * Source: docs/FACTCHECK_WRITING_VOICE.md
 */

import type {
  CandidateMaterial,
  DemoCase,
  GradedEvidence,
  InferenceLicense,
} from "./schemas";

export interface AtomicFinding {
  claimUnit: string;
  evidenceSummary: string;
  sourceTitles: string[];
  status: "support" | "contradict" | "gap" | "blocked" | "limit";
}

export interface FactDeskDraft {
  lede: string;
  canSay: string[];
  cannotSay: string[];
  openQuestions: string[];
  publicFacing: string;
  researchMemo: string;
  /** Critique notes after Prompt F */
  critiqueNotes: string[];
}

export interface FactDeskWriterInput {
  originalClaim: string;
  findings: AtomicFinding[];
  canSaySeed?: string[];
  cannotSaySeed?: string[];
  nextEvidenceNeeded?: string[];
  highTraceSources?: string[];
}

/** Shared rules for LLM + deterministic writer (Prompt A condensed). */
export const FACT_DESK_WRITING_RULES = [
  "Voice: plain, precise, adult. Like AFP Fact Check + Full Fact. No sarcasm, no meme tone, no moral lecture.",
  "Lede structure (2–5 short Chinese sentences): (1) what the claim said (2) what evidence supports/denies (3) what remains unproven or blocked.",
  "Every hard factual clause must be supportable by a named source in inputs. If no source, use gap language (无法/未见/不足以), never as proven fact.",
  "Never invent sources, dates, officials, or quotes.",
  "Prefer 不能支持 / 不足以确认 / 未见公开记录 over 纯属捏造 / 可笑 / 震惊.",
  "Do not smuggle cannot_say ideas into assertive wording.",
  "Chinese fullwidth punctuation. No English filler. No AI self-talk (作为AI / 作为人工智能).",
  "Do not append meta labels like 「可说」「不可说」 inside the prose. Boundaries are separate lists.",
  "Action without lecture: 转发前建议先看原始来源 — not 广大网友务必理性.",
].join("\n");

const BANNED_DRAMA =
  /纯属捏造|纯属子虚乌有|令人啼笑皆非|令人啼笑|可笑至极|震惊全网|铁证如山|毋庸置疑|智慧的网友|作为AI|作为人工智能|速来围观|当帮凶|广大网友务必/g;

const CAUSAL_LEAP = /导致|已经证明|必定|一定致癌|等于毒药|已经决定|全部取消/;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function unique(items: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = normalize(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function clip(s: string, max: number): string {
  const t = normalize(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/[，,、\s]+$/g, "")}…`;
}

/** Build atomic findings from graded evidence + candidates (for composeReport). */
export function findingsFromGrades(
  caseData: DemoCase,
  grades: GradedEvidence[],
): AtomicFinding[] {
  const byId = new Map(caseData.candidates.map((c) => [c.id, c]));
  const findings: AtomicFinding[] = [];

  for (const sub of caseData.subclaims) {
    const related = grades.filter((g) => g.subclaimId === sub.id);
    if (related.length === 0) {
      findings.push({
        claimUnit: sub.text,
        evidenceSummary: "本轮未形成可用证据分级。",
        sourceTitles: [],
        status: "gap",
      });
      continue;
    }

    const titles = related
      .map((g) => byId.get(g.candidateId)?.title)
      .filter((t): t is string => !!t);

    const hasMain = related.some((g) => g.usageLevel === "主证据" || g.usageLevel === "反证");
    const hasCounter = related.some((g) => g.evidenceRole === "反驳" || g.usageLevel === "反证");
    const blocked = related.flatMap((g) => g.inferenceBlocked ?? []);
    const allowed = related.flatMap((g) => g.inferenceAllowed ?? []);
    const gaps = related.flatMap((g) => g.evidenceGap ?? []);

    let status: AtomicFinding["status"] = "limit";
    if (hasCounter) status = "contradict";
    else if (hasMain && allowed.length > 0) status = "support";
    else if (blocked.length > 0 && !hasMain) status = "blocked";
    else if (gaps.length > 0 || !hasMain) status = "gap";

    const summaryBits = related
      .slice(0, 2)
      .map((g) => {
        const c = byId.get(g.candidateId);
        return c ? `${c.title}：${c.summary}` : g.matchedEvidenceNeed;
      });

    findings.push({
      claimUnit: sub.text,
      evidenceSummary: summaryBits.join("；") || "证据摘要不足。",
      sourceTitles: titles.slice(0, 3),
      status,
    });
  }

  return findings;
}

function pickSupportLine(findings: AtomicFinding[]): string | null {
  const hit =
    findings.find(
      (f) =>
        (f.status === "support" || f.status === "contradict" || f.status === "limit") &&
        f.sourceTitles.length > 0,
    ) ??
    // Grader may still be AI-jobs biased on methodFit; fall back to any sourced finding
    findings.find((f) => f.sourceTitles.length > 0 && f.status !== "blocked");
  if (!hit) return null;
  const src = hit.sourceTitles[0];
  const body = clip(hit.evidenceSummary.replace(/^[^：:]+[：:]/, ""), 48);
  return `公开材料（${clip(src, 18)}）显示：${body}`;
}

function pickGapLine(findings: AtomicFinding[], nextNeeded: string[]): string | null {
  const gap = findings.find((f) => f.status === "gap" || f.status === "blocked");
  if (gap) {
    return `关键缺口仍在：${clip(gap.claimUnit, 36)}`;
  }
  if (nextNeeded[0]) {
    return `要站得住，还缺：${clip(nextNeeded[0], 36)}`;
  }
  return null;
}

function pickBlockLine(cannotSay: string[]): string | null {
  if (!cannotSay[0]) return null;
  const raw = normalize(cannotSay[0]).replace(/[。．.]+$/g, "");
  // Route rules are already complete sentences - do not wrap again
  if (/不能|不可|禁止|只能/.test(raw)) {
    return `就现有证据，${clip(raw, 52)}。`;
  }
  return `就现有证据，不能支持「${clip(raw, 28)}」这类表述。`;
}

/**
 * Prompt A - deterministic conclusion rewrite.
 * Produces fact-desk lede + boundary lists without LLM.
 */
export function writeFactDeskConclusion(input: FactDeskWriterInput): FactDeskDraft {
  const claim = normalize(input.originalClaim);
  const nextNeeded = unique(input.nextEvidenceNeeded ?? [], 5);
  const cannotSay = unique(
    [
      ...(input.cannotSaySeed ?? []),
      ...input.findings.flatMap((f) =>
        f.status === "blocked" ? [`不能从「${clip(f.claimUnit, 20)}」推出原说法成立`] : [],
      ),
    ],
    6,
  );
  const canSay = unique(
    [
      ...(input.canSaySeed ?? []),
      ...input.findings
        .filter((f) => f.status === "support" || f.status === "contradict")
        .filter((f) => f.sourceTitles.length > 0)
        .map((f) => clip(f.evidenceSummary, 42)),
    ],
    6,
  );

  const claimSentence = claim
    ? `流传说法是：「${clip(claim, 42)}」。`
    : "流传说法边界不清，先按可核查单元处理。";

  const highSources = unique(input.highTraceSources ?? [], 4);
  let support = pickSupportLine(input.findings);
  if (!support && highSources[0]) {
    // Still surface a sourced hinge even when grader status is conservative
    support = `公开材料（${clip(highSources[0], 18)}）可核对，但不足以按原说法强度成立。`;
  }
  const gap = pickGapLine(input.findings, nextNeeded);
  const block = pickBlockLine(cannotSay);

  const sentences = [claimSentence, support, gap, block].filter(Boolean) as string[];
  // Keep 2–5 sentences
  const lede = sentences.slice(0, 5).join("");

  const publicFacing = support
    ? `${clip(claim, 24)}这一说法，目前公开材料不足以按原强度成立。${highSources[0] ? `可先看：${clip(highSources[0], 16)}。` : "转发前建议先看原始来源。"}`
    : `${clip(claim, 24)}这一说法，现有证据仍不足以确认。转发前建议先看原始来源。`;

  const researchMemo = [
    "在缺少同口径数据、可验证原文或官方确认前，只将相关因素记为待检验假设，不写成已确认因果。",
    nextNeeded[0] ? `优先补证：${nextNeeded[0]}` : "",
    highSources[0] ? `高可追溯材料：${highSources.join("；")}` : "",
  ]
    .filter(Boolean)
    .join("");

  const openQuestions = unique(
    [
      ...nextNeeded,
      ...input.findings.filter((f) => f.status === "gap").map((f) => f.claimUnit),
    ],
    5,
  );

  const draft: FactDeskDraft = {
    lede,
    canSay: canSay.length > 0 ? canSay : ["仅能复述已核对到的公开材料，不能扩展原说法强度。"],
    cannotSay:
      cannotSay.length > 0
        ? cannotSay
        : ["不能在证据不足时把原说法写成已证实事实。"],
    openQuestions,
    publicFacing,
    researchMemo,
    critiqueNotes: [],
  };

  return critiqueAndFixFactDeskDraft(draft, input);
}

/**
 * Prompt F - self-critique loop.
 * Fixes banned drama, causal leaps without support, and empty boundaries.
 */
export function critiqueAndFixFactDeskDraft(
  draft: FactDeskDraft,
  input: FactDeskWriterInput,
): FactDeskDraft {
  const notes: string[] = [];
  let lede = draft.lede;
  let publicFacing = draft.publicFacing;
  let researchMemo = draft.researchMemo;

  const stripDrama = (text: string, label: string): string => {
    // Reset lastIndex because BANNED_DRAMA is /g
    BANNED_DRAMA.lastIndex = 0;
    if (!BANNED_DRAMA.test(text)) return text;
    notes.push(`${label}: removed drama diction`);
    BANNED_DRAMA.lastIndex = 0;
    return text
      .replace(BANNED_DRAMA, "")
      .replace(/纯属[^。]{0,12}/g, "现有证据不支持")
      .replace(/，{2,}/g, "，")
      .replace(/。{2,}/g, "。")
      .replace(/\s+/g, " ")
      .trim();
  };

  lede = stripDrama(lede, "lede");
  publicFacing = stripDrama(publicFacing, "publicFacing");
  researchMemo = stripDrama(researchMemo, "researchMemo");

  // Soften unsupported causal leaps in lede if no support finding
  const hasSupport = input.findings.some(
    (f) => f.status === "support" || f.status === "contradict",
  );
  if (CAUSAL_LEAP.test(lede) && !hasSupport) {
    notes.push("lede: softened causal leap without support");
    lede = lede
      .replace(/导致/g, "关联到")
      .replace(/已经证明/g, "尚不足以证明")
      .replace(/等于毒药/g, "被类比为「毒药」（修辞过强）")
      .replace(/全部取消/g, "「全部取消」（原说法用语）");
  }

  // Ensure gap language if no high-trace sources at all
  const anySource = input.findings.some((f) => f.sourceTitles.length > 0);
  if (!anySource && !/不足以|未见|无法|证据/.test(lede)) {
    notes.push("lede: injected gap language for sourceless draft");
    lede = `${lede}现有检索未形成可核验来源，结论只能停在证据不足。`;
  }

  // Ensure cannot_say not empty
  const cannotSay =
    draft.cannotSay.length > 0
      ? draft.cannotSay
      : ["不能在证据不足时把原说法写成已证实事实。"];
  if (draft.cannotSay.length === 0) notes.push("cannotSay: filled default boundary");

  // No meta labels in prose
  if (/【可说】|【不可说】|（可说）|（不可说）/.test(lede)) {
    notes.push("lede: stripped meta labels");
    lede = lede.replace(/【可说】|【不可说】|（可说）|（不可说）/g, "");
  }

  return {
    ...draft,
    lede: normalize(lede),
    publicFacing: normalize(publicFacing),
    researchMemo: normalize(researchMemo),
    cannotSay,
    critiqueNotes: notes,
  };
}

/** Rubric 0–2 × 6 dims (pass >= 10). */
export function scoreFactDeskDraft(
  draft: FactDeskDraft,
  originalClaim: string,
): { total: number; details: Record<string, number>; pass: boolean } {
  const details: Record<string, number> = {
    claimRestated: 0,
    evidenceLanguage: 0,
    uncertaintyVisible: 0,
    noDrama: 0,
    boundaries: 0,
    concise: 0,
  };

  const lede = draft.lede;
  if (originalClaim && (lede.includes(originalClaim.slice(0, 6)) || /流传说法|原表述|网传/.test(lede))) {
    details.claimRestated = 2;
  } else if (lede.length > 10) {
    details.claimRestated = 1;
  }

  if (/材料|来源|显示|评估|报道|研究/.test(lede)) details.evidenceLanguage = 2;
  else if (lede.length > 20) details.evidenceLanguage = 1;

  if (/不足|无法|未见|不能支持|尚未|缺口|不能/.test(lede + draft.publicFacing)) {
    details.uncertaintyVisible = 2;
  } else {
    details.uncertaintyVisible = 0;
  }

  details.noDrama = BANNED_DRAMA.test(lede + draft.publicFacing) ? 0 : 2;

  details.boundaries =
    draft.canSay.length > 0 && draft.cannotSay.length > 0
      ? 2
      : draft.cannotSay.length > 0
        ? 1
        : 0;

  const len = lede.length;
  details.concise = len > 0 && len <= 160 ? 2 : len <= 220 ? 1 : 0;

  const total = Object.values(details).reduce((a, b) => a + b, 0);
  return { total, details, pass: total >= 10 };
}

/**
 * Prefer case-native boundary language (routes / searchPlans).
 * Grader allowed/blocked is still AI-jobs oriented in places; filter off-domain noise.
 */
function caseNativeBoundaries(caseData: DemoCase): {
  canSay: string[];
  cannotSay: string[];
  nextNeeded: string[];
} {
  const cannotSay = unique(
    [
      ...caseData.routes.map((r) => r.minimumOutputRule).filter(Boolean),
      ...caseData.searchPlans.flatMap((s) => s.mustNotInfer ?? []),
    ],
    8,
  );

  const canSay = unique(
    caseData.candidates
      .filter((c) => c.traceability === "高" || c.traceability === "中")
      .map((c) => clip(c.summary, 42)),
    6,
  );

  const nextNeeded = unique(
    [
      ...caseData.routes.flatMap((r) => r.neededEvidence),
      ...caseData.searchPlans.flatMap((s) => s.evidenceGaps ?? []),
    ],
    6,
  );

  return { canSay, cannotSay, nextNeeded };
}

function looksOffDomainForClaim(text: string, claim: string): boolean {
  const aiOnly = /文科岗位|生成式 AI|初级内容岗位|招聘需求下降|任务暴露度/;
  const claimIsAi = /AI|人工智能|内容岗位|招聘/.test(claim);
  if (claimIsAi) return false;
  return aiOnly.test(text);
}

/** Compose path helper: case + grades + license -> FactDeskDraft */
export function writeFactDeskFromCase(
  caseData: DemoCase,
  grades: GradedEvidence[],
  license: InferenceLicense,
  extras?: {
    doNotInfer?: string[];
    nextEvidenceNeeded?: string[];
  },
): FactDeskDraft {
  const findings = findingsFromGrades(caseData, grades);
  const highTrace = caseData.candidates
    .filter((c: CandidateMaterial) => c.traceability === "高")
    .map((c) => c.title);
  const native = caseNativeBoundaries(caseData);
  const claim = caseData.originalClaim;

  const licenseCan = license.allowed
    .map((a) => a.text)
    .filter((t) => !looksOffDomainForClaim(t, claim));
  const licenseCannot = license.blocked
    .map((b) => b.text)
    .filter((t) => !looksOffDomainForClaim(t, claim));

  return writeFactDeskConclusion({
    originalClaim: claim,
    findings,
    canSaySeed: unique([...native.canSay, ...licenseCan], 8),
    cannotSaySeed: unique(
      [...native.cannotSay, ...licenseCannot, ...(extras?.doNotInfer ?? [])].filter(
        (t) => !looksOffDomainForClaim(t, claim),
      ),
      10,
    ),
    nextEvidenceNeeded: extras?.nextEvidenceNeeded?.length
      ? extras.nextEvidenceNeeded
      : native.nextNeeded,
    highTraceSources: highTrace,
  });
}
