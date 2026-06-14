// ───────────────────────────────────────────────────────────────
// Server-side provider router
// 把 server/src/handlers.ts 和 vite.config.ts 重复的 callAgentWithFallback 抽到一处。
// 行为以 server/src/handlers.ts 原实现为基线（per-agent routing、per-agent model、
// parseAgentJson 带 repair、API key 缺失 push 到 errors）。
// 调用方通过 options 注入 logger / onMissingApiKey 行为以匹配各自的差异。
// timeout 由调用方 outer-wrap（vite 自己有 per-agent 90-120s timeout），
// lib 不重复实现。
// ───────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  call360ChatAgent,
  callAnthropicAgent,
  callCodexAgent,
  callDeepSeekAgent,
  callMimoAgent,
  callStepFunAgent,
} from "./agentProviders.js";

export type AgentTextProviderId =
  | "deepseek"
  | "mimo"
  | "stepfun"
  | "360"
  | "anthropic"
  | "codex";

const TEXT_PROVIDER_IDS = new Set<AgentTextProviderId>([
  "deepseek",
  "mimo",
  "stepfun",
  "360",
  "anthropic",
  "codex",
]);

const DEFAULT_TEXT_PROVIDER_ORDER: AgentTextProviderId[] = [
  "deepseek",
  "mimo",
  "stepfun",
  "360",
  "anthropic",
  "codex",
];

// ───────────────────────────────────────────────────────────────
// Env helpers
// ───────────────────────────────────────────────────────────────

/** 优先从传入的 env 对象读（覆盖 process.env），缺省返回空串 */
export function envValue(env: Record<string, string>, key: string): string {
  return env[key] || process.env[key] || "";
}

/** 把 "rumor_detector" / "report-composer" 规整成 "RUMOR_DETECTOR" / "REPORT_COMPOSER" */
export function agentEnvKey(agentId?: string): string {
  return agentId ? agentId.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() : "";
}

/** 解析 ORCHESTRATE_<AGENT>_PROVIDER_ORDER / ORCHESTRATE_TEXT_PROVIDER_ORDER
 *  - 强制 deepseek 第一、codex 最后
 *  - 未识别的 provider 名静默丢弃
 *  - 去重
 *  - agentId 提供时优先 per-agent env
 */
export function providerOrderForAgent(
  env: Record<string, string>,
  agentId?: string
): AgentTextProviderId[] {
  const key = agentEnvKey(agentId);
  const raw =
    (key && envValue(env, `ORCHESTRATE_${key}_PROVIDER_ORDER`)) ||
    envValue(env, "ORCHESTRATE_TEXT_PROVIDER_ORDER") ||
    DEFAULT_TEXT_PROVIDER_ORDER.join(",");

  const order: AgentTextProviderId[] = [];
  for (const item of raw.split(",")) {
    const provider = item.trim().toLowerCase() as AgentTextProviderId;
    if (TEXT_PROVIDER_IDS.has(provider) && !order.includes(provider)) order.push(provider);
  }

  // deepseek 永远第一（保底）；codex 永远最后
  const withoutDeepSeek = order.filter((provider) => provider !== "deepseek");
  order.splice(0, order.length, "deepseek", ...withoutDeepSeek);
  if (!order.includes("codex")) order.push("codex");
  return order.length > 0 ? order : DEFAULT_TEXT_PROVIDER_ORDER;
}

/** 解析 <PREFIX>_<AGENT>_MODEL / <PREFIX>_MODEL / fallback
 *  例: modelForAgent(env, "DEEPSEEK", "rumor_detector", "deepseek-v4-pro")
 *      → env.DEEPSEEK_RUMOR_DETECTOR_MODEL ?? env.DEEPSEEK_MODEL ?? "deepseek-v4-pro"
 */
export function modelForAgent(
  env: Record<string, string>,
  prefix: string,
  agentId: string | undefined,
  fallback: string
): string {
  const key = agentEnvKey(agentId);
  return (key && envValue(env, `${prefix}_${key}_MODEL`)) || envValue(env, `${prefix}_MODEL`) || fallback;
}

