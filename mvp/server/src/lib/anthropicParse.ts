/**
 * anthropicParse.ts — Anthropic 兼容响应/SSE 文本提取 + JSON 块抽取共享模块
 *
 * 审查 P3-2 修复：extractAnthropicText / extractAnthropicContent / extractJsonObject
 * 原本在 handlers.ts、agentProviders.ts、mimoClient.ts、providerRouter.ts 四处独立实现，
 * 已抽到本文件统一维护，防止 drift。
 */

/**
 * 从 Anthropic 兼容响应中提取 text。
 * 支持两种入口：
 *   1. 完整 JSON 响应（{content:[{text}]}）
 *   2. SSE 流式（每行 `data: {delta:{text}}` 或 `data: {content_block:{text}}`）
 *
 * 任意 JSON 解析失败均静默返回 ""，避免单条坏事件中断整次提取。
 */
export function extractAnthropicText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return extractAnthropicContent(data);
    } catch {
      return "";
    }
  }

  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const dataText = line.slice(5).trim();
    if (!dataText || dataText === "[DONE]") continue;

    try {
      const event = JSON.parse(dataText);
      const deltaText = event?.delta?.text;
      if (typeof deltaText === "string") parts.push(deltaText);
      const blockText = event?.content_block?.text;
      if (event?.type === "content_block_start" && typeof blockText === "string") parts.push(blockText);
    } catch {
      continue;
    }
  }

  return parts.join("");
}

/** 从 Anthropic 完整响应对象中拼接 content[*].text。 */
export function extractAnthropicContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const content = (data as { content?: unknown }).content;
  const items = Array.isArray(content) ? content : [];
  const parts: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.join("");
}

/**
 * 从 LLM 输出中抽取第一个 `{...}` 块；容忍 ```json ``` 包裹。
 * 找不到匹配时返回 trimmed 原文。
 */
export function extractJsonObject(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}
