// ───────────────────────────────────────────────────────────────
// Server-side provider router
// 把 server/src/handlers.ts 和 vite.config.ts 重复的 callAgentWithFallback 抽到一处。
// 行为以 server/src/handlers.ts 原实现为基线（per-agent routing、per-agent model、
// parseAgentJson 带 repair、API key 缺失 push 到 errors）。
// 调用方通过 options 注入 logger / onMissingApiKey / 阶段预算（deadlineMs、
// attemptTimeoutCapMs）行为以匹配各自的差异。
// 超时有三层：per-provider 预算（ORCHESTRATE_PROVIDER_TIMEOUT_MS，按模型可覆写）、
// 调用方给的阶段硬预算（options.deadlineMs）、调用方给的单次尝试上限（options.attemptTimeoutCapMs）；
// 单次生效超时取三者最小值。不传后两个时行为与旧版一致。
// ───────────────────────────────────────────────────────────────

import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { withExecutionBudget } from "./executionBudget.js";
import { callMiniMaxAgent, callStepFunAgent } from "./agentProviders.js";
// 审查 P3-2 修复：extractJsonObject 从共享模块引入并 re-export，
// 不再在本文件维护独立副本（原 line 193-204 本地定义已删除）。
// 用 import + export 双语句让本文件内调用点也能解析（纯 re-export 不引入本地绑定）。
import { extractJsonObject } from "./anthropicParse.js";
export { extractJsonObject };
import { isMiniMaxM27, miniMaxCallOptions, MINIMAX_M27_DEFAULT_TIMEOUT_MS, MINIMAX_M3_DEFAULT_TIMEOUT_MS } from "./minimaxM3.js";

/** MiniMax 是主力；阶跃负责图片解析与兜底（2026-10-09 起只保留这两家）。 */
export type AgentTextProviderId = "minimax" | "stepfun";

const TEXT_PROVIDER_IDS = new Set<AgentTextProviderId>(["minimax", "stepfun"]);

/** Process-local: once a provider returns hard quota/balance, skip it for later agents in this process. */
const quotaExhaustedUntil = new Map<string, number>();
const timeoutStrikes = new Map<string, number>();
const QUOTA_SKIP_MS = 10 * 60 * 1000;

export function resetProviderQuotaSkipForTests(): void {
  quotaExhaustedUntil.clear();
  timeoutStrikes.clear();
}

export function isHardProviderQuotaError(message: string): boolean {
  return /quota exceeded|insufficient balance|余额不足|额度不足|insufficient.?quota|exceeded your (?:current )?quota|credit(?:s)? (?:exhausted|exceeded)|billing hard limit|over_quota|无可用额度/i.test(
    message
  );
}

export function isHardProviderAuthError(message: string): boolean {
  return /invalid api key|invalid_key|incorrect api key|unauthorized|ENOENT|authentication fails|api key[\s\S]{0,80}is invalid/i.test(
    message
  );
}

/** Empty-body / no-text is usually a dead account or thinking-budget wipe, not a transient blip. */
export function isEmptyProviderResponse(message: string): boolean {
  return /没有返回可解析文本|无返回文本|empty (?:response|text)|no (?:usable )?text/i.test(message);
}

export function isHardProviderFailure(message: string): boolean {
  return (
    isHardProviderQuotaError(message) ||
    isHardProviderAuthError(message) ||
    isEmptyProviderResponse(message)
  );
}

function canonicalProviderId(provider: string): string {
  if (provider.startsWith("minimax")) return "minimax";
  return provider;
}

export function isProviderQuotaSkipped(provider: string): boolean {
  const until = quotaExhaustedUntil.get(canonicalProviderId(provider));
  return typeof until === "number" && until > Date.now();
}

function skipProvider(provider: string): void {
  quotaExhaustedUntil.set(canonicalProviderId(provider), Date.now() + QUOTA_SKIP_MS);
}

