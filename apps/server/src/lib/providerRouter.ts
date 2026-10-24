// Model router: provider order, process-wide skip state, connect retry, JSON repair + schema check,
// and the stage deadline. Everything a provider needs to know about its own API lives in ./models.
// Timeouts are layered: the provider's per-attempt budget (ORCHESTRATE_PROVIDER_TIMEOUT_MS unless the
// provider overrides it for a model) and the caller's stage deadline; the shorter one applies.

import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { ExecutionTimeoutError, getTimeoutMs, withExecutionBudget } from "./executionBudget.js";
import { extractJsonObject } from "./anthropicParse.js";
import { agentEnvKey, envValue, MODEL_PROVIDERS, ProviderError, type ModelProvider, type ModelReply } from "./models/index.js";

/** Process-local: once a provider returns hard quota/balance, skip it for later agents in this process. */
const quotaExhaustedUntil = new Map<string, number>();
const timeoutStrikes = new Map<string, number>();
const QUOTA_SKIP_MS = 10 * 60 * 1000;

function isProviderSkipped(provider: ModelProvider): boolean {
  const until = quotaExhaustedUntil.get(provider.id);
  return typeof until === "number" && until > Date.now();
}

function skipProvider(provider: ModelProvider): void {
  quotaExhaustedUntil.set(provider.id, Date.now() + QUOTA_SKIP_MS);
}

// An empty reply (the stream ended while the model was still thinking) is not a hard failure:
// skipping MiniMax for it once sent every investigation for the next 10 minutes to the fallback.
function noteProviderFailure(provider: ModelProvider, model: string, error: unknown): void {
  if (error instanceof ProviderError && (error.kind === "quota" || error.kind === "auth")) {
    skipProvider(provider);
    return;
  }
  if (error instanceof ExecutionTimeoutError) {
    const strikes = (timeoutStrikes.get(provider.id) || 0) + 1;
    timeoutStrikes.set(provider.id, strikes);
    if (strikes >= provider.skipAfterTimeouts(model, error.timeoutMs)) skipProvider(provider);
  }
}

function areCloudProvidersHardSkipped(providers: ModelProvider[], env: Record<string, string>): boolean {
  const configured = providers.filter((provider) => provider.configured(env));
  return configured.length > 0 && configured.every(isProviderSkipped);
}

/**
 * ORCHESTRATE_<AGENT>_PROVIDER_ORDER, then ORCHESTRATE_TEXT_PROVIDER_ORDER, then the registry order.
 * Unknown names and duplicates are dropped; an empty result falls back to the registry order.
 * Image calls use the same order, keeping only providers with vision (registry order if none is listed).
 */
function providersFor(env: Record<string, string>, agentId: string | undefined, withImages: boolean): ModelProvider[] {
  const ordered = configuredOrder(env, agentId);
  if (!withImages) return ordered;
  const vision = ordered.filter((provider) => provider.vision);
  return vision.length > 0 ? vision : MODEL_PROVIDERS.filter((provider) => provider.vision);
}

function configuredOrder(env: Record<string, string>, agentId: string | undefined): ModelProvider[] {
  const key = agentEnvKey(agentId);
  const raw =
    (key && envValue(env, `ORCHESTRATE_${key}_PROVIDER_ORDER`)) ||
    envValue(env, "ORCHESTRATE_TEXT_PROVIDER_ORDER");
  const order: ModelProvider[] = [];
  for (const item of raw.split(",")) {
    const provider = MODEL_PROVIDERS.find((candidate) => candidate.id === item.trim().toLowerCase());
    if (provider && !order.includes(provider)) order.push(provider);
  }
  return order.length > 0 ? order : [...MODEL_PROVIDERS];
}


// JSON repair + parse


function stripJsonNoise(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
}

/**
 * 修复字符串值内部未转义的引号（"他说"不会"…" 这类中文文本常见 slip，
 * JSON.parse 报 Expected ',' or '}' after property value）。
 * 启发式：字符串内遇到 `"` 时，向后看第一个非空白字符——
 * 是 `,` `}` `]` `:` 或 EOF 才算真正的闭合引号，否则当内容转义。
 */
