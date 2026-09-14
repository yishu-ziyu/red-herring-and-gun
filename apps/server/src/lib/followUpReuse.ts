/**
 * 同一案追问快路径（契约 docs/evals/2026-09-13-followup-fast-path.md）。
 *
 * 证据库管「另一条意思相近的新调查少搜」。这里管「这一案子里的下一句」：
 * 已核过且带真实 URL 的命题不再联网；只有新冒出来的可核查小问题才搜。
 *
 * 宪法写死在分类器里：人物/日期/链接变了必须重查（hasTokenConflict）；
 * 没有可点开的 URL 就不算已核、计划为 null（没证据不出结论，不假装快路径）。
 */
import { claimAtomKey } from "./claimAtom/index.js";
import {
  hasTokenConflict,
  isKnowledgeVerdictInjectable,
  normalizeKnowledgeAtom,
  originDateOf,
} from "./knowledgeMatch.js";
import { semanticClaimSimilarity } from "./semanticRecall.js";
import type { KnowledgeInjection } from "./atomSearch.js";

/** 与前端 composeFollowUpClaim 同一句；服务端只用来裁出用户追问，不改拼接。 */
export const FOLLOW_UP_MARKER = "同一条核查的追问，不是新案件。";

/**
 * 「追问已被上一轮命题覆盖」的相似度门槛（0–100）。
 * 比证据库跨案门槛（20）高：宁可多搜一句新问题，也不把「隔夜海鲜」当成「隔夜菜」。
 */
export const FOLLOW_UP_COVER_THRESHOLD = 50;

const VERIFIED_ATOM_VERDICTS = new Set(["true", "false", "partial", "exaggerated", "mixed_misleading"]);

export type FollowUpEvidence = { url: string; title: string; snippet: string };

export type FollowUpReusedAtom = {
  text: string;
  verdict: string;
  evidence: FollowUpEvidence[];
};

export type FollowUpReusePlan = {
  /** 本轮要核查的命题：已核的在前，新问题在后。 */
  atoms: string[];
  newAtoms: string[];
  reused: FollowUpReusedAtom[];
  originDate: string;
};

/**
 * 访客没有服务端案件档案时，随追问带上的上一轮可见材料。
 * 只含命题、判断、可点开出处、结论；不含内部拼接指令或未展示字段。
 */
export type VisiblePriorRound = {
  originalClaim: string;
  conclusion: string;
  claims: VisiblePriorClaim[];
};

export type VisiblePriorClaim = {
  text: string;
  judgment: "supported" | "refuted" | "mixed";
  evidence: VisiblePriorEvidence[];
};

export type VisiblePriorEvidence = {
  url: string;
  title: string;
  excerpt: string;
  role: "support" | "contradict";
};

const VISIBLE_JUDGMENTS = new Set(["supported", "refuted", "mixed"]);
const VISIBLE_ROLES = new Set(["support", "contradict"]);
const VISIBLE_CLAIM_CAP = 8;
const VISIBLE_EVIDENCE_CAP = 8;

function clipText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function judgmentToVerdict(judgment: VisiblePriorClaim["judgment"]): string {
  if (judgment === "supported") return "true";
  if (judgment === "refuted") return "false";
  return "mixed_misleading";
}

function parseVisibleEvidence(raw: unknown): VisiblePriorEvidence | null {
  if (!isRecord(raw)) return null;
  const url = String(raw.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const role = String(raw.role ?? "").trim();
  if (!VISIBLE_ROLES.has(role)) return null;
  return {
    url,
    title: clipText(raw.title, 200),
    excerpt: clipText(raw.excerpt ?? raw.snippet, 320),
    role: role as VisiblePriorEvidence["role"],
  };
}

function parseVisibleClaim(raw: unknown): VisiblePriorClaim | null {
  if (!isRecord(raw)) return null;
  const text = clipText(raw.text, 240);
  const judgment = String(raw.judgment ?? "").trim();
  if (!text || !VISIBLE_JUDGMENTS.has(judgment)) return null;
  const evidence: VisiblePriorEvidence[] = [];
  const seenUrl = new Set<string>();
  for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) {
    const parsed = parseVisibleEvidence(item);
    if (!parsed || seenUrl.has(parsed.url)) continue;
    seenUrl.add(parsed.url);
    evidence.push(parsed);
    if (evidence.length >= VISIBLE_EVIDENCE_CAP) break;
  }
  if (evidence.length === 0) return null;
  return {
    text,
    judgment: judgment as VisiblePriorClaim["judgment"],
    evidence,
  };
}