export function noteProviderFailure(provider: string, message: string): void {
  if (isHardProviderFailure(message)) {
    skipProvider(provider);
    return;
  }
  if (/超时 \d+ms/.test(message)) {
    const id = canonicalProviderId(provider);
    const n = (timeoutStrikes.get(id) || 0) + 1;
    timeoutStrikes.set(id, n);
    const timeoutMs = Number(/超时 (\d+)ms/.exec(message)?.[1] ?? 0);
    // MiniMax-M3 默认等 10 分钟：一次挂死才跳过。M2.7 的 90s/180s 超时是慢，不是额度耗尽。
    const minimaxM3Hang =
      /minimax:MiniMax-M3\b/i.test(message) || (id === "minimax" && timeoutMs >= 300_000);
    if (n >= (minimaxM3Hang ? 1 : 2)) skipProvider(provider);
  }
}

export function providerHasCredentials(env: Record<string, string>, provider: string): boolean {
  const id = canonicalProviderId(provider);
  if (id === "minimax") return Boolean(getMiniMaxApiKey(env));
  if (id === "stepfun") return Boolean(envValue(env, "STEPFUN_API_KEY"));
  return false;
}

/** Configured chat providers that are still eligible this process. */
export function pendingCloudProviders(env: Record<string, string>, agentId?: string): AgentTextProviderId[] {
  return providerOrderForAgent(env, agentId).filter(
    (provider) => providerHasCredentials(env, provider) && !isProviderQuotaSkipped(provider)
  );
}

export function areCloudProvidersHardSkipped(env: Record<string, string>, agentId?: string): boolean {
  const configured = providerOrderForAgent(env, agentId).filter((provider) => providerHasCredentials(env, provider));
  return configured.length > 0 && pendingCloudProviders(env, agentId).length === 0;
}

// MiniMax is the default chat provider; StepFun is the fallback.
const DEFAULT_TEXT_PROVIDER_ORDER: AgentTextProviderId[] = ["minimax", "stepfun"];

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
 *  - 尊重 env/per-agent 顺序
 *  - 未识别的 provider 名（含已删除的 deepseek / mimo / anthropic / 360 / codex）静默丢弃
 *  - 去重
 *  - agentId 提供时优先 per-agent env
 *  - 丢完一个都不剩时用默认顺序
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
  return order.length > 0 ? order : [...DEFAULT_TEXT_PROVIDER_ORDER];
}

/** 解析 <PREFIX>_<AGENT>_MODEL / <PREFIX>_MODEL / fallback
 *  例: modelForAgent(env, "MINIMAX", "rumor_detector", "MiniMax-M2.7-highspeed")
 *      → env.MINIMAX_RUMOR_DETECTOR_MODEL ?? env.MINIMAX_MODEL ?? "MiniMax-M2.7-highspeed"
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

export function getMiniMaxApiKey(env: Record<string, string>): string {
  return envValue(env, "MINIMAX_API_KEY");
}

function getMiniMaxAuthHeader(env: Record<string, string>): "x-api-key" | "bearer" {
  return envValue(env, "MINIMAX_AUTH_HEADER").toLowerCase() === "bearer" ? "bearer" : "x-api-key";
}

function stepFunMaxTokensForModel(env: Record<string, string>, model: string, requested: number): number {
  if (!/^step-3\.7-flash$/i.test(model)) return requested;
  const minTokens = Number(envValue(env, "STEPFUN_3_7_MIN_MAX_TOKENS") || 4096);
  return Number.isFinite(minTokens) && minTokens > requested ? minTokens : requested;
}

function parseReasoningEffort(value: string): "low" | "medium" | "high" | undefined {
  const normalized = value.toLowerCase();
  return normalized === "low" || normalized === "medium" || normalized === "high" ? normalized : undefined;
}

function stepFunReasoningEffortForModel(
  env: Record<string, string>,
  model: string,
  requested: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  if (/^step-3\.7-flash$/i.test(model)) {
    return (
      parseReasoningEffort(envValue(env, "STEPFUN_3_7_REASONING_EFFORT")) ||
      parseReasoningEffort(envValue(env, "STEPFUN_REASONING_EFFORT")) ||
      "low"
    );
  }
  return parseReasoningEffort(envValue(env, "STEPFUN_REASONING_EFFORT")) || requested;
}

// ───────────────────────────────────────────────────────────────
// JSON repair + parse
// ───────────────────────────────────────────────────────────────

// 审查 P3-2 修复：extractJsonObject 已抽到 ./anthropicParse.js，本文件顶部 re-export。

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
export function escapeUnescapedInnerQuotes(json: string): string {
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

/** 尝试修复 LLM 输出的 loose JSON（尾随逗号、未加引号的值、截断闭合） */
function repairLooseJsonObject(json: string): string {  let repaired = stripJsonNoise(json)
    // // line comments and /* block comments */ (outside of perfect string handling — best effort)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*([^"{\[\]\d\-tfn][^,\n\r}\]]*?)(?=\s*[,}\]])/g, (_match, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return ': ""';
      if (/^(true|false|null)$/i.test(trimmed)) return `: ${trimmed.toLowerCase()}`;
      return `: ${JSON.stringify(trimmed.replace(/^['"]|['"]$/g, ""))}`;
    });

  // Single-quoted strings → double-quoted (common model slip)
  repaired = repaired.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) =>
    JSON.stringify(inner.replace(/\\'/g, "'"))
  );

  return closeTruncatedJson(repaired);
}

