import { extractAnthropicText, extractAnthropicThinking, readAnthropicSse } from "../anthropicParse.js";
import { emptyReplyError, fetchModel, providerHttpError } from "./provider.js";

/** Anthropic Messages protocol, shared by every provider that speaks it. */
export async function callAnthropicMessages({
  label,
  url,
  headers,
  model,
  system,
  user,
  maxTokens,
  extraBody = {},
  stream = false,
  signal,
}: {
  label: string;
  url: string;
  headers: Record<string, string>;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  extraBody?: Record<string, unknown>;
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<{ text: string; reasoning?: string }> {
  const response = await fetchModel(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", ...headers },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      ...extraBody,
      ...(stream ? { stream: true } : {}),
    }),
    signal,
  });
  if (!response.ok) throw providerHttpError(label, (await response.text()).slice(0, 500));

  let text: string;
  let reasoning: string;
  let ending: string;
  if (stream && response.body) {
    const streamed = await readAnthropicSse(response.body);
    text = streamed.text;
    reasoning = streamed.thinking;
    ending = `stop_reason=${streamed.stopReason ?? (streamed.sawMessageStop ? "none" : "stream-ended-early")}, output_tokens=${streamed.outputTokens ?? "?"}`;
  } else {
    const raw = await response.text();
    text = extractAnthropicText(raw);
    reasoning = extractAnthropicThinking(raw);
    ending = describeMessage(raw);
  }
  text = text.trim();
  if (!text) {
    throw emptyReplyError(label, `。${ending}, max_tokens=${maxTokens}, content_types=${reasoning ? "thinking" : "none"}`);
  }
  return { text, reasoning: reasoning.trim() || undefined };
}

function describeMessage(raw: string): string {
  let data: {
    content?: Array<{ type?: string }>;
    stop_reason?: string;
    usage?: { output_tokens?: number };
  } | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return `content_blocks=${blocks.map((b) => b.type).join(",") || "empty"}, stop_reason=${data?.stop_reason ?? "?"}, output_tokens=${data?.usage?.output_tokens ?? "?"}`;
}
