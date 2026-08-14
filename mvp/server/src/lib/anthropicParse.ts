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

/** 从 Anthropic 完整响应对象中拼接 content[*].text。保持纯净，避免 thinking 污染 JSON 解析。 */
export function extractAnthropicContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const content = (data as { content?: unknown }).content;
  if (typeof content === "string") return content;
  const items = Array.isArray(content) ? content : [];
  const parts: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.join("");
}

/** 空 text 时描述 stop_reason / content 块类型，区分 thinking-only 与真·空响应。 */
export function describeEmptyAnthropic(raw: string): string {
  try {
    const data = JSON.parse(raw) as {
      stop_reason?: unknown;
      stopReason?: unknown;
      content?: unknown;
      usage?: { output_tokens?: unknown; outputTokens?: unknown };
    };
    const items = Array.isArray(data.content) ? data.content : [];
    const types =
      items
        .map((item) =>
          item && typeof item === "object" && "type" in item && typeof item.type === "string"
            ? item.type
            : typeof item
        )
        .join(",") || (typeof data.content === "string" ? "string" : "none");
    const stop =
      (typeof data.stop_reason === "string" && data.stop_reason) ||
      (typeof data.stopReason === "string" && data.stopReason) ||
      "unknown";
    const outputTokens = data.usage?.output_tokens ?? data.usage?.outputTokens;
    const usageBit = outputTokens != null ? ` output_tokens=${outputTokens}` : "";
    return `stop_reason=${stop}, content_types=${types}${usageBit}`;
  } catch {
    return `raw_chars=${raw.length}`;
  }
}

/** 从 Anthropic 兼容响应中提取思考文本（MiniMax-M3 的 content[*].thinking）。无则返回空串。 */
export function extractAnthropicThinking(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const content = (data as { content?: unknown }).content;
      const items = Array.isArray(content) ? content : [];
      const thoughts: string[] = [];
      for (const item of items) {
        if (item && typeof item === "object") {
          const th = (item as { thinking?: unknown }).thinking;
          if (typeof th === "string" && th.trim()) thoughts.push(th);
        }
      }
      return thoughts.join("\n\n");
    } catch {
      return "";
    }
  }
  return "";
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

export type AnthropicSseDelta = {
  thinkingChunk?: string;
  textChunk?: string;
};

/** Parse one SSE `data:` payload from an Anthropic-compatible stream. */
export function parseAnthropicSseDataLine(dataText: string): AnthropicSseDelta | null {
  const trimmed = dataText.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    const event = JSON.parse(trimmed) as {
      type?: string;
      delta?: { type?: string; text?: unknown; thinking?: unknown };
      content_block?: { type?: string; text?: unknown; thinking?: unknown };
    };
    const delta = event.delta ?? {};
    const thinkingChunk =
      typeof delta.thinking === "string"
        ? delta.thinking
        : event.type === "content_block_start" &&
            event.content_block?.type === "thinking" &&
            typeof event.content_block.thinking === "string"
          ? event.content_block.thinking
          : "";
    const textChunk =
      typeof delta.text === "string"
        ? delta.text
        : event.type === "content_block_start" &&
            event.content_block?.type === "text" &&
            typeof event.content_block.text === "string"
          ? event.content_block.text
          : "";
    if (!thinkingChunk && !textChunk) return null;
    return {
      ...(thinkingChunk ? { thinkingChunk } : {}),
      ...(textChunk ? { textChunk } : {}),
    };
  } catch {
    return null;
  }
}

export async function readAnthropicSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: { thinkingChunk?: string; textChunk?: string }) => void
): Promise<{ text: string; thinking: string; rawTail: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let thinking = "";
  let blockType = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataText = line.slice(5).trim();
        if (!dataText || dataText === "[DONE]") continue;
        let event: {
          type?: string;
          delta?: { type?: string; text?: unknown; thinking?: unknown };
          content_block?: { type?: string; text?: unknown; thinking?: unknown };
        };
        try {
          event = JSON.parse(dataText);
        } catch {
          continue;
        }
        if (event.type === "content_block_start") {
          blockType = typeof event.content_block?.type === "string" ? event.content_block.type : "";
        }
        const delta = event.delta ?? {};
        const thinkingPiece =
          typeof delta.thinking === "string"
            ? delta.thinking
            : blockType === "thinking" && typeof delta.text === "string"
              ? delta.text
              : event.type === "content_block_start" &&
                  event.content_block?.type === "thinking" &&
                  typeof event.content_block.thinking === "string"
                ? event.content_block.thinking
                : "";
        const textPiece =
          blockType === "thinking"
            ? ""
            : typeof delta.text === "string"
              ? delta.text
              : event.type === "content_block_start" &&
                  event.content_block?.type === "text" &&
                  typeof event.content_block.text === "string"
                ? event.content_block.text
                : "";
        if (thinkingPiece) {
          thinking += thinkingPiece;
          onDelta({ thinkingChunk: thinkingPiece });
        }
        if (textPiece) {
          text += textPiece;
          onDelta({ textChunk: textPiece });
        }
        if (event.type === "content_block_stop") blockType = "";
      }
    }
  } finally {
    reader.releaseLock();
  }
  const rawTail = (buffer + decoder.decode()).trim();
  if (!text && !thinking && rawTail.startsWith("{")) {
    text = extractAnthropicText(rawTail);
    thinking = extractAnthropicThinking(rawTail);
  }
  return { text, thinking, rawTail };
}