/**
 * Balance braces/brackets for truncated model output.
 * If a string is left open, close it first; drop a trailing incomplete key/comma.
 */
export function closeTruncatedJson(input: string): string {
  let s = input.trim();
  if (!s) return s;

  // Drop dangling trailing comma / incomplete key before we close.
  s = s.replace(/,\s*$/, "");
  s = s.replace(/,\s*"[^"]*$/, "");
  s = s.replace(/:\s*"[^"]*$/, ': ""');
  s = s.replace(/:\s*[^,{\[\]}\s"]+$/, ': null');

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") {
      const open = stack[stack.length - 1];
      if ((ch === "}" && open === "{") || (ch === "]" && open === "[")) stack.pop();
    }
  }

  if (inString) s += '"';
  s = s.replace(/,\s*$/, "");
  while (stack.length > 0) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}

function tryParseJsonCandidate(candidate: string): any | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/**
 * 解析 LLM JSON 输出：extract → 多策略 repair → JSON.parse。
 * 解析失败抛带 label 的 Error。
 */
export function parseAgentJson(text: string, label: string): any {
  const cleaned = stripJsonNoise(text);
  const extracted = extractJsonObject(cleaned);
  const candidates = [
    extracted,
    escapeUnescapedInnerQuotes(extracted),
    repairLooseJsonObject(extracted),
    closeTruncatedJson(extracted),
    repairLooseJsonObject(closeTruncatedJson(escapeUnescapedInnerQuotes(extracted))),
    repairLooseJsonObject(closeTruncatedJson(extracted)),
    // last resort: whole cleaned text if it already looks like an object
    cleaned.startsWith("{") ? repairLooseJsonObject(cleaned) : "",
  ].filter((item, index, arr) => item && arr.indexOf(item) === index);

  let lastError: Error | undefined;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("JSON 解析失败");
    }
  }

  const message = lastError?.message || "JSON 解析失败";
  throw new Error(`${label} 返回 JSON 无法解析：${message}`);
}

export function isAgentJsonParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /JSON 无法解析|Unexpected token|Unexpected end of JSON|Expected .* after property|Bad control character|JSON\.parse/i.test(
    message
  );
}

export class AgentOutputError extends Error {
  constructor(message: string) { super(message); this.name = "AgentOutputError"; }
}

