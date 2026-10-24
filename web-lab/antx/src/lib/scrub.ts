// 显示前的文字清理：不出现模型名 / 检索服务名，原句的组成部分一律叫「点」。
import { plainPartWording } from "@shared/investigation/material.ts";
import { scrubFaceText } from "@shared/scrubFace.ts";

/** 检索服务、模型服务的名字（含 publicStream 的 provider 清单与 search/providers 的标签）。 */
const SERVICE_NAME_RE =
  /\b(?:minimax|stepfun|deepseek|360gpt|ai360|mimo|anthropic|openai|moonshot|kimi|anysearch|metaso|tavily|exa|bocha|serper|brave|jina|perplexity|gpt-[\w.-]+|claude[\w.-]*|step-[\w.-]+|abab[\w.-]*)\b|360\s*(?:AI\s*)?(?:search|搜索)|阶跃(?:星辰)?|秘塔|博查|MiniMax|StepFun/gi;

export function hasServiceName(text: string): boolean {
  SERVICE_NAME_RE.lastIndex = 0;
  return SERVICE_NAME_RE.test(text);
}

/** 读到一半的「截断」等词也换掉，界面上不出现「截」字。 */
function noJieWord(text: string): string {
  return plainPartWording(text)
    .replace(/被截断|截断/g, "不完整")
    .replace(/截图/g, "图片")
    .replace(/截至/g, "到")
    .replace(/截然/g, "完全")
    .replace(/截/g, "点");
}

/** 普通正文：去服务名、去内部词，保留 [n]。 */
export function cleanText(text: unknown): string {
  if (typeof text !== "string") return "";
  return noJieWord(text.replace(SERVICE_NAME_RE, "检索服务")).trim();
}

/** 结论 / 理由：沿用共享的 scrubFaceText，但保留句内 [n] 角标。 */
export function cleanCitedText(text: unknown): string {
  if (typeof text !== "string" || !text) return "";
  return text
    .split(/(\[\d+\])/)
    .map((piece) => (/^\[\d+\]$/.test(piece) ? piece : scrubFaceText(cleanText(piece))))
    .join("");
}

/** 列表条目：提到服务名的整条不显示。 */
export function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === "string" ? item : typeof item === "object" && item ? String((item as Record<string, unknown>).text ?? (item as Record<string, unknown>).claimAtom ?? "") : ""))
    .filter((item) => item.trim() && !hasServiceName(item))
    .map(cleanText);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function seconds(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}分${Math.round((ms % 60_000) / 1000)}秒`;
}
