/** 结果页可见文案：丢掉内部标识整句、管线 [n] 编号。与 server publicCopy 同口径。 */

const INTERNAL_SENTENCE_RE = /wholeClaimAudit|whole_claim_auditor|WholeClaimAudit|wholeClaimAuditPlan|\bAgent:\w+/i;

export function scrubFaceText(text: string): string {
  if (!text) return "";
  return text
    .split(/(?<=[。！？；\n])/)
    .filter((part) => !INTERNAL_SENTENCE_RE.test(part))
    .join("")
    .replace(/\[\d+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？，、])/g, "$1")
    .trim();
}

export function tooSimilarTo(candidate: string, corpus: string): boolean {
  const needle = scrubFaceText(candidate).replace(/\s+/g, "");
  const hay = scrubFaceText(corpus).replace(/\s+/g, "");
  if (needle.length < 8 || hay.length < 8) return false;
  return hay.includes(needle) || needle.includes(hay.slice(0, Math.min(32, hay.length)));
}
