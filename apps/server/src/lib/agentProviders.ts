// ───────────────────────────────────────────────────────────────
// Server-side LLM provider HTTP adapters
// 为 4-Agent pipeline 提供 LLM provider 的 OpenAI / Anthropic 兼容调用
// 任何 router（callAgentWithFallback）通过 import 这些函数调度
// ───────────────────────────────────────────────────────────────

// 审查 P3-2 修复：extractAnthropicText 从共享模块引入并 re-export，
// 不再在本文件维护独立副本（原 line 47-87 本地定义已删除）。
// 用 import + export 双语句让本文件内调用点也能解析（纯 re-export 不引入本地绑定）。
import { extractAnthropicText, extractAnthropicThinking, readAnthropicSse } from "./anthropicParse.js";
export { extractAnthropicText };
import {
  buildMiniMaxMessagesBody,
  isMiniMaxM3,
  type MiniMaxThinkingType,
} from "./minimaxM3.js";

// ───────────────────────────────────────────────────────────────
// Response text extractors（OpenAI 兼容 / Anthropic 兼容 / 空响应诊断）
// ───────────────────────────────────────────────────────────────

/**
 * 从 OpenAI 兼容协议的 JSON 响应中提取首个 choice 的文本。
 * 支持 content 是 string 或 array-of-parts（reasoning 模型常见）两种形态。
 */
export function extractChatCompletionText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * 当 OpenAI 兼容响应返回空文本时，描述 finish_reason / content 类型 / 推理长度，
 * 方便定位是 length_truncated 还是 reasoning_only 等场景。
 */
export function describeEmptyChatCompletion(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason || choice?.finishReason || "unknown";
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  return `finish_reason=${finishReason}, content_type=${typeof message?.content}, reasoning_chars=${reasoning.length}`;
}

// ───────────────────────────────────────────────────────────────
// Provider: StepFun 阶跃星辰（OpenAI 兼容 + reasoning_effort）
// ───────────────────────────────────────────────────────────────

// Reasoning 系列模型（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
// 三者皆会触发 400 Invalid request。仅 chat 模型才发这些字段。
export function buildStepFunRequestBody({
  model,
  messages,
  maxTokens,
  responseFormat,
  temperature,
  reasoningEffort,
}: {
  model: string;
  messages: unknown[];
  maxTokens: number;
  responseFormat?: { type: "json_object" };
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Record<string, unknown> {
  const isReasoning = /^step-3\.7-flash$/i.test(model);
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
  };
  if (!isReasoning) {
    if (responseFormat !== undefined) body.response_format = responseFormat;
    if (temperature !== undefined) body.temperature = temperature;
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort;
  }
  return body;
}

/**
 * StepFun 的 OpenAI 兼容聊天补全地址。
 * Token Plan 基础地址（.../step_plan，Anthropic 协议文字调用用它）下 OpenAI 兼容路径是 /v1/chat/completions，
 * 直接拼 /chat/completions 会 404（R10）；普通基础地址（.../v1）本身已带 /v1。
 */
export function stepFunChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.includes("/step_plan")) return `${base.replace(/\/v1$/, "")}/v1/chat/completions`;
  return `${base}/chat/completions`;
}

