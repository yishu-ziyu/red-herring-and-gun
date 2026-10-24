/**
 * 公开流里仍可能夹着搜索服务名、模型名（agent 自己写的自由文本、思考片段）。
 * 界面只显示去掉这些句子之后的文字；结构化字段（providers、providerOrigins、model、toolName）一律不读。
 */
const VENDOR_RE =
  /\b360\b|360\s?(?:AI|搜索|Search)|Search\s?360|so\.com|AnySearch|Any Search|Metaso|秘塔|Tavily|\bExa\b|MiniMax|minimax|StepFun|stepfun|阶跃|Step Plan|Token Plan|DeepSeek|deepseek|Kimi|Moonshot|OpenAI|Anthropic|Claude|GPT-?\d|Gemini|mimo|ai360|检索通道|搜索服务|搜索引擎聚合|provider/i;

export function hasVendor(text: string): boolean {
  return VENDOR_RE.test(text);
}

/** 按句切开，去掉提到服务名 / 模型名的句子。 */
export function scrubVendor(text: string | undefined | null): string {
  if (!text) return "";
  const pieces = text.split(/(?<=[。！？；!?;\n])/);
  return pieces
    .filter((piece) => !VENDOR_RE.test(piece))
    .join("")
    .trim();
}

export function scrubList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && !VENDOR_RE.test(item));
}

/** 代码和模型文字里管原句的一部分叫「一截」，界面只说「点」；其他带「截」的词换成同义说法。 */
export function plainPoint(text: string): string {
  return text
    .replace(/(两|三|四|五|几|各|每|这一|那一|另一|某一|一)截/g, "$1点")
    .replace(/截图/g, "图片")
    .replace(/截断/g, "不完整")
    .replace(/截取/g, "摘取")
    .replace(/截至/g, "到")
    .replace(/截止/g, "到");
}

/** 界面上显示任何后端 / 模型文字前都过一遍。 */
export function clean(text: string | undefined | null): string {
  return plainPoint(scrubVendor(text));
}
