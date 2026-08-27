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
