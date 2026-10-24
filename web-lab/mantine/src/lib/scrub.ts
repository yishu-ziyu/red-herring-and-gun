/**
 * 界面上不出现检索服务名、模型名、provider 名。后端公开流已经清洗过一轮，
 * 但 agent 产出里的自由文本（来源审核的可疑来源清单、思考过程）仍可能提到它们：含这些名字的条目整条不显示。
 */
const VENDOR_RE =
  /minimax|stepfun|阶跃|deepseek|anthropic|openai|moonshot|kimi|mimo|claude|gpt-?\d|qwen|通义|豆包|doubao|tavily|metaso|秘塔|anysearch|any_search|exa[\s_-]?search|360\s*(ai|search|搜索)|ai360|360gpt|coding-plan|bocha|博查|serper|bing\s*api|google\s*search\s*api|检索通道/i;

export function mentionsVendor(text: string): boolean {
  return VENDOR_RE.test(text);
}

/** 列表：去掉提到服务名的条目。 */
export function cleanList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((item) => !mentionsVendor(item));
}

/** 段落：按句切开，去掉提到服务名的句子。 */
export function cleanText(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .split(/(?<=[。！？；.!?\n])/)
    .filter((part) => !mentionsVendor(part))
    .join("")
    .trim();
}

/** 代码与模型都可能把「点」写成「截」；界面一律叫「点」。 */
export function plainPart(text: string): string {
  return text.replace(/(两|三|四|五|几|各|每|这一|那一|另一|某一|一)截(?![图断止至取])/g, "$1点");
}