/** 访客 payload 的上一轮材料：读不到可用证据就 null，不假装快路径。 */
export function parsePriorRoundBrief(raw: unknown): VisiblePriorRound | null {
  if (!isRecord(raw)) return null;
  const claims: VisiblePriorClaim[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.claims) ? raw.claims : []) {
    const claim = parseVisibleClaim(item);
    if (!claim) continue;
    const key = claimAtomKey(claim.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
    if (claims.length >= VISIBLE_CLAIM_CAP) break;
  }
  if (claims.length === 0) return null;
  return {
    originalClaim: clipText(raw.originalClaim, 500),
    conclusion: clipText(raw.conclusion, 800),
    claims,
  };
}

export function priorReportFromVisibleBrief(brief: VisiblePriorRound): Record<string, unknown> {
  return {
    conclusion: brief.conclusion,
    subclaimVerdicts: brief.claims.map((claim) => ({
      claimAtom: claim.text,
      verdict: judgmentToVerdict(claim.judgment),
      supportingSources: claim.evidence
        .filter((item) => item.role === "support")
        .map((item) => ({ url: item.url, title: item.title, snippet: item.excerpt })),
      contradictingSources: claim.evidence
        .filter((item) => item.role === "contradict")
        .map((item) => ({ url: item.url, title: item.title, snippet: item.excerpt })),
    })),
  };
}

