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
  priorFollowUps?: string[];
}): string {
  const followUp = input.followUp.trim();
  const original = input.originalClaim.trim();
  const answer = input.previousAnswer.trim().slice(0, ANSWER_EXCERPT);
  const prior = (input.priorFollowUps ?? []).map((item) => item.trim()).filter(Boolean);

  const lines = [followUp, "", `（${FOLLOW_UP_MARKER}）`, `原对象：${original}`];
  if (prior.length > 0) {
    lines.push(`此前追问：${prior.join(" / ")}`);
  }
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

export function conclusionMissesFollowUp(lead: string, claim: string): boolean {
  if (!claim.includes(FOLLOW_UP_MARKER)) return false;
  const question = displayFollowUpClaim(claim);
  if (!question) return false;
  const clip = question.replace(/\s+/g, " ").trim().slice(0, 16);
  if (clip && lead.includes(clip)) return false;
  const terms = distinctiveFollowUpTerms(question);
  if (terms.some((term) => lead.includes(term))) return false;
  // 已经直接答了这句追问不算跑题；第一句在引另一条拆题才算顶替。
  return /^「[^」]{8,}」/.test(lead);
}

export function followUpQuestionLead(
  question: string,
  judgment: "supported" | "refuted" | "mixed" | "unresolved" | "not-applicable"
): string {
  const clipped = question.replace(/\s+/g, " ").trim();
  const q = clipped.length > 42 ? `${clipped.slice(0, 42)}…` : clipped;
  if (judgment === "supported") return `这句追问「${q}」站得住。`;
  if (judgment === "refuted") return `这句追问「${q}」站不住。`;
  if (judgment === "mixed") return `这句追问「${q}」有站住的部分，也有没站住的。`;
  return `这句追问「${q}」现有材料还撑不住判断。`;
}
