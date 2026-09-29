/** 结果页可见文案：丢掉内部标识整句、管线 [n] 编号、检索来源序号。与 server publicCopy 同口径。 */

const INTERNAL_SENTENCE_RE = /wholeClaimAudit|whole_claim_auditor|WholeClaimAudit|wholeClaimAuditPlan|\bAgent:\w+/i;
const SOURCE_ALIAS_RE = /\b[SC]\d+(?:\s*[/、,，]\s*[SC]\d+)*(?:将|把|中)?/g;
/** 模型把 schema 词写进解释：`claim中「…」`；将 claim 译成说法，避免删词后留下残句。 */
const SCHEMA_ZH_RE = /\s*\b(?:claimAtom|subclaim|claim)\b\s*/gi;
const SCHEMA_WORD_RE = /\b(?:verdictType|atomSearches)\b/gi;
/** 400 字截断留下的半截拉丁残字，紧贴下一段引号：`IA「「微波炉`。完整 IARC（4 字母）不动。 */
const TRUNCATED_LATIN_BEFORE_QUOTE_RE = /[A-Za-z]{1,3}(?=「)/g;

export function scrubFaceText(text: string): string {
  if (!text) return "";
  return text
    .split(/(?<=[。！？；\n])/)
    .filter((part) => !INTERNAL_SENTENCE_RE.test(part))
    .join("")
    .replace(SCHEMA_ZH_RE, "说法")
    .replace(SCHEMA_WORD_RE, "")
    .replace(/\[\d+\]/g, "")
    .replace(SOURCE_ALIAS_RE, "")
    .replace(TRUNCATED_LATIN_BEFORE_QUOTE_RE, "")
    .replace(/「{2,}/g, "「")
    .replace(/」{2,}/g, "」")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？，、；：])/g, "$1")
    .replace(/^[，、；：\s]+/gm, "")
    .replace(/[，、]{2,}/g, "，")
    .trim();
}

/** 混入内部推理过程的边界不作为产品解释，避免删词后留下残句。 */
export function scrubBoundaryText(text: string): string {
  return INTERNAL_SENTENCE_RE.test(text) ? "" : scrubFaceText(text);
}

export function tooSimilarTo(candidate: string, corpus: string): boolean {
  const needle = scrubFaceText(candidate).replace(/\s+/g, "");
  const hay = scrubFaceText(corpus).replace(/\s+/g, "");
  if (needle.length < 8 || hay.length < 8) return false;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  const sentences = (text: string) =>
    scrubFaceText(text)
      .split(/[。！？；\n]/)
      .map((part) => part.replace(/\s+/g, ""))
      .filter((part) => part.length >= 12);
  return sentences(candidate).some((part) => hay.includes(part))
    || sentences(corpus).some((part) => needle.includes(part));
}
