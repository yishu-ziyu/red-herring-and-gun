/** 解析上一轮对话材料，并处理追问文字；历史材料不能替代本轮检索。 */
import { claimAtomKey } from "../../../shared/claimAtomText.js";
import { directAnswer } from "./publicCopy.js";
import { semanticClaimSimilarity } from "../../../shared/semanticRecall.js";
import {
  FOLLOW_UP_MARKER,
  displayFollowUpClaim,
  distinctiveFollowUpTerms,
  type VisiblePriorClaim,
  type VisiblePriorEvidence,
  type VisiblePriorRound,
} from "../../../shared/followUp.js";

/**
 * 规范化：trim → NFKC（全角转半角、兼容字符统一）→ 小写 → 压缩空白 → 去句末标点。
 * 只做形状规范化，不做同义替换——同义与转述由相似度负责。
 */
function normalizeKnowledgeAtom(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。．.！!？?；;，,、：:…~～"'“”‘’）)】\]》>]+$/u, "")
    .trim();
}

/**
 * 「人物/日期/链接变化 → 匹配不上」的确定性闸门：
 * 两边都出现数字/拉丁词或链接、且**各自都有对方没有的**数字/拉丁词时判冲突
 * （2 月 5 日 vs 2 月 6 日、第 8 号 vs 第 9 号、0.5mg vs 0.3mg、两条不同链接）。
 * 只有一侧带数字/链接不算冲突——正常改写常常补一个时间或出处。
 */
function hasTokenConflict(atomA: string, atomB: string): boolean {
  const a = normalizeKnowledgeAtom(atomA);
  const b = normalizeKnowledgeAtom(atomB);
  if (!a || !b) return false;

  const digitsA = new Set(a.match(/[a-z0-9]+/g) ?? []);
  const digitsB = new Set(b.match(/[a-z0-9]+/g) ?? []);
  if (digitsA.size > 0 && digitsB.size > 0) {
    const onlyA = [...digitsA].some((token) => !digitsB.has(token));
    const onlyB = [...digitsB].some((token) => !digitsA.has(token));
    if (onlyA && onlyB) return true;
  }

  const linksA = new Set(a.match(/https?:\/\/\S+/g) ?? []);
  const linksB = new Set(b.match(/https?:\/\/\S+/g) ?? []);
  if (linksA.size > 0 && linksB.size > 0) {
    const shared = [...linksA].some((link) => linksB.has(link));
    if (!shared) return true;
  }

  return false;
}

/**
 * 「追问已被上一轮命题覆盖」的相似度门槛（0–100）。
 * 门槛取高：宁可多搜一句新问题，也不把「隔夜海鲜」当成「隔夜菜」。
 */
const FOLLOW_UP_COVER_THRESHOLD = 50;

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

/** 读取客户端携带的上一轮材料；仅供理解对话。 */
function parsePriorRoundBrief(raw: unknown): VisiblePriorRound | null {
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
    ...(typeof raw.checkedAt === "string" && Number.isFinite(Date.parse(raw.checkedAt)) ? { checkedAt: raw.checkedAt } : {}),
    claims,
  };
}

function priorReportFromVisibleBrief(brief: VisiblePriorRound): Record<string, unknown> {
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
  priorCreatedAt?: number;
} | null {
  const brief = parsePriorRoundBrief(raw);
  if (!brief) return null;
  return {
    priorReport: priorReportFromVisibleBrief(brief),
    priorClaim: brief.originalClaim,
    ...(brief.checkedAt ? { priorCreatedAt: Date.parse(brief.checkedAt) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 用户追问原文：裁到「同一条核查的追问」标记之前；没有标记则整段当追问。 */
export function followUpQuestionOf(claim: string): string {
  return displayFollowUpClaim(claim).trim();
}

/**
 * 追问是否已被这一条已核命题覆盖。人物/日期/链接冲突一律不算覆盖。
 */
function followUpCoveredByAtom(followUp: string, atom: string): boolean {
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
  if (v === "disputed") return "权威来源之间说法不一致";
  return "现有材料还撑不住判断";
}

function conclusionMissesFollowUp(conclusion: string, claim: string): boolean {
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
  // 整句结论由规则表写成通用首句（「公开材料不支持这条说法。」）时，「这条说法」指不明，换成追问本身。
  const generic = directAnswer(report.verdictType);
  const startsGeneric = String(claim).includes(FOLLOW_UP_MARKER) && String(report.conclusion ?? "").startsWith(generic);
  if (!startsGeneric && !conclusionMissesFollowUp(String(report.conclusion ?? ""), claim)) return;
  const question = followUpQuestionOf(claim);
  if (!question) return;
  const lead = `这句追问「${clipFollowUp(question)}」${followUpVerdictPhrase(report.verdictType)}。`;
  const rest = String(report.conclusion ?? "").trim();
  report.conclusion = `${lead}${startsGeneric ? rest.slice(generic.length) : rest}`.slice(0, 480);
  const summary = String(report.summaryForPublic ?? "").trim();
  if (startsGeneric && summary.startsWith(generic)) {
    report.summaryForPublic = `${lead}${summary.slice(generic.length)}`.slice(0, 200);
  } else if (conclusionMissesFollowUp(summary, claim)) {
    report.summaryForPublic = `${lead}${summary}`.slice(0, 200);
  }
  if (!String(report.recommendation ?? "").includes(clipFollowUp(question, 20))) {
    report.recommendation = lead;
  }
}
