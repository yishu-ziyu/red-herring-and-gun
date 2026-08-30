import { readAnthropicSse } from "../anthropicParse.js";
import {
  miniMaxCallOptions,
  miniMaxMaxTokensForModel,
} from "../minimaxM3.js";
import { envValue, getMiniMaxApiKey } from "../providerRouter.js";
import type { LoopLlm, LoopMessage } from "./types.js";

function miniMaxMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/anthropic")) return `${normalized}/v1/messages`;
  if (/localhost|127\.0\.0\.1/.test(normalized)) return `${normalized}/v1/messages`;
  return `${normalized}/anthropic/v1/messages`;
}

function messagesForAnthropic(messages: LoopMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of messages) {
    const content = msg.content?.trim();
    if (!content) continue;
    const role = msg.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  if (out.length === 0) out.push({ role: "user", content: "请开始核查。" });
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: "请开始核查。" });
  return out;
}

export function createLoopLlm(opts: {
  env: Record<string, string>;
  model?: string;
}): LoopLlm {
  const env = opts.env;
  const apiKey = getMiniMaxApiKey(env);
  if (!apiKey) {
    throw new Error("未配置 MINIMAX_API_KEY / MINIMAX_TOKEN_PLAN_KEY");
  }
  const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(
    /\/$/,
    ""
  );
  const model = (opts.model || envValue(env, "MINIMAX_MODEL") || "MiniMax-M2.7-highspeed").trim();
  const authHeader =
    envValue(env, "MINIMAX_AUTH_HEADER").toLowerCase() === "bearer" ? "bearer" : "x-api-key";
  const { maxTokens, thinking } = miniMaxCallOptions(
    env,
    model,
    miniMaxMaxTokensForModel(env, model, 4096)
  );

  return async ({ systemPrompt, messages, onThinking }) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (authHeader === "bearer") headers.Authorization = `Bearer ${apiKey}`;
    else headers["x-api-key"] = apiKey;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messagesForAnthropic(messages),
      stream: true,
    };
    if (thinking === "adaptive" || thinking === "disabled") {
      body.thinking = { type: thinking };
    }

    const response = await fetch(miniMaxMessagesUrl(baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
    }

    if (!text && !reasoning) {
      throw new Error("MiniMax API 没有返回可解析文本");
    }
    return { text: text || "", thinking: reasoning || undefined };
  };
}

export function modelFromChoice(
  modelChoice: unknown,
  fallback = "MiniMax-M2.7-highspeed"
): string {
  if (!modelChoice || typeof modelChoice !== "object") return fallback;
  const rec = modelChoice as Record<string, { model?: string }>;
  const from =
    rec.rumor_detector?.model ||
    rec.fact_checker?.model ||
    rec.report_composer?.model;
  return typeof from === "string" && from.trim() ? from.trim() : fallback;
}
