import type { InvestigationSnapshotV1 } from "./investigation/index.js";
import { semanticClaimSimilarity } from "./semanticRecall.js";

/**
 * Same-case follow-up payload. The user bubble shows `followUp`;
 * the orchestrate claim carries original + last answer so the next
 * round is not a new rumor check from a blank page.
 */

export const FOLLOW_UP_MARKER = "同一条核查的追问，不是新案件。";

const ANSWER_EXCERPT = 1200;

export function composeFollowUpClaim(input: {
  originalClaim: string;
  previousAnswer: string;
  followUp: string;
}): string {
  const followUp = input.followUp.trim();
  const original = input.originalClaim.trim();
  const answer = input.previousAnswer.trim().slice(0, ANSWER_EXCERPT);

  const lines = [followUp, "", `（${FOLLOW_UP_MARKER}）`, `原对象：${original}`];
  if (answer) {
    lines.push(`上一轮回答：${answer}`);
  }
  lines.push("请直接回答这次追问。需要新证据再检索。不要只重复上一轮结论。");
  return lines.join("\n");
}

export function previousAnswerText(report?: { conclusion?: string; memo?: string } | null): string {
  const conclusion = report?.conclusion?.trim();
  if (conclusion) return conclusion;
  return report?.memo?.trim() ?? "";
}

/**
 * 追问轮 originalClaim 的显示文本：只留用户自己写的那一段。
 * composeFollowUpClaim 拼出的整段是「用户追问 + 标记 + 原对象 + 上一轮回答」，
 * 追问本身可以是多行，所以裁到标记之前，不是截第一行；不含标记的原文原样返回。
 */