export function followUpReuseFromClientBrief(raw: unknown): {
  priorReport: unknown;
  priorClaim: string;
  priorCreatedAt: number;
} | null {
  const brief = parsePriorRoundBrief(raw);
  if (!brief) return null;
  return {
    priorReport: priorReportFromVisibleBrief(brief),
    priorClaim: brief.originalClaim,
    priorCreatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function httpEvidenceOf(source: Record<string, unknown>): FollowUpEvidence | null {
  const url = String(source.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    title: String(source.title ?? "").slice(0, 200),
    snippet: String(source.snippet ?? source.excerpt ?? "").slice(0, 320),
  };
}

function atomVerdictInjectable(verdict: string): boolean {
  return VERIFIED_ATOM_VERDICTS.has(verdict) || isKnowledgeVerdictInjectable(verdict);
}

/** 用户追问原文：裁到「同一条核查的追问」标记之前；没有标记则整段当追问。 */
export function followUpQuestionOf(claim: string): string {
  if (typeof claim !== "string") return "";
  const markerIndex = claim.indexOf(FOLLOW_UP_MARKER);
  if (markerIndex === -1) return claim.trim();
  return claim.slice(0, markerIndex).replace(/[\s\u3000]*[（(]\s*$/, "").trim();
}

/**
 * 追问是否已被这一条已核命题覆盖。人物/日期/链接冲突一律不算覆盖。
 */
export function followUpCoveredByAtom(followUp: string, atom: string): boolean {
  const question = followUpQuestionOf(followUp) || followUp;
  if (!question.trim() || !atom.trim()) return false;
  if (hasTokenConflict(question, atom)) return false;
  const a = normalizeKnowledgeAtom(question);
  const b = normalizeKnowledgeAtom(atom);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  return semanticClaimSimilarity(a, b) >= FOLLOW_UP_COVER_THRESHOLD;
}

/** 上一轮报告里已核且带真实 URL 的命题。读不到就空数组，不编。 */
export function extractPriorVerifiedAtoms(priorReport: unknown): FollowUpReusedAtom[] {
  if (!isRecord(priorReport)) return [];
  const out: FollowUpReusedAtom[] = [];
  const seen = new Set<string>();
  for (const verdict of recordsOf(priorReport.subclaimVerdicts)) {
    const text = String(verdict.claimAtom ?? "").trim();
    if (!text) continue;
    const key = claimAtomKey(text);
    if (seen.has(key)) continue;
    const label = String(verdict.verdict ?? "").trim().toLowerCase();
    if (!atomVerdictInjectable(label)) continue;
    const evidence: FollowUpEvidence[] = [];
    const seenUrl = new Set<string>();
    for (const bucket of [verdict.supportingSources, verdict.contradictingSources]) {
      for (const source of recordsOf(bucket)) {
        const item = httpEvidenceOf(source);
        if (!item || seenUrl.has(item.url)) continue;
        seenUrl.add(item.url);
        evidence.push(item);
      }
    }
    if (evidence.length === 0) continue;
    seen.add(key);
    out.push({ text, verdict: label, evidence });
  }
  return out;
}

export function planFollowUpReuse(input: {
  claim: string;
  priorReport: unknown;
  priorClaim?: string;
  priorCreatedAt?: number;
}): FollowUpReusePlan | null {
  const reused = extractPriorVerifiedAtoms(input.priorReport);
  if (reused.length === 0) return null;

  const followUp = followUpQuestionOf(input.claim);
  const priorClaim = String(input.priorClaim ?? "").trim();
  const coveredByOriginal = priorClaim ? followUpCoveredByAtom(followUp, priorClaim) : false;
  const coveredByAtom = reused.some((atom) => followUpCoveredByAtom(followUp, atom.text));
  const newAtoms = coveredByOriginal || coveredByAtom ? [] : followUp ? [followUp] : [];
  const atoms = [...reused.map((atom) => atom.text), ...newAtoms];
  if (atoms.length === 0) return null;

  return {
    atoms,
    newAtoms,
    reused,
    originDate: originDateOf(input.priorCreatedAt),
  };
}

export function priorRoundLookupOf(
  plan: FollowUpReusePlan
): (atom: string) => KnowledgeInjection | null {
  const byKey = new Map<string, FollowUpReusedAtom>();
  for (const atom of plan.reused) {
    byKey.set(claimAtomKey(atom.text), atom);
  }
  return (atom: string) => {
    const hit = byKey.get(claimAtomKey(atom));
    if (!hit) return null;
    return {
      originDate: plan.originDate,
      priorVerdict: hit.verdict,
      evidence: hit.evidence,
    };
  };
}

export function reusedAtomKeysOf(plan: FollowUpReusePlan): Set<string> {
  return new Set(plan.reused.map((atom) => claimAtomKey(atom.text)));
}

const FOLLOW_UP_ATOM_CAP = 2;

/**
 * 访客完整管道也会把追问再拆成流行病学 / IARC / 临床多条。
 * 第一句就会拿旁支出来顶替这句追问。收成「这句追问 + 至多一条覆盖它的原子」。
 */
export function collapseFollowUpAtoms(claim: string, atoms: string[]): string[] {
  if (!String(claim).includes(FOLLOW_UP_MARKER)) return atoms;
  const question = followUpQuestionOf(claim);
  if (!question) return atoms;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of atoms) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text) continue;
    const key = claimAtomKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  const covering = unique.filter((atom) => followUpCoveredByAtom(question, atom));
  const out: string[] = [question];
  const questionKey = claimAtomKey(question);
  for (const atom of covering) {
    if (claimAtomKey(atom) === questionKey) continue;
    out.push(atom);
    if (out.length >= FOLLOW_UP_ATOM_CAP) break;
  }
  return out;
}

function clipFollowUp(text: string, max = 42): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function followUpVerdictPhrase(verdictType: unknown): string {
  const v = String(verdictType ?? "").trim().toLowerCase();
  if (v === "true") return "站得住";
  if (v === "false") return "站不住";
  if (v === "mixed_misleading" || v === "partial" || v === "mixed") {
    return "有站住的部分，也有没站住的";
  }
  return "现有材料还撑不住判断";
}

export function distinctiveFollowUpTerms(question: string): string[] {
  const compact = question.replace(/[^\u4e00-\u9fff]/g, "");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (let i = 0; i <= compact.length - 4; i += 1) {
    const gram = compact.slice(i, i + 4);
    if (/^[这一是否有在的中或可了和与及对把被从还没]/.test(gram)) continue;
    if (seen.has(gram)) continue;
    seen.add(gram);
    terms.push(gram);
  }
  return terms;
}

export function conclusionMissesFollowUp(conclusion: string, claim: string): boolean {
  if (!String(claim).includes(FOLLOW_UP_MARKER)) return false;
  const question = followUpQuestionOf(claim);
  if (!question) return false;
  const clip = clipFollowUp(question, 16).replace(/…$/, "");
  if (clip && conclusion.includes(clip)) return false;
  const terms = distinctiveFollowUpTerms(question);
  if (terms.some((term) => conclusion.includes(term))) return false;
  // 已经直接答了这句追问（「谈不上中毒」）不算跑题；第一句在引另一条拆题才算顶替。
  const quoted = conclusion.match(/^「([^」]{8,})」/);
  if (!quoted?.[1]) return false;
  return !followUpCoveredByAtom(question, quoted[1]);
}

/**
 * 追问结论第一句必须答这句追问。composer 用 IARC 专项评估顶替时，把第一句换成追问本身。
 */
export function applyFollowUpAnswerLead(report: Record<string, unknown>, claim: string): void {
  if (!report || typeof report !== "object") return;
  if (!conclusionMissesFollowUp(String(report.conclusion ?? ""), claim)) return;
  const question = followUpQuestionOf(claim);
  if (!question) return;
  const lead = `这句追问「${clipFollowUp(question)}」${followUpVerdictPhrase(report.verdictType)}。`;
  const rest = String(report.conclusion ?? "").trim();
  report.conclusion = `${lead}${rest}`.slice(0, 400);
  const summary = String(report.summaryForPublic ?? "").trim();
  if (conclusionMissesFollowUp(summary, claim)) {
    report.summaryForPublic = `${lead}${summary}`.slice(0, 200);
  }
  if (!String(report.recommendation ?? "").includes(clipFollowUp(question, 20))) {
    report.recommendation = lead;
  }
}
