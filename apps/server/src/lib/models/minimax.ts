import { getTimeoutMs } from "../executionBudget.js";
import { callAnthropicMessages } from "./anthropicClient.js";
import { envValue, modelFromEnv, type ModelProvider } from "./provider.js";

// thinking counts toward max_tokens, so the budget has to hold both the thinking and the answer.
const M3_RECOMMENDED_MAX_TOKENS = 131072;
const M3_ABSOLUTE_MAX_TOKENS = 524288;
const M3_DEFAULT_TIMEOUT_MS = 600000;
const M27_DEFAULT_TIMEOUT_MS = 180000;
// M3 adaptive thinking can hang for minutes; one such timeout is enough to skip the provider.
const HANG_TIMEOUT_MS = 300_000;

const isM3 = (model: string) => /^MiniMax-M3$/i.test(model);
const isM27 = (model: string) => /^MiniMax-M2\.7(?:-highspeed)?$/i.test(model);

function maxTokensFor(env: Record<string, string>, model: string, requested: number): number {
  if (isM27(model)) {
    const explicitFloor = Number(envValue(env, "MINIMAX_M27_MIN_MAX_TOKENS"));
    const floor = Number.isFinite(explicitFloor) && explicitFloor > 0 ? explicitFloor : 4096;
    return Math.max(requested, Math.floor(floor));
  }
  if (!isM3(model)) return requested;
  const explicit = Number(envValue(env, "MINIMAX_M3_MAX_TOKENS"));
  const floor = Number(envValue(env, "MINIMAX_M3_MIN_MAX_TOKENS"));
  let budget = Number.isFinite(explicit) && explicit > 0 ? explicit : M3_RECOMMENDED_MAX_TOKENS;
  if (Number.isFinite(floor) && floor > 0) budget = Math.max(budget, floor);
  budget = Math.min(Math.floor(budget), M3_ABSOLUTE_MAX_TOKENS);
  return Math.max(requested, budget);
}

function thinkingFor(env: Record<string, string>, model: string): "adaptive" | "disabled" | undefined {
  if (!isM3(model)) return undefined;
  const raw = envValue(env, "MINIMAX_M3_THINKING").toLowerCase();
  return raw === "disabled" || raw === "off" ? "disabled" : "adaptive";
}

function messagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/anthropic")) return `${normalized}/v1/messages`;
  // Local Anthropic proxy (127.0.0.1:15721) serves /v1/messages directly.
  if (/localhost|127\.0\.0\.1/.test(normalized)) return `${normalized}/v1/messages`;
  return `${normalized}/anthropic/v1/messages`;
}

export const minimax: ModelProvider = {
  id: "minimax",
  vision: false,
  apiKeyEnv: "MINIMAX_API_KEY",
  configured: (env) => Boolean(envValue(env, "MINIMAX_API_KEY")),
  modelFor: (env, agentId) => modelFromEnv(env, "MINIMAX", agentId, "MiniMax-M2.7-highspeed"),
  timeoutMs(env, model) {
    if (isM3(model)) return getTimeoutMs(env, "MINIMAX_M3_PROVIDER_TIMEOUT_MS", M3_DEFAULT_TIMEOUT_MS);
    if (isM27(model)) return getTimeoutMs(env, "MINIMAX_M27_PROVIDER_TIMEOUT_MS", M27_DEFAULT_TIMEOUT_MS);
    return undefined;
  },
  skipAfterTimeouts: (model, timeoutMs) => (isM3(model) || timeoutMs >= HANG_TIMEOUT_MS ? 1 : 2),
  async call({ env, model, system, user, maxTokens, signal }) {
    const baseUrl = envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic";
    const apiKey = envValue(env, "MINIMAX_API_KEY");
    const thinking = thinkingFor(env, model);
    const reply = await callAnthropicMessages({
      label: "MiniMax",
      url: messagesUrl(baseUrl),
      headers: envValue(env, "MINIMAX_AUTH_HEADER").toLowerCase() === "bearer"
        ? { Authorization: `Bearer ${apiKey}` }
        : { "x-api-key": apiKey },
      model,
      system,
      user,
      maxTokens: maxTokensFor(env, model, maxTokens),
      // Thinking models take no temperature; the others are asked for steady output.
      extraBody: thinking ? { thinking: { type: thinking } } : { temperature: 0 },
      stream: true,
      signal,
    });
    return { ...reply, model: `minimax:${model}` };
  },
};