function escapeUnescapedInnerQuotes(json: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < json.length; i += 1) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escape) {
      escape = false;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j += 1;
      const next = j < json.length ? json[j] : "";
      if (next === "," || next === "}" || next === "]" || next === ":" || next === "") {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

class AgentOutputError extends Error {
  kind: "unparsable" | "schema";
  constructor(kind: "unparsable" | "schema", message: string) {
    super(message);
    this.name = "AgentOutputError";
    this.kind = kind;
  }
}

/** Live output must be complete and satisfy the job schema; never guess missing tokens. */
function parseValidatedAgentJson(text: string, label: string, schema: object = {}): any {
  let output: unknown;
  const candidate = extractJsonObject(stripJsonNoise(text));
  try {
    try {
      output = JSON.parse(candidate);
    } catch {
      // 修复字符串内部未转义的双引号；解析后仍须通过字段校验。
      output = JSON.parse(escapeUnescapedInnerQuotes(candidate));
    }
  } catch (error) {
    // 在解析错误中附上出错位置附近的内容，便于定位格式问题。
    const reason = error instanceof Error ? error.message : "";
    const at = Number(/position (\d+)/.exec(reason)?.[1] ?? NaN);
    const near = Number.isFinite(at) ? ` 附近：${JSON.stringify(candidate.slice(Math.max(0, at - 60), at + 20))}` : "";
    throw new AgentOutputError("unparsable", `${label} 返回 JSON 无法解析（输出不完整或语法错误：${reason.slice(0, 120)}${near}）`);
  }
  if (!output || typeof output !== "object" || Array.isArray(output) || !Value.Check(schema as TSchema, output)) {
    throw new AgentOutputError("schema", `${label} 输出字段不符合 responseSchema`);
  }
  return output;
}

function buildJsonRepairUserContent(brokenText: string, originalUserContent: string): string {
  const broken = brokenText.length > 14000 ? `${brokenText.slice(0, 14000)}\n…[truncated]` : brokenText;
  const original =
    originalUserContent.length > 6000
      ? `${originalUserContent.slice(0, 6000)}\n…[truncated]`
      : originalUserContent;
  return [
    "你上一次输出不是合法 JSON，解析失败。",
    "请只输出一个可被 JSON.parse 接受的 JSON 对象，不要 markdown 代码块，不要解释。",
    "字段结构必须与原任务要求一致；字符串里的引号必须正确转义；不要尾随逗号。",
    "",
    "## 上一次坏输出",
    broken,
    "",
    "## 原任务（仅作字段参考）",
    original,
  ].join("\n");
}


// 按阶段选择提供方，并处理失败和重试


interface CallJsonParams {
  agentId?: string;
  system: string;
  user: string;
  schema: object;
  /** Image data URLs; the call then goes only to providers that can read them. */
  images?: string[];
  maxTokens: number;
  env: Record<string, string>;
  signal?: AbortSignal;
  /**
   * 阶段级硬预算：绝对时间戳，本次调用含全部 provider 尝试合计不得超过它。
   * 到点不再开下一次尝试，已开的那次用剩余时长封顶。
   */
  deadlineMs?: number;
}

interface CallJsonResult {
  output: any;
  model: string;
  latencyMs: number;
  /** 推理模型的 thinking 文本（如 step-3.7-flash 的 message.reasoning）；无则缺省 */
  reasoning?: string;
}

/**
 * 所有备用 provider 均失败时抛出。message 只承载用户可读的友好文案，
 * 完整诊断（每家的 provider/model + 原始错误串）放在 providerErrors 上，
 * 供结构化日志/事件透传，绝不上屏。
 */
class ProviderFallbackError extends Error {
  providerErrors: string[];
  constructor(message: string, providerErrors: string[]) {
    super(message);
    this.name = "ProviderFallbackError";
    this.providerErrors = providerErrors;
  }
}

/** 非正数 / NaN / undefined 一律当「没给」，不因为一个坏值把阶段预算写成 0。 */
function positiveMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 对可重试的连接失败，在同一提供方内最多尝试 3 次。 */
const CONNECT_ATTEMPTS = 3;

export async function callJson(params: CallJsonParams): Promise<CallJsonResult> {
  const { agentId, system, user, schema, images, maxTokens, env, signal } = params;
  const logger = console;
  signal?.throwIfAborted();
  const traceLabel = `Agent${agentId ? `:${agentId}` : ""}`;
  const providerTimeoutMs = getTimeoutMs(env, "ORCHESTRATE_PROVIDER_TIMEOUT_MS", 45000);
  const withImages = Boolean(images?.length);

  const startTime = Date.now();
  const errors: string[] = [];
  const providers = providersFor(env, agentId, withImages);


  // 阶段级硬预算
  // deadlineMs 限制所有提供方和重试的总耗时，避免逐次调用各自耗尽预算。

  const stageDeadlineMs = positiveMs(params.deadlineMs);
  const stageRemainingMs = () =>
    stageDeadlineMs === undefined ? undefined : stageDeadlineMs - Date.now();
  const stageBudgetExpired = () => {
    const left = stageRemainingMs();
    return left !== undefined && left <= 0;
  };
  /** 单次尝试的生效超时 = min(per-provider 预算, 阶段剩余) */
  const attemptTimeoutMs = (perProviderMs: number) => {
    const limits = [perProviderMs];
    const left = stageRemainingMs();
    if (left !== undefined) limits.push(left);
    return Math.max(1, Math.min(...limits));
  };
  const noteStageBudgetExhausted = () => {
    logger.error("[orchestrate-provider] stage_budget_exhausted", {
      agent: traceLabel,
      budgetMs: stageDeadlineMs === undefined ? undefined : stageDeadlineMs - startTime,
      elapsedMs: Date.now() - startTime,
    });
  };

  if (areCloudProvidersHardSkipped(providers, env)) {
    throw new ProviderFallbackError("所有备用模型均已调用失败，请检查模型配置或稍后重试", [
      "configured cloud providers already skipped this process",
    ]);
  }

  /**
   * 调一次 provider 拿文本，本地 parse；若是坏 JSON，同 provider 再修一次（仅 1 次），
   * 避免 360/小模型把整步打成 agent_error。
   */
  const invokeAndParse = async (
    provider: ModelProvider,
    model: string,
    timeoutMs: number
  ): Promise<CallJsonResult> => {
    const call = (callSystem: string, callUser: string, callSignal: AbortSignal): Promise<ModelReply> =>
      provider.call({ env, agentId, model, system: callSystem, user: callUser, images, maxTokens, signal: callSignal });
    return withExecutionBudget(async (budgetSignal) => {
      const prompt = `${system}\n\n# RESPONSE SCHEMA\n${JSON.stringify(schema)}`;
      const raw = await call(prompt, user, budgetSignal);
      budgetSignal.throwIfAborted();
      try {
        const output = parseValidatedAgentJson(raw.text, raw.model, schema);
        return { output, model: raw.model, latencyMs: Date.now() - startTime, reasoning: raw.reasoning };
      } catch (parseError) {
        if (!(parseError instanceof AgentOutputError)) throw parseError;
        budgetSignal.throwIfAborted();
        logger.error("[orchestrate-provider] json_parse_error", {
          agent: traceLabel, provider: provider.id, model,
          message: parseError.message, textChars: raw.text?.length ?? 0,
        });

        // One schema-constrained rewrite, within the same deadline; no guessed JSON completion.
        logger.info("[orchestrate-provider] json_repair_retry", {
          agent: traceLabel, provider: provider.id, model, tag: "fallback",
        });
        const repairPrompt = [
          prompt,
          "",
          "# CRITICAL OUTPUT RULE",
          "Return ONLY one valid JSON object. No markdown fences. No commentary.",
          "Escape all quotes inside strings. No trailing commas. Complete all braces.",
        ].join("\n");
        const repairedRaw = await call(repairPrompt, buildJsonRepairUserContent(raw.text, user), budgetSignal);
        budgetSignal.throwIfAborted();
        const output = parseValidatedAgentJson(repairedRaw.text, repairedRaw.model, schema);
        return { output, model: repairedRaw.model, latencyMs: Date.now() - startTime, reasoning: repairedRaw.reasoning };
      }
    }, { signal, deadlineMs: stageDeadlineMs, timeoutMs, label: `${traceLabel} ${provider.id}:${model}` });
  };

  /**
   * 包装单个 provider 调用：start 日志 → 执行(+JSON repair retry) → complete/error 日志。
   * 返回的 Promise<{ ok: true; result } | { ok: false; error }> 便于外层累积 errors 数组。
   */
  const runOne = async (
    provider: ModelProvider,
    model: string
  ): Promise<{ ok: true; result: CallJsonResult } | { ok: false; msg: string }> => {
    for (let attempt = 1; ; attempt += 1) {
      const providerStart = Date.now();
      const attemptTimeout = attemptTimeoutMs(provider.timeoutMs(env, model) ?? providerTimeoutMs);
      logger.info("[orchestrate-provider] start", {
        agent: traceLabel,
        provider: provider.id,
        model,
        timeoutMs: attemptTimeout,
        ...(attempt > 1 ? { attempt } : {}),
      });
      try {
        const result = await invokeAndParse(provider, model, attemptTimeout);
        logger.info("[orchestrate-provider] complete", {
          agent: traceLabel,
          provider: provider.id,
          model,
          latencyMs: Date.now() - providerStart,
        });
        timeoutStrikes.delete(provider.id);
        return { ok: true, result };
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : `${provider.id} 调用失败`;
        logger.error("[orchestrate-provider] error", {
          agent: traceLabel,
          provider: provider.id,
          model,
          latencyMs: Date.now() - providerStart,
          timeoutMs: attemptTimeout,
          message,
          // fetch failed 本身不说原因；底层的连接错误（如 ECONNRESET、证书握手失败）在 cause 里。
          cause: (error as { cause?: { code?: string; message?: string } })?.cause?.code
            ?? (error as { cause?: { message?: string } })?.cause?.message,
          attempt,
        });
        // 没连上服务器才算连接失败：服务器回了错误（额度、鉴权、内容）或超时都不重试。
        const connectFailure = error instanceof ProviderError && error.kind === "connect";
        // A reply cut off mid-stream or JSON still broken after the repair pass is usually a one-off;
        // with the fallback provider unavailable, one more try is what keeps the run from failing.
        const brokenReply =
          (error instanceof ProviderError && error.kind === "empty") ||
          (error instanceof AgentOutputError && error.kind === "unparsable");
        if (connectFailure && attempt < CONNECT_ATTEMPTS && !stageBudgetExpired()) continue;
        if (brokenReply && attempt < 2 && !stageBudgetExpired()) continue;
        if (!stageBudgetExpired()) noteProviderFailure(provider, model, error);
        return { ok: false, msg: message };
      }
    }
  };

  for (const provider of providers) {
    signal?.throwIfAborted();
    if (stageBudgetExpired()) {
      noteStageBudgetExhausted();
      errors.push(
        `[stage] 阶段硬预算 ${stageDeadlineMs === undefined ? 0 : stageDeadlineMs - startTime}ms 已用尽，不再尝试后续 provider`
      );
      break;
    }
    if (isProviderSkipped(provider)) {
      errors.push(`[${provider.id}] 本进程已因额度耗尽跳过`);
      continue;
    }
    const model = provider.modelFor(env, agentId, withImages);
    if (!provider.configured(env)) {
      errors.push(`[${provider.id}:${model}] 未配置 ${provider.apiKeyEnv}`);
      continue;
    }
    const out = await runOne(provider, model);
    if (out.ok) return out.result;
    errors.push(`[${provider.id}:${model}] ${out.msg}`);
  }

  const friendlyMessage =
    errors.length > 0 ? "所有备用模型均已调用失败，请检查模型配置或稍后重试" : "没有可用的 Agent provider";
  throw new ProviderFallbackError(friendlyMessage, errors);
}