export async function callStepFunAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  reasoningEffort = "high",
  signal,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}) {
  // Token Plan（Anthropic 协议）：/step_plan 前缀走 /v1/messages + Bearer，非流式。
  if (baseUrl.includes("/step_plan")) {
    return callStepFunPlanAgent({ baseUrl, apiKey, model, systemPrompt, userContent, maxTokens, signal });
  }
  // Reasoning 系列模型（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
  // 三者皆会触发 400 Invalid request。仅 chat 模型才发这些字段。
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildStepFunRequestBody({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        maxTokens,
        responseFormat: { type: "json_object" },
        temperature: 0.3,
        reasoningEffort,
      })
    ),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`StepFun API 调用失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error(`StepFun API 没有返回可解析文本（${describeEmptyChatCompletion(data)}）。`);

  // 推理模型（step-3.7-flash）的 thinking 文本在 message.reasoning 一次性返回。
  // 当前走非流式调用，无增量 chunk；reasoning 为空时不下发（不展示假思考）。
  const reasoning =
    typeof data?.choices?.[0]?.message?.reasoning === "string"
      ? (data.choices[0].message.reasoning as string).trim()
      : "";

  return { text, model: `stepfun:${model}`, ...(reasoning ? { reasoning } : {}) };
}

/**
 * StepFun Token Plan — Anthropic 协议端点（https://api.stepfun.com/step_plan/v1/messages）。
 * Bearer 认证；content 块数组（thinking + text）；无 response_format，JSON 靠 prompt 约束 + 下游 parseAgentJson。
 */
export async function callStepFunPlanAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  signal,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  signal?: AbortSignal;
}) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`StepFun API 调用失败：${raw.slice(0, 500)}`);
  }

  let data: {
    content?: Array<{ type?: string; text?: string; thinking?: string }>;
  } | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  const blocks = Array.isArray(data?.content) ? data!.content : [];
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  const reasoning = blocks
    .filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking as string)
    .join("")
    .trim();

  if (!text) throw new Error(`StepFun API 没有返回可解析文本（content_blocks=${blocks.map((b) => b.type).join(",") || "empty"}）。`);
  return { text, model: `stepfun:${model}`, ...(reasoning ? { reasoning } : {}) };
}

// ───────────────────────────────────────────────────────────────
// Provider: MiniMax（Anthropic-compatible API；使用 Bearer 认证）
// ───────────────────────────────────────────────────────────────

export async function callMiniMaxAgent({
  baseUrl,
  apiKey,
  authHeader = "x-api-key",
  model,
  systemPrompt,
  userContent,
  maxTokens,
  thinking,
  signal,
  onThinking,
  temperature,
}: {
  baseUrl: string;
  apiKey: string;
  authHeader?: "x-api-key" | "bearer";
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  thinking?: MiniMaxThinkingType;
  signal?: AbortSignal;
  onThinking?: (accumulated: string) => void;
  temperature?: number;
}) {
  const url = miniMaxMessagesUrl(baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (authHeader === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }
  const thinkingMode: MiniMaxThinkingType | undefined =
    thinking ?? (isMiniMaxM3(model) ? "adaptive" : undefined);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(
      buildMiniMaxMessagesBody({
        model,
        systemPrompt,
        userContent,
        maxTokens,
        thinking: thinkingMode,
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
      })
    ),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`MiniMax API 调用失败：${raw.slice(0, 500)}`);
  }

  let text = "";
  let reasoning = "";
  if (response.body) {
    let thinkingAcc = "";
    const streamed = await readAnthropicSse(response.body, (delta) => {
      if (!delta.thinkingChunk) return;
      thinkingAcc += delta.thinkingChunk;
      onThinking?.(thinkingAcc);
    });
    text = streamed.text;
    reasoning = streamed.thinking || thinkingAcc;
    if (!text && !reasoning && streamed.rawTail) {
      text = extractAnthropicText(streamed.rawTail);
      reasoning = extractAnthropicThinking(streamed.rawTail);
    }
  } else {
    const raw = await response.text();
    text = extractAnthropicText(raw);
    reasoning = extractAnthropicThinking(raw);
    if (reasoning) onThinking?.(reasoning);
  }

  if (!text) {
    throw new Error(
      `MiniMax API 没有返回可解析文本。${
        reasoning ? "stop_reason=unknown, content_types=thinking" : "raw empty"
      }`
    );
  }
  return { text, model: `minimax:${model}`, reasoning: reasoning || undefined };
}

function miniMaxMessagesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/anthropic")) return `${normalized}/v1/messages`;
  // Local Anthropic proxy (127.0.0.1:15721) serves /v1/messages directly.
  if (/localhost|127\.0\.0\.1/.test(normalized)) return `${normalized}/v1/messages`;
  return `${normalized}/anthropic/v1/messages`;
}