export function displayFollowUpClaim(originalClaim: string): string {
  if (typeof originalClaim !== "string") return "";
  const markerIndex = originalClaim.indexOf(FOLLOW_UP_MARKER);
  if (markerIndex === -1) return originalClaim;
  return originalClaim.slice(0, markerIndex).replace(/[\s\u3000]*[（(]\s*$/, "").trim();
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

/** 用户追问原文：裁到「同一条核查的追问」标记之前；没有标记则整段当追问。 */
export function followUpQuestionOf(claim: string): string {
  return displayFollowUpClaim(claim).trim();
}

/** 只做形状规范化（NFKC、小写、压缩空白、去句末标点），不做同义替换——同义与转述由相似度负责。 */
function normalizeAtomText(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。．.！!？?；;，,、：:…~～"'“”‘’）)】\]》>]+$/u, "")
    .trim();
}

/**
 * 人物/日期/链接变化 → 匹配不上：两边都出现数字/拉丁词或链接、且各自都有对方没有的
 * （2 月 5 日 vs 2 月 6 日、0.5mg vs 0.3mg、两条不同链接）才判冲突。
 * 只有一侧带数字/链接不算冲突——正常改写常常补一个时间或出处。
 */
function hasTokenConflict(a: string, b: string): boolean {
  const tokens = (text: string, pattern: RegExp) => new Set(text.match(pattern) ?? []);
  const wordsA = tokens(a, /[a-z0-9]+/g);
  const wordsB = tokens(b, /[a-z0-9]+/g);
  if (wordsA.size > 0 && wordsB.size > 0) {
    const onlyA = [...wordsA].some((token) => !wordsB.has(token));
    const onlyB = [...wordsB].some((token) => !wordsA.has(token));
    if (onlyA && onlyB) return true;
  }
  const linksA = tokens(a, /https?:\/\/\S+/g);
  const linksB = tokens(b, /https?:\/\/\S+/g);
  return linksA.size > 0 && linksB.size > 0 && ![...linksA].some((link) => linksB.has(link));
}

/** 相似度门槛（0–100）取高：宁可多搜一句新问题，也不把「隔夜海鲜」当成「隔夜菜」。 */
const COVER_THRESHOLD = 50;

/** 追问是否已被这一条命题覆盖。人物/日期/链接冲突一律不算覆盖。 */
export function followUpCoveredByAtom(followUp: string, atom: string): boolean {
  const question = normalizeAtomText(followUpQuestionOf(followUp) || followUp);
  const target = normalizeAtomText(atom);
  if (!question || !target) return false;
  if (hasTokenConflict(question, target)) return false;
  if (question === target) return true;
  if (question.length >= 6 && target.length >= 6 && (question.includes(target) || target.includes(question))) return true;
  return semanticClaimSimilarity(question, target) >= COVER_THRESHOLD;
}

export function conclusionMissesFollowUp(lead: string, claim: string): boolean {
  if (!claim.includes(FOLLOW_UP_MARKER)) return false;
  const question = displayFollowUpClaim(claim);
  if (!question) return false;
  const clip = question.replace(/\s+/g, " ").trim().slice(0, 16);
  if (clip && lead.includes(clip)) return false;
  const terms = distinctiveFollowUpTerms(question);
  if (terms.some((term) => lead.includes(term))) return false;
  // 已经直接答了这句追问不算跑题；第一句在引另一条拆题才算顶替。
  const quoted = lead.match(/^「([^」]{8,})」/)?.[1];
  return quoted !== undefined && !followUpCoveredByAtom(question, quoted);
}

export function followUpQuestionLead(
  question: string,
  judgment: "supported" | "refuted" | "mixed" | "disputed" | "unresolved" | "not-applicable"
): string {
  const clipped = question.replace(/\s+/g, " ").trim();
  const q = clipped.length > 42 ? `${clipped.slice(0, 42)}…` : clipped;
  if (judgment === "supported") return `这句追问「${q}」站得住。`;
  if (judgment === "refuted") return `这句追问「${q}」站不住。`;
  if (judgment === "mixed") return `这句追问「${q}」有站住的部分，也有没站住的。`;
  if (judgment === "disputed") return `这句追问「${q}」权威来源之间说法不一致。`;
  return `这句追问「${q}」现有材料还撑不住判断。`;
}

/**
 * 访客追问：上一轮对用户可见的材料（命题、判断、可点开出处、结论）。
 * 不带内部拼接指令、finding / limitation、命题 id、provenance。
 */
export type VisiblePriorEvidence = {
  url: string;
  title: string;
  excerpt: string;
  role: "support" | "contradict";
};

export type VisiblePriorClaim = {
  text: string;
  judgment: "supported" | "refuted" | "mixed";
  evidence: VisiblePriorEvidence[];
};

export type VisiblePriorRound = {
  originalClaim: string;
  conclusion: string;
  claims: VisiblePriorClaim[];
  checkedAt?: string;
};

const HTTP_URL = /^https?:\/\//i;
const CLAIM_CAP = 8;
const EVIDENCE_CAP = 8;

function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function visiblePriorRoundFromSnapshot(
  snapshot: InvestigationSnapshotV1 | null | undefined
): VisiblePriorRound | null {
  if (!snapshot) return null;
  const claims: VisiblePriorClaim[] = [];
  for (const claim of snapshot.claims) {
    if (claim.checkability !== "checkable") continue;
    const judgment = claim.judgment;
    if (judgment !== "supported" && judgment !== "refuted" && judgment !== "mixed") continue;
    const evidence: VisiblePriorEvidence[] = [];
    const seenUrl = new Set<string>();
    for (const link of claim.evidence) {
      if (link.role !== "support" && link.role !== "contradict") continue;
      const source = snapshot.sources.find((item) => item.id === link.sourceId);
      if (!source || !HTTP_URL.test(source.url) || seenUrl.has(source.url)) continue;
      seenUrl.add(source.url);
      evidence.push({
        url: source.url,
        title: clip(source.title || "", 200),
        excerpt: clip(source.excerpt || "", 320),
        role: link.role,
      });
      if (evidence.length >= EVIDENCE_CAP) break;
    }
    if (evidence.length === 0) continue;
    claims.push({ text: clip(claim.text, 240), judgment, evidence });
    if (claims.length >= CLAIM_CAP) break;
  }
  if (claims.length === 0) return null;
  return {
    originalClaim: clip(displayFollowUpClaim(snapshot.originalClaim), 500),
    conclusion: clip(snapshot.conclusion?.directAnswer ?? "", 800),
    ...(snapshot.checkedAt ? { checkedAt: snapshot.checkedAt } : {}),
    claims,
  };
}
