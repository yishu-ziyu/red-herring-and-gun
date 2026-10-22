/** 结果页可见文案：丢掉内部标识整句、管线 [n] 编号、检索来源序号。服务端 publicCopy 共用这几条正则。 */

/** 含内部标识的句子整句拿掉，避免只删单词留下半句。 */
export const INTERNAL_SENTENCE_RE = /wholeClaimAudit|whole_claim_auditor|WholeClaimAudit|wholeClaimAuditPlan|\bAgent:\w+/i;
/** 检索曾把来源标成 S1/C1。可见正文里拿掉序号，不碰句内 [n] 绑定。 */
export const SOURCE_ALIAS_RE = /\b[SC]\d+(?:\s*[/、,，]\s*[SC]\d+)*(?:将|把|中)?/g;
/** 模型把 schema 词写进解释：`claim中「…」`；先删「claim中」再删孤立 claim，避免留下「中「」。 */
export const SCHEMA_ZH_RE = /claim中/gi;
export const SCHEMA_WORD_RE = /\b(?:claimAtom|subclaim|verdictType|atomSearches|claim)\b/gi;
/** 400 字截断留下的半截拉丁残字，紧贴下一段引号：`IA「「微波炉`。完整 IARC（4 字母）不动。 */
export const TRUNCATED_LATIN_BEFORE_QUOTE_RE = /[A-Za-z]{1,3}(?=「)/g;

export function scrubFaceText(text: string): string {
  if (!text) return "";
  return text
    .split(/(?<=[。！？；\n])/)
    .filter((part) => !INTERNAL_SENTENCE_RE.test(part))
    .join("")
    .replace(SCHEMA_ZH_RE, "")
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
