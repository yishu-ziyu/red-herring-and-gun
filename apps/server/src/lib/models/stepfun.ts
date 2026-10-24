import { getTimeoutMs } from "../executionBudget.js";
import { callAnthropicMessages } from "./anthropicClient.js";
import {
  emptyReplyError,
  envValue,
  fetchModel,
  modelFromEnv,
  providerHttpError,
  type ModelProvider,
  type ModelRequest,
} from "./provider.js";

type ReasoningEffort = "low" | "medium" | "high";

// The reasoning model rejects response_format / temperature / reasoning_effort with a 400.
const isReasoningModel = (model: string) => /^step-3\.7-flash$/i.test(model);

function maxTokensFor(env: Record<string, string>, model: string, requested: number): number {
  if (!isReasoningModel(model)) return requested;
  const floor = Number(envValue(env, "STEPFUN_3_7_MIN_MAX_TOKENS") || 4096);
  return Number.isFinite(floor) && floor > requested ? floor : requested;
}

function reasoningEffort(env: Record<string, string>): ReasoningEffort {
  const raw = envValue(env, "STEPFUN_REASONING_EFFORT").toLowerCase();
  return raw === "low" || raw === "medium" ? raw : "high";
}

/**
 * The Token Plan base URL (.../step_plan) serves OpenAI chat at /v1/chat/completions,
 * not at /chat/completions (404); the plain base URL (.../v1) already carries /v1.
 */
function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.includes("/step_plan")) return `${base.replace(/\/v1$/, "")}/v1/chat/completions`;
  return `${base}/chat/completions`;
}

function chatText(data: any): string {
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

function describeEmptyChat(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason || choice?.finishReason || "unknown";
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  return `finish_reason=${finishReason}, content_type=${typeof message?.content}, reasoning_chars=${reasoning.length}`;
}

async function callChat(
  { env, model, system, user, images, maxTokens, signal }: ModelRequest,
  baseUrl: string,
  apiKey: string
) {
  const withImages = Boolean(images?.length);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: withImages
          ? [{ type: "text", text: user }, ...images!.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } }))]
          : user,
      },
    ],
    max_tokens: maxTokensFor(env, model, maxTokens),
  };
  if (!isReasoningModel(model)) {
    body.response_format = { type: "json_object" };
    body.temperature = withImages ? 0.1 : 0.3;
    if (!withImages) body.reasoning_effort = reasoningEffort(env);
  }
  const response = await fetchModel(chatCompletionsUrl(baseUrl), {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw providerHttpError("StepFun", data?.error?.message || data?.message || response.statusText);
  }
  const text = chatText(data);
  if (!text) throw emptyReplyError("StepFun", `（${describeEmptyChat(data)}）。`);
  const reasoning = typeof data?.choices?.[0]?.message?.reasoning === "string" ? data.choices[0].message.reasoning.trim() : "";
  return { text, reasoning: reasoning || undefined };
}

export const stepfun: ModelProvider = {
  id: "stepfun",
  vision: true,
  apiKeyEnv: "STEPFUN_API_KEY",
  configured: (env) => Boolean(envValue(env, "STEPFUN_API_KEY")),
  modelFor: (env, agentId, withImages) =>
    modelFromEnv(env, "STEPFUN", withImages ? "vision" : agentId, withImages ? "step-3.7-flash" : "step-2-mini"),
  timeoutMs: (env, model) =>
    isReasoningModel(model) ? getTimeoutMs(env, "STEPFUN_3_7_PROVIDER_TIMEOUT_MS", 135000) : undefined,
  skipAfterTimeouts: () => 2,
  async call(request) {
    const { env, model, system, user, images, maxTokens, signal } = request;
    const apiKey = envValue(env, "STEPFUN_API_KEY");
    const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
    const reply = !images?.length && baseUrl.includes("/step_plan")
      // Token Plan text calls speak the Anthropic protocol: Bearer auth, no response_format.
      ? await callAnthropicMessages({
          label: "StepFun",
          url: `${baseUrl}/v1/messages`,
          headers: { Authorization: `Bearer ${apiKey}` },
          model,
          system,
          user,
          maxTokens: maxTokensFor(env, model, maxTokens),
          signal,
        })
      : await callChat(request, baseUrl, apiKey);
    return { ...reply, model: `stepfun:${model}` };
  },
};