/** 360 智脑 API key 多别名查找（兼容历史命名：QIHOO_360 → ZHINAO → AI360） */
export function getSearch360ApiKey(env: Record<string, string>): string {
  return (
    envValue(env, "QIHOO_360_API_KEY") ||
    envValue(env, "ZHINAO_API_KEY") ||
    envValue(env, "AI360_API_KEY")
  );
}

/** Anthropic proxy 配置：先读 env，再回退到 ~/.claude/settings.json */
export async function loadAnthropicConfig(
  env: Record<string, string>
): Promise<{ baseUrl: string; model: string; token: string } | undefined> {
  const explicitBaseUrl = envValue(env, "ANTHROPIC_BASE_URL");
  const explicitModel = envValue(env, "ANTHROPIC_MODEL");
  const explicitToken =
    envValue(env, "ANTHROPIC_AUTH_TOKEN") || envValue(env, "ANTHROPIC_API_KEY");

  if (explicitBaseUrl && explicitModel) {
    return {
      baseUrl: explicitBaseUrl.replace(/\/$/, ""),
      model: explicitModel,
      token: explicitToken || "local",
    };
  }

  try {
    const raw = await readFile(join(homedir(), ".claude/settings.json"), "utf8");
    const settings = JSON.parse(raw);
    const claudeEnv = settings?.env ?? {};
    const baseUrl = claudeEnv.ANTHROPIC_BASE_URL;
    const model = claudeEnv.ANTHROPIC_MODEL;
    const token = claudeEnv.ANTHROPIC_AUTH_TOKEN || claudeEnv.ANTHROPIC_API_KEY || "local";

    if (typeof baseUrl === "string" && typeof model === "string") {
      return { baseUrl: baseUrl.replace(/\/$/, ""), model, token };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

// ───────────────────────────────────────────────────────────────
// JSON repair + parse
// ───────────────────────────────────────────────────────────────

/** 从 LLM 输出中抽取第一个 {...} 块；容忍 ```json ``` 包裹 */
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

/** 尝试修复 LLM 输出的 loose JSON（尾随逗号、未加引号的值） */
function repairLooseJsonObject(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*([^"{\[\]\d\-tfn][^,\n\r}\]]*?)(?=\s*[,}\]])/g, (_match, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return ': ""';
      if (/^(true|false|null)$/i.test(trimmed)) return `: ${trimmed.toLowerCase()}`;
      return `: ${JSON.stringify(trimmed.replace(/^['"]|['"]$/g, ""))}`;
    });
}

/** 解析 LLM JSON 输出：先 extractJsonObject，再 repairLooseJsonObject，再 JSON.parse。
 *  解析失败抛带 label 的 Error。
 */
export function parseAgentJson(text: string, label: string): any {
  const json = extractJsonObject(text);
  try {
    return JSON.parse(json);
  } catch (error) {
    const repaired = repairLooseJsonObject(json);
    if (repaired !== json) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to the original parse error; it usually points at the real bad token.
      }
    }
    const message = error instanceof Error ? error.message : "JSON 解析失败";
    throw new Error(`${label} 返回 JSON 无法解析：${message}`);
  }
}

// ───────────────────────────────────────────────────────────────
// callAgentWithFallback — 4-Agent pipeline 的核心 provider 调度器
// ───────────────────────────────────────────────────────────────

export interface ProviderRouterLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface ProviderRouterOptions {
  /** 日志回调；缺省 no-op。vite.config.ts 会注入 console 包装 */
  logger?: ProviderRouterLogger;
  /** API key 缺失时的处理：缺省 "error"（push 到 errors 数组），vite 传 "silent"（静默跳过） */
  onMissingApiKey?: "silent" | "log" | "error";
}

export interface CallAgentParams {
  agentId?: string;
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
  env: Record<string, string>;
  codexBin: string;
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * 用户在前端 model picker 里指定的 (provider, model)。
   * 传入时：旁路 fallback chain，只调这一对；缺 key → 抛错；调用失败 → 抛错（不兜底）。
   * 不传：维持原有 fallback chain 行为。
   */
  modelOverride?: { provider: AgentTextProviderId; model: string };
  options?: ProviderRouterOptions;
}

export interface CallAgentResult {
  output: any;
  model: string;
  latencyMs: number;
}

const NOOP_LOGGER: ProviderRouterLogger = {
  info: () => {},
  error: () => {},
};

/**
 * 单个 provider 的一次直调（用于 modelOverride 旁路 + 单元测试）
 * - 用传入的 model，不读 env 默认
 * - 缺 key → throw（带 provider + model 上下文）
 * - 调用失败 → throw（带 provider + model 上下文）
 * - 成功 → 返回 { text, model: "provider:actualModel" }
 */
export async function dispatchSingleProvider({
  provider,
  model,
  env,
  agentId,
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens,
  codexBin,
  reasoningEffort,
}: {
  provider: AgentTextProviderId;
  model: string;
  env: Record<string, string>;
  agentId?: string;
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
  codexBin: string;
  reasoningEffort: "low" | "medium" | "high";
}): Promise<{ text: string; model: string }> {
  if (provider === "deepseek") {
    const apiKey = envValue(env, "DEEPSEEK_API_KEY");
    if (!apiKey) throw new Error(`未配置 DEEPSEEK_API_KEY`);
    const baseUrl = (envValue(env, "DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, "");
    return await callDeepSeekAgent({ apiKey, baseUrl, model, systemPrompt, userContent, maxTokens });
  }
  if (provider === "mimo") {
    const apiKey = envValue(env, "MIMO_API_KEY");
    if (!apiKey) throw new Error(`未配置 MIMO_API_KEY`);
    const baseUrl = (envValue(env, "MIMO_BASE_URL") || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, "");
    return await callMimoAgent({ baseUrl, apiKey, model, systemPrompt, userContent, maxTokens });
  }
  if (provider === "stepfun") {
    const apiKey = envValue(env, "STEPFUN_API_KEY");
    if (!apiKey) throw new Error(`未配置 STEPFUN_API_KEY`);
    const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
    return await callStepFunAgent({ baseUrl, apiKey, model, systemPrompt, userContent, maxTokens, reasoningEffort });
  }
  if (provider === "360") {
    const apiKey = getSearch360ApiKey(env);
    if (!apiKey) throw new Error(`未配置 360 API key`);
    const baseUrl = (envValue(env, "AI360_BASE_URL") || "https://api.360.cn/v1").replace(/\/$/, "");
    return await call360ChatAgent({ apiKey, baseUrl, model, systemPrompt, userContent, maxTokens });
  }
  if (provider === "anthropic") {
    const anthropicConfig = await loadAnthropicConfig(env);
    if (!anthropicConfig?.baseUrl || !anthropicConfig.model) {
      throw new Error(`未配置 Anthropic proxy (ANTHROPIC_BASE_URL / ANTHROPIC_MODEL)`);
    }
    return await callAnthropicAgent({
      baseUrl: anthropicConfig.baseUrl,
      token: anthropicConfig.token,
      model,
      systemPrompt,
      userContent,
      maxTokens,
    });
  }
  if (provider === "codex") {
    return await callCodexAgent({ codexBin, model, systemPrompt, userContent, responseSchema, maxTokens });
  }
  throw new Error(`未知 provider: ${provider}`);
}

export async function callAgentWithFallback(params: CallAgentParams): Promise<CallAgentResult> {
  const {
    agentId,
    systemPrompt,
    userContent,
    responseSchema,
    maxTokens,
    env,
    codexBin,
    reasoningEffort = "high",
    options = {},
  } = params;
  const logger = options.logger ?? NOOP_LOGGER;
  const onMissing = options.onMissingApiKey ?? "error";
  const traceLabel = `Agent${agentId ? `:${agentId}` : ""}`;

  const startTime = Date.now();
  const errors: string[] = [];
  const providerOrder = providerOrderForAgent(env, agentId);

  // ───────────────────────────────────────────────────────────────
  // modelOverride 旁路（用户在前端 model picker 选过 model 时走这里）
  // 语义：只调这一对 (provider, model)，不进入 fallback chain；
  //      缺 key → 抛错；调用失败 → 抛错（不兜底）。
  // ───────────────────────────────────────────────────────────────
  if (params.modelOverride) {
    const { provider: ovProvider, model: ovModel } = params.modelOverride;
    if (!TEXT_PROVIDER_IDS.has(ovProvider)) {
      throw new Error(`modelOverride 指向未知 provider: ${ovProvider}`);
    }
    const ovStart = Date.now();
    logger.info("[orchestrate-provider] start (override)", {
      agent: traceLabel,
      provider: ovProvider,
      model: ovModel,
    });
    try {
      const result = await dispatchSingleProvider({
        provider: ovProvider,
        model: ovModel,
        env,
        agentId,
        systemPrompt,
        userContent,
        responseSchema,
        maxTokens,
        codexBin,
        reasoningEffort,
      });
      logger.info("[orchestrate-provider] complete (override)", {
        agent: traceLabel,
        provider: ovProvider,
        model: ovModel,
        latencyMs: Date.now() - ovStart,
      });
      return {
        output: parseAgentJson(result.text, result.model),
        model: result.model,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${ovProvider} 调用失败`;
      logger.error("[orchestrate-provider] error (override)", {
        agent: traceLabel,
        provider: ovProvider,
        model: ovModel,
        latencyMs: Date.now() - ovStart,
        message,
      });
      throw new Error(`[${ovProvider}:${ovModel}] ${message}`);
    }
  }

  /**
   * 包装单个 provider 调用：start 日志 → 执行 → complete/error 日志。
   * 返回的 Promise<{ ok: true; result } | { ok: false; error }> 便于外层累积 errors 数组。
   */
  const runOne = async <T,>(
    provider: string,
    modelName: string,
    call: () => Promise<T>
  ): Promise<{ ok: true; result: T } | { ok: false; msg: string }> => {
    const providerStart = Date.now();
    logger.info("[orchestrate-provider] start", {
      agent: traceLabel,
      provider,
      model: modelName,
    });
    try {
      const result = await call();
      logger.info("[orchestrate-provider] complete", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
      });
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} 调用失败`;
      logger.error("[orchestrate-provider] error", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
        message,
      });
      return { ok: false, msg: message };
    }
  };

  for (const provider of providerOrder) {
    if (provider === "deepseek") {
      const apiKey = envValue(env, "DEEPSEEK_API_KEY");
      const baseUrl = (envValue(env, "DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, "");
      const model = envValue(env, "DEEPSEEK_MODEL") || modelForAgent(env, "DEEPSEEK", agentId, "deepseek-v4-pro");
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "deepseek", model });
        if (onMissing === "error") errors.push(`[deepseek:${model}] 未配置 DEEPSEEK_API_KEY`);
        continue;
      }
      const out = await runOne("deepseek", model, () =>
        callDeepSeekAgent({ apiKey, baseUrl, model, systemPrompt, userContent, maxTokens })
      );
      if (out.ok) {
        return {
          output: parseAgentJson(out.result.text, out.result.model),
          model: out.result.model,
          latencyMs: Date.now() - startTime,
        };
      }
      errors.push(`[deepseek:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "mimo") {
      const apiKey = envValue(env, "MIMO_API_KEY");
      const model = modelForAgent(env, "MIMO", agentId, "mimo-v2.5-pro");
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "mimo", model });
        if (onMissing === "error") errors.push(`[mimo:${model}] 未配置 MIMO_API_KEY`);
        continue;
      }
      const clusters = [
        (envValue(env, "MIMO_BASE_URL") || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
        "https://token-plan-sgp.xiaomimimo.com/anthropic",
        "https://token-plan-ams.xiaomimimo.com/anthropic",
      ];
      for (const clusterUrl of clusters) {
        const out = await runOne(`mimo@${clusterUrl}`, model, () =>
          callMimoAgent({ baseUrl: clusterUrl, apiKey, model, systemPrompt, userContent, maxTokens })
        );
        if (out.ok) {
          return {
            output: parseAgentJson(out.result.text, out.result.model),
            model: out.result.model,
            latencyMs: Date.now() - startTime,
          };
        }
        errors.push(`[${clusterUrl}] ${(out as { ok: false; msg: string }).msg}`);
      }
      continue;
    }

    if (provider === "stepfun") {
      const apiKey = envValue(env, "STEPFUN_API_KEY");
      const model = modelForAgent(env, "STEPFUN", agentId, "step-3.7-flash");
      const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "stepfun", model });
        if (onMissing === "error") errors.push(`[stepfun:${model}] 未配置 STEPFUN_API_KEY`);
        continue;
      }
      const out = await runOne("stepfun", model, () =>
        callStepFunAgent({
          baseUrl,
          apiKey,
          model,
          systemPrompt,
          userContent,
          maxTokens,
          reasoningEffort,
        })
      );
      if (out.ok) {
        return {
          output: parseAgentJson(out.result.text, out.result.model),
          model: out.result.model,
          latencyMs: Date.now() - startTime,
        };
      }
      errors.push(`[stepfun:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "360") {
      const apiKey = getSearch360ApiKey(env);
      const baseUrl = (envValue(env, "AI360_BASE_URL") || "https://api.360.cn/v1").replace(/\/$/, "");
      const model =
        (agentId && envValue(env, `AI360_${agentEnvKey(agentId)}_MODEL`)) ||
        envValue(env, "AI360_CHAT_MODEL") ||
        envValue(env, "AI360_MODEL") ||
        "360gpt-pro";
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "360", model });
        if (onMissing === "error") errors.push(`[360:${model}] 未配置 360 API key`);
        continue;
      }
      const out = await runOne("360", model, () =>
        call360ChatAgent({ apiKey, baseUrl, model, systemPrompt, userContent, maxTokens })
      );
      if (out.ok) {
        return {
          output: parseAgentJson(out.result.text, out.result.model),
          model: out.result.model,
          latencyMs: Date.now() - startTime,
        };
      }
      errors.push(`[360:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "anthropic") {
      const anthropicConfig = await loadAnthropicConfig(env);
      if (!anthropicConfig?.baseUrl || !anthropicConfig.model) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing anthropic config", {});
        if (onMissing === "error") errors.push("[anthropic] 未配置 Anthropic proxy");
        continue;
      }
      const out = await runOne("anthropic-local", anthropicConfig.model, () =>
        callAnthropicAgent({
          baseUrl: anthropicConfig.baseUrl,
          token: anthropicConfig.token,
          model: anthropicConfig.model,
          systemPrompt,
          userContent,
          maxTokens,
        })
      );
      if (out.ok) {
        return {
          output: parseAgentJson(out.result.text, out.result.model),
          model: out.result.model,
          latencyMs: Date.now() - startTime,
        };
      }
      errors.push(`[anthropic:${anthropicConfig.model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "codex") {
      const model = envValue(env, "CODEX_LOCAL_MODEL") || "gpt-5.5";
      const out = await runOne("codex-cli", model, () =>
        callCodexAgent({ codexBin, model, systemPrompt, userContent, responseSchema, maxTokens })
      );
      if (out.ok) {
        return {
          output: parseAgentJson(out.result.text, out.result.model),
          model: out.result.model,
          latencyMs: Date.now() - startTime,
        };
      }
      errors.push(`[codex:${model}] ${(out as { ok: false; msg: string }).msg}`);
    }
  }

  throw new Error(errors.join("；") || "没有可用的 Agent provider");
}
