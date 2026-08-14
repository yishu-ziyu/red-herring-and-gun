/**
 * Lightweight model-service health probe for the landing page.
 * Does not expose provider names, model IDs, or quota details.
 * Caps wall-clock so a probe cannot stall the homepage (~8s).
 */
import {
  areCloudProvidersHardSkipped,
  envValue,
  getMiniMaxApiKey,
  getSearch360ApiKey,
  isHardProviderFailure,
  noteProviderFailure,
  pendingCloudProviders,
  providerHasCredentials,
  type AgentTextProviderId,
} from "./providerRouter.js";

export type ModelServiceStatus = "available" | "unavailable" | "unknown";

export interface ModelServiceHealth {
  status: ModelServiceStatus;
  /** User-facing Chinese. Empty when available. */
  message: string;
}

export const MODEL_UNAVAILABLE_MESSAGE =
  "模型服务暂时不可用。这次可能给不出最终判断，但仍会尽量检索公开材料。";

export const MODEL_UNKNOWN_MESSAGE =
  "暂时无法确认模型服务是否可用。这次可能较久，也可能给不出最终判断；仍会尽量检索公开材料。";

const PROBE_TOTAL_MS = 8000;
const PROBE_ONE_MS = 2500;
const CLOUD_PROBE_CANDIDATES: AgentTextProviderId[] = ["deepseek", "stepfun", "360", "mimo", "minimax"];

function healthFor(status: ModelServiceStatus): ModelServiceHealth {
  if (status === "unavailable") return { status, message: MODEL_UNAVAILABLE_MESSAGE };
  if (status === "unknown") return { status, message: MODEL_UNKNOWN_MESSAGE };
  return { status: "available", message: "" };
}

function miniMaxMessagesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/anthropic")) return `${normalized}/v1/messages`;
  return `${normalized}/anthropic/v1/messages`;
}

async function pingWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body: body.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

async function pingProvider(
  env: Record<string, string>,
  provider: AgentTextProviderId,
  timeoutMs: number
): Promise<"ok" | "hard" | "soft"> {
  try {
    if (provider === "deepseek") {
      const apiKey = envValue(env, "DEEPSEEK_API_KEY");
      const baseUrl = (envValue(env, "DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, "");
      const model = envValue(env, "DEEPSEEK_MODEL") || "deepseek-v4-flash";
      const ping = await pingWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
        timeoutMs
      );
      if (ping.ok) return "ok";
      noteProviderFailure(provider, ping.body || `HTTP ${ping.status}`);
      return isHardProviderFailure(ping.body) ? "hard" : "soft";
    }

    if (provider === "stepfun") {
      const apiKey = envValue(env, "STEPFUN_API_KEY");
      const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
      const model = envValue(env, "STEPFUN_MODEL") || "step-2-mini";
      const ping = await pingWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
        timeoutMs
      );
      if (ping.ok) return "ok";
      noteProviderFailure(provider, ping.body || `HTTP ${ping.status}`);
      return isHardProviderFailure(ping.body) ? "hard" : "soft";
    }

    if (provider === "360") {
      const apiKey = getSearch360ApiKey(env);
      const baseUrl = (envValue(env, "AI360_BASE_URL") || "https://api.360.cn/v1").replace(/\/$/, "");
      const model = envValue(env, "AI360_CHAT_MODEL") || envValue(env, "AI360_MODEL") || "360gpt-turbo";
      const ping = await pingWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
        timeoutMs
      );
      if (ping.ok) return "ok";
      noteProviderFailure(provider, ping.body || `HTTP ${ping.status}`);
      return isHardProviderFailure(ping.body) ? "hard" : "soft";
    }

    if (provider === "mimo") {
      const apiKey = envValue(env, "MIMO_API_KEY");
      const baseUrl = (envValue(env, "MIMO_BASE_URL") || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(
        /\/$/,
        ""
      );
      const model = envValue(env, "MIMO_MODEL") || "mimo-v2.5-pro";
      const url = baseUrl.endsWith("/v1/messages") ? baseUrl : `${baseUrl}/v1/messages`;
      const ping = await pingWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        },
        timeoutMs
      );
      if (ping.ok) return "ok";
      noteProviderFailure(provider, ping.body || `HTTP ${ping.status}`);
      return isHardProviderFailure(ping.body) ? "hard" : "soft";
    }

    if (provider === "minimax") {
      const apiKey = getMiniMaxApiKey(env);
      const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
      const authHeader =
        envValue(env, "MINIMAX_AUTH_HEADER").toLowerCase() === "bearer" ? "bearer" : "x-api-key";
      // Avoid MiniMax-M3 adaptive thinking on a health ping.
      const model = envValue(env, "MINIMAX_HEALTH_MODEL") || "MiniMax-M2.7-highspeed";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };
      if (authHeader === "bearer") headers.Authorization = `Bearer ${apiKey}`;
      else headers["x-api-key"] = apiKey;
      const ping = await pingWithTimeout(
        miniMaxMessagesUrl(baseUrl),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            max_tokens: 8,
            messages: [{ role: "user", content: "ping" }],
          }),
        },
        timeoutMs
      );
      if (ping.ok) return "ok";
      noteProviderFailure(provider, ping.body || `HTTP ${ping.status}`);
      return isHardProviderFailure(ping.body) ? "hard" : "soft";
    }

    return "soft";
  } catch (error) {
    const message = error instanceof Error ? error.message : "probe failed";
    if (error instanceof Error && error.name === "AbortError") return "soft";
    noteProviderFailure(provider, message);
    return isHardProviderFailure(message) ? "hard" : "soft";
  }
}

/**
 * Probe a few configured chat providers with a short timeout.
 * available: at least one ping succeeded.
 * unavailable: skip-map already exhausted, or every attempted ping returned quota/auth.
 * unknown: probes timed out / network failed — do not pretend the service works.
 */
export async function probeModelServiceHealth(env: Record<string, string>): Promise<ModelServiceHealth> {
  if (!CLOUD_PROBE_CANDIDATES.some((provider) => providerHasCredentials(env, provider))) {
    return healthFor("unavailable");
  }
  if (areCloudProvidersHardSkipped(env)) {
    return healthFor("unavailable");
  }

  const deadline = Date.now() + PROBE_TOTAL_MS;
  const pending = pendingCloudProviders(env).filter((provider) => CLOUD_PROBE_CANDIDATES.includes(provider));
  const toTry = (pending.length > 0 ? pending : CLOUD_PROBE_CANDIDATES.filter((p) => providerHasCredentials(env, p))).slice(
    0,
    3
  );

  let hard = 0;
  let attempted = 0;

  for (const provider of toTry) {
    const remaining = deadline - Date.now();
    if (remaining < 400) break;
    attempted += 1;
    const result = await pingProvider(env, provider, Math.min(PROBE_ONE_MS, remaining));
    if (result === "ok") return healthFor("available");
    if (result === "hard") hard += 1;
  }

  if (attempted > 0 && hard === attempted && areCloudProvidersHardSkipped(env)) {
    return healthFor("unavailable");
  }
  if (attempted > 0 && hard === attempted) {
    return healthFor("unavailable");
  }
  return healthFor("unknown");
}