/** Live output must be complete and satisfy the job schema; never guess missing tokens. */
export function parseValidatedAgentJson(text: string, label: string, schema: object = {}): any {
  let output: unknown;
  try {
    output = JSON.parse(extractJsonObject(stripJsonNoise(text)));
  } catch {
    throw new AgentOutputError(`${label} 返回 JSON 无法解析（输出不完整或语法错误）`);
  }
  if (!output || typeof output !== "object" || Array.isArray(output) || !Value.Check(schema as TSchema, output)) {
    throw new AgentOutputError(`${label} 输出字段不符合 responseSchema`);
  }
  return output;
}

export function buildJsonRepairUserContent(brokenText: string, originalUserContent: string): string {
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

// ───────────────────────────────────────────────────────────────
// callAgentWithFallback — 4-Agent pipeline 的核心 provider 调度器
// ───────────────────────────────────────────────────────────────

export interface ProviderRouterLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface ProviderRouterOptions {
  signal?: AbortSignal;
  /** 日志回调；缺省 no-op。vite.config.ts 会注入 console 包装 */
  logger?: ProviderRouterLogger;
  /** API key 缺失时的处理：缺省 "error"（push 到 errors 数组），vite 传 "silent"（静默跳过） */
  onMissingApiKey?: "silent" | "log" | "error";
  /**
   * 阶段级硬预算（主路 P1 Change H）：绝对时间戳，本次调用含全部 provider 尝试合计不得超过它。
   * 到点不再开下一次尝试，已开的那次用剩余时长封顶。
   */
  deadlineMs?: number;
  /**
   * 阶段内单次 provider 尝试的上限（毫秒）。一个 provider 卡住时用它就地降级到下一家，
   * 不必等 per-provider 预算（minimax 默认 600000）耗尽；缺省沿用 per-provider 预算。
   */
  attemptTimeoutCapMs?: number;
}

export interface CallAgentParams {
  agentId?: string;
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
  env: Record<string, string>;
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * 指定先调的 (provider, model)。
   * 传入时：先调这一对；缺 key / 调用失败 / 超时后继续走 fallback chain，避免整条流程中断。
   * 不传：维持默认 fallback chain 行为。
   */
  modelOverride?: { provider: AgentTextProviderId; model: string };
  options?: ProviderRouterOptions;
}

export interface CallAgentResult {
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
export class ProviderFallbackError extends Error {
  providerErrors: string[];
  constructor(message: string, providerErrors: string[]) {
    super(message);
    this.name = "ProviderFallbackError";
    this.providerErrors = providerErrors;
  }
}

const NOOP_LOGGER: ProviderRouterLogger = {
  info: () => {},
  error: () => {},
};

function getTimeoutMs(env: Record<string, string>, key: string, fallbackMs: number) {
  const raw = envValue(env, key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/** 非正数 / NaN / undefined 一律当「没给」，不因为一个坏值把阶段预算写成 0。 */
function positiveMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function timeoutForProviderModel(
  env: Record<string, string>,
  provider: AgentTextProviderId | string,
  model: string,
  fallbackMs: number
): number {
  if (provider === "stepfun" && /^step-3\.7-flash$/i.test(model)) {
    return getTimeoutMs(env, "STEPFUN_3_7_PROVIDER_TIMEOUT_MS", 135000);
  }
  // MiniMax-M3 adaptive thinking is unbounded in practice; don't clip it with the 45s cloud default.
  if (provider === "minimax" && /^MiniMax-M3$/i.test(model)) {
    return getTimeoutMs(env, "MINIMAX_M3_PROVIDER_TIMEOUT_MS", MINIMAX_M3_DEFAULT_TIMEOUT_MS);
  }
  if (provider === "minimax" && isMiniMaxM27(model)) {
    return getTimeoutMs(env, "MINIMAX_M27_PROVIDER_TIMEOUT_MS", MINIMAX_M27_DEFAULT_TIMEOUT_MS);
  }
  return fallbackMs;
}

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
  maxTokens,
  reasoningEffort,
  signal,
}: {
  provider: AgentTextProviderId;
  model: string;
  env: Record<string, string>;
  agentId?: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<{ text: string; model: string; reasoning?: string }> {
  signal?.throwIfAborted();
  if (provider === "minimax") {
    const apiKey = getMiniMaxApiKey(env);
    if (!apiKey) throw new Error(`未配置 MINIMAX_API_KEY`);
    const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
    return await callMiniMaxAgent({
      baseUrl,
      apiKey,
      authHeader: getMiniMaxAuthHeader(env),
      model,
      systemPrompt,
      userContent,
      ...miniMaxCallOptions(env, model, maxTokens),
      signal,
    });
  }
  if (provider === "stepfun") {
    const apiKey = envValue(env, "STEPFUN_API_KEY");
    if (!apiKey) throw new Error(`未配置 STEPFUN_API_KEY`);
    const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
    return await callStepFunAgent({
      baseUrl,
      apiKey,
      model,
      systemPrompt,
      userContent,
      maxTokens: stepFunMaxTokensForModel(env, model, maxTokens),
      reasoningEffort: stepFunReasoningEffortForModel(env, model, reasoningEffort),
      signal,
    });
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
    reasoningEffort = "high",
    options = {},
  } = params;
  const logger = options.logger ?? NOOP_LOGGER;
  options.signal?.throwIfAborted();
  const onMissing = options.onMissingApiKey ?? "error";
  const traceLabel = `Agent${agentId ? `:${agentId}` : ""}`;
  const providerTimeoutMs = getTimeoutMs(env, "ORCHESTRATE_PROVIDER_TIMEOUT_MS", 45000);

  const startTime = Date.now();
  const errors: string[] = [];
  const providerOrder = providerOrderForAgent(env, agentId);

  // ───────────────────────────────────────────────────────────────
  // 阶段级硬预算（主路 P1 Change H）
  // 单次 provider 预算拦不住「换着 provider 一家家等」：真实走查里 minimax 烧了 84.9 秒、
  // stepfun 再跟两次，自证阶段合计 111 秒。deadlineMs 是本阶段的总账，
  // attemptTimeoutCapMs 让卡住的那家尽早让位给下一家。
  // ───────────────────────────────────────────────────────────────
  const stageDeadlineMs = positiveMs(options.deadlineMs);
  const attemptTimeoutCapMs = positiveMs(options.attemptTimeoutCapMs);
  const stageRemainingMs = () =>
    stageDeadlineMs === undefined ? undefined : stageDeadlineMs - Date.now();
  const stageBudgetExpired = () => {
    const left = stageRemainingMs();
    return left !== undefined && left <= 0;
  };
  /** 单次尝试的生效超时 = min(per-provider 预算, 阶段内单次上限, 阶段剩余) */
  const attemptTimeoutMs = (perProviderMs: number) => {
    const limits = [perProviderMs];
    if (attemptTimeoutCapMs !== undefined) limits.push(attemptTimeoutCapMs);
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

  if (areCloudProvidersHardSkipped(env, agentId)) {
    throw new ProviderFallbackError("所有备用模型均已调用失败，请检查模型配置或稍后重试", [
      "configured cloud providers already skipped this process",
    ]);
  }

  // ───────────────────────────────────────────────────────────────
  // modelOverride 优先（用户在前端 model picker 选过 model 时先试这里）
  // 语义：先调这一对 (provider, model)；失败后继续 fallback chain。
  // ───────────────────────────────────────────────────────────────
  const attemptedOverride =
    params.modelOverride && TEXT_PROVIDER_IDS.has(params.modelOverride.provider)
      ? params.modelOverride
      : undefined;

  /**
   * 调一次 provider 拿文本，本地 parse；若是坏 JSON，同 provider 再修一次（仅 1 次），
   * 避免 360/小模型把整步打成 agent_error。
   */
  const invokeAndParse = async (
    provider: AgentTextProviderId | string,
    modelName: string,
    call: (sys: string, user: string, signal: AbortSignal) => Promise<{ text: string; model: string; reasoning?: string }>,
    timeoutMs: number,
    logTag: string
  ): Promise<CallAgentResult> => {
    return withExecutionBudget(async (signal) => {
      const prompt = `${systemPrompt}\n\n# RESPONSE SCHEMA\n${JSON.stringify(responseSchema)}`;
      const raw = await call(prompt, userContent, signal);
      signal.throwIfAborted();
      try {
        const output = parseValidatedAgentJson(raw.text, raw.model, responseSchema);
        return { output, model: raw.model, latencyMs: Date.now() - startTime, reasoning: raw.reasoning };
      } catch (parseError) {
        if (!(parseError instanceof AgentOutputError)) throw parseError;
        signal.throwIfAborted();
        logger.error("[orchestrate-provider] json_parse_error", {
          agent: traceLabel, provider, model: modelName,
          message: parseError.message, textChars: raw.text?.length ?? 0,
        });

        // One schema-constrained rewrite, within the same deadline; no guessed JSON completion.
        logger.info("[orchestrate-provider] json_repair_retry", {
          agent: traceLabel, provider, model: modelName, tag: logTag,
        });
        const repairPrompt = [
          prompt,
          "",
          "# CRITICAL OUTPUT RULE",
          "Return ONLY one valid JSON object. No markdown fences. No commentary.",
          "Escape all quotes inside strings. No trailing commas. Complete all braces.",
        ].join("\n");
        const repairedRaw = await call(repairPrompt, buildJsonRepairUserContent(raw.text, userContent), signal);
        signal.throwIfAborted();
        const output = parseValidatedAgentJson(repairedRaw.text, repairedRaw.model, responseSchema);
        return { output, model: repairedRaw.model, latencyMs: Date.now() - startTime, reasoning: repairedRaw.reasoning };
      }
    }, { signal: options.signal, deadlineMs: stageDeadlineMs, timeoutMs, label: `${traceLabel} ${provider}:${modelName}` });
  };

  if (params.modelOverride) {
    const { provider: ovProvider, model: ovModel } = params.modelOverride;
    if (!TEXT_PROVIDER_IDS.has(ovProvider)) {
      throw new Error(`modelOverride 指向未知 provider: ${ovProvider}`);
    }
    if (isProviderQuotaSkipped(ovProvider)) {
      errors.push(`[${canonicalProviderId(ovProvider)}] 本进程已因额度耗尽跳过`);
    } else if (stageBudgetExpired()) {
      noteStageBudgetExhausted();
      errors.push(`[stage] 阶段硬预算已用尽，跳过 modelOverride ${ovProvider}:${ovModel}`);
    } else {
      const ovStart = Date.now();
      const ovTimeoutMs = attemptTimeoutMs(
        timeoutForProviderModel(env, ovProvider, ovModel, providerTimeoutMs)
      );
      logger.info("[orchestrate-provider] start (override)", {
        agent: traceLabel,
        provider: ovProvider,
        model: ovModel,
        timeoutMs: ovTimeoutMs,
      });
      try {
        const result = await invokeAndParse(
          ovProvider,
          ovModel,
          (sys, user, signal) =>
            dispatchSingleProvider({
              provider: ovProvider,
              model: ovModel,
              env,
              agentId,
              systemPrompt: sys,
              userContent: user,
              maxTokens,
              reasoningEffort,
              signal,
            }),
          ovTimeoutMs,
          "override"
        );
        logger.info("[orchestrate-provider] complete (override)", {
          agent: traceLabel,
          provider: ovProvider,
          model: ovModel,
          latencyMs: Date.now() - ovStart,
        });
        return result;
      } catch (error) {
        options.signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : `${ovProvider} 调用失败`;
        logger.error("[orchestrate-provider] error (override)", {
          agent: traceLabel,
          provider: ovProvider,
          model: ovModel,
          latencyMs: Date.now() - ovStart,
          timeoutMs: ovTimeoutMs,
          message,
        });
        if (!stageBudgetExpired()) noteProviderFailure(ovProvider, message);
        errors.push(`[${ovProvider}:${ovModel}] ${message}`);
      }
    }
  }

  /**
   * 包装单个 provider 调用：start 日志 → 执行(+JSON repair retry) → complete/error 日志。
   * 返回的 Promise<{ ok: true; result } | { ok: false; error }> 便于外层累积 errors 数组。
   */
  const runOne = async (
    provider: string,
    modelName: string,
    call: (sys: string, user: string, signal: AbortSignal) => Promise<{ text: string; model: string }>
  ): Promise<{ ok: true; result: CallAgentResult } | { ok: false; msg: string }> => {
    const providerStart = Date.now();
    const attemptTimeout = attemptTimeoutMs(
      timeoutForProviderModel(env, provider, modelName, providerTimeoutMs)
    );
    logger.info("[orchestrate-provider] start", {
      agent: traceLabel,
      provider,
      model: modelName,
      timeoutMs: attemptTimeout,
    });
    try {
      const result = await invokeAndParse(
        provider,
        modelName,
        call,
        attemptTimeout,
        "fallback"
      );
      logger.info("[orchestrate-provider] complete", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
      });
      return { ok: true, result };
    } catch (error) {
      options.signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : `${provider} 调用失败`;
      logger.error("[orchestrate-provider] error", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
        timeoutMs: attemptTimeout,
        message,
      });
      if (!stageBudgetExpired()) noteProviderFailure(provider, message);
      return { ok: false, msg: message };
    }
  };

  for (const provider of providerOrder) {
    options.signal?.throwIfAborted();
    if (stageBudgetExpired()) {
      noteStageBudgetExhausted();
      errors.push(
        `[stage] 阶段硬预算 ${stageDeadlineMs === undefined ? 0 : stageDeadlineMs - startTime}ms 已用尽，不再尝试后续 provider`
      );
      break;
    }
    if (isProviderQuotaSkipped(provider)) {
      errors.push(`[${canonicalProviderId(provider)}] 本进程已因额度耗尽跳过`);
      continue;
    }
    if (provider === "minimax") {
      const apiKey = getMiniMaxApiKey(env);
      const model = modelForAgent(env, "MINIMAX", agentId, "MiniMax-M2.7-highspeed");
      const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "minimax", model });
        if (onMissing === "error") errors.push(`[minimax:${model}] 未配置 MINIMAX_API_KEY`);
        continue;
      }
      // 填表类调用降温到 0，要稳定的输出。
      const minimaxTemperature = 0;
      const out = await runOne("minimax", model, (sys, user, signal) =>
        callMiniMaxAgent({
          baseUrl,
          apiKey,
          authHeader: getMiniMaxAuthHeader(env),
          model,
          systemPrompt: sys,
          userContent: user,
          ...miniMaxCallOptions(env, model, maxTokens),
          ...(minimaxTemperature !== undefined ? { temperature: minimaxTemperature } : {}),
          signal,
        })
      );
      if (out.ok) {
        return out.result;
      }
      errors.push(`[minimax:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "stepfun") {
      const apiKey = envValue(env, "STEPFUN_API_KEY");
      const model = modelForAgent(env, "STEPFUN", agentId, "step-2-mini");
      const baseUrl = (envValue(env, "STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, "");
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "stepfun", model });
        if (onMissing === "error") errors.push(`[stepfun:${model}] 未配置 STEPFUN_API_KEY`);
        continue;
      }
      const out = await runOne("stepfun", model, (sys, user, signal) =>
        callStepFunAgent({
          baseUrl,
          apiKey,
          model,
          systemPrompt: sys,
          userContent: user,
          maxTokens: stepFunMaxTokensForModel(env, model, maxTokens),
          reasoningEffort: stepFunReasoningEffortForModel(env, model, reasoningEffort),
          signal,
        })
      );
      if (out.ok) {
        return out.result;
      }
      errors.push(`[stepfun:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }
  }

  const friendlyMessage =
    errors.length > 0 ? "所有备用模型均已调用失败，请检查模型配置或稍后重试" : "没有可用的 Agent provider";
  throw new ProviderFallbackError(friendlyMessage, errors);
}
