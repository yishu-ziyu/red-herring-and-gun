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
  callMiniMaxAgent,
  callStepFunAgent,
} from "./agentProviders.js";
// 审查 P3-2 修复：extractJsonObject 从共享模块引入并 re-export，
// 不再在本文件维护独立副本（原 line 193-204 本地定义已删除）。
// 用 import + export 双语句让本文件内调用点也能解析（纯 re-export 不引入本地绑定）。
import { extractJsonObject } from "./anthropicParse.js";
export { extractJsonObject };
import { miniMaxCallOptions } from "./minimaxM3.js";

export type AgentTextProviderId =
  | "deepseek"
  | "mimo"
  | "minimax"
  | "stepfun"
  | "360"
  | "anthropic"
  | "codex";

const TEXT_PROVIDER_IDS = new Set<AgentTextProviderId>([
  "deepseek",
  "mimo",
  "minimax",
  "stepfun",
  "360",
  "anthropic",
  "codex",
]);

/** Process-local: once a provider returns hard quota/balance, skip it for later agents in this run. */
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
  return /invalid api key|invalid_key|incorrect api key|unauthorized|ENOENT/i.test(message);
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
  if (provider.startsWith("mimo")) return "mimo";
  if (provider.startsWith("360")) return "360";
  if (provider.startsWith("anthropic")) return "anthropic";
  if (provider.startsWith("codex")) return "codex";
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
    // MiniMax-M3 default wait is 10 min; one hang is enough to skip the rest of this process.
    if (n >= (id === "minimax" ? 1 : 2)) skipProvider(provider);
  }
}

const CLOUD_TEXT_PROVIDERS: AgentTextProviderId[] = [
  "minimax",
  "stepfun",
  "anthropic",
  "deepseek",
  "mimo",
  "360",
];

export function providerHasCredentials(env: Record<string, string>, provider: string): boolean {
  const id = canonicalProviderId(provider);
  if (id === "deepseek") return Boolean(envValue(env, "DEEPSEEK_API_KEY"));
  if (id === "mimo") return Boolean(envValue(env, "MIMO_API_KEY"));
  if (id === "minimax") return Boolean(getMiniMaxApiKey(env));
  if (id === "stepfun") return Boolean(envValue(env, "STEPFUN_API_KEY"));
  if (id === "360") return Boolean(getSearch360ApiKey(env));
  if (id === "anthropic") {
    return Boolean(
      envValue(env, "ANTHROPIC_BASE_URL") ||
        envValue(env, "ANTHROPIC_AUTH_TOKEN") ||
        envValue(env, "ANTHROPIC_API_KEY")
    );
  }
  if (id === "codex") return Boolean(envValue(env, "CODEX_BIN") || process.env.CODEX_BIN);
  return false;
}

/** Configured cloud chat providers that are still eligible this process. */
export function pendingCloudProviders(env: Record<string, string>, agentId?: string): AgentTextProviderId[] {
  const order = providerOrderForAgent(env, agentId);
  return order.filter(
    (provider): provider is AgentTextProviderId =>
      CLOUD_TEXT_PROVIDERS.includes(provider) &&
      providerHasCredentials(env, provider) &&
      !isProviderQuotaSkipped(provider)
  );
}

export function areCloudProvidersHardSkipped(env: Record<string, string>, agentId?: string): boolean {
  const order = providerOrderForAgent(env, agentId);
  const configured = order.filter(
    (provider) => CLOUD_TEXT_PROVIDERS.includes(provider) && providerHasCredentials(env, provider)
  );
  return configured.length > 0 && pendingCloudProviders(env, agentId).length === 0;
}

/** Skip 90s-class fallbacks once this invocation already saw multiple hard failures. */
export function shouldSkipSlowFallback(provider: string, hardFailuresThisCall: number): boolean {
  return canonicalProviderId(provider) === "codex" && hardFailuresThisCall >= 2;
}

// MiniMax is the local SSOT default chat; 360 is legacy hackathon sponsor path (low context).
const DEFAULT_TEXT_PROVIDER_ORDER: AgentTextProviderId[] = [
  "minimax",
  "stepfun",
  "anthropic",
  "deepseek",
  "mimo",
  "360",
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
 *  - 尊重 env/per-agent 顺序、codex 最后
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

  // 尊重 env/per-agent 顺序；codex 作为本地兜底永远最后。
  const withoutCodex = order.filter((provider) => provider !== "codex");
  order.splice(0, order.length, ...withoutCodex);
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

export function getMiniMaxApiKey(env: Record<string, string>): string {
  return envValue(env, "MINIMAX_API_KEY") || envValue(env, "MINIMAX_TOKEN_PLAN_KEY");
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

// 审查 P3-2 修复：extractJsonObject 已抽到 ./anthropicParse.js，本文件顶部 re-export。

function stripJsonNoise(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
}

/** 尝试修复 LLM 输出的 loose JSON（尾随逗号、未加引号的值、截断闭合） */
function repairLooseJsonObject(json: string): string {
  let repaired = stripJsonNoise(json)
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
    repairLooseJsonObject(extracted),
    closeTruncatedJson(extracted),
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

function timeoutForProviderModel(
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
    return getTimeoutMs(env, "MINIMAX_M3_PROVIDER_TIMEOUT_MS", 600000);
  }
  return fallbackMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
}): Promise<{ text: string; model: string; reasoning?: string }> {
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
  if (provider === "minimax") {
    const apiKey = getMiniMaxApiKey(env);
    if (!apiKey) throw new Error(`未配置 MINIMAX_API_KEY / MINIMAX_TOKEN_PLAN_KEY`);
    const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
    return await callMiniMaxAgent({
      baseUrl,
      apiKey,
      authHeader: getMiniMaxAuthHeader(env),
      model,
      systemPrompt,
      userContent,
      ...miniMaxCallOptions(env, model, maxTokens),
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
    });
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
  const providerTimeoutMs = getTimeoutMs(env, "ORCHESTRATE_PROVIDER_TIMEOUT_MS", 45000);

  const startTime = Date.now();
  const errors: string[] = [];
  const providerOrder = providerOrderForAgent(env, agentId);
  let hardFailuresThisCall = 0;

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
    call: (sys: string, user: string) => Promise<{ text: string; model: string; reasoning?: string }>,
    timeoutMs: number,
    logTag: string
  ): Promise<CallAgentResult> => {
    const raw = await withTimeout(call(systemPrompt, userContent), timeoutMs, `${traceLabel} ${provider}:${modelName}`);
    try {
      const output = parseAgentJson(raw.text, raw.model);
      return { output, model: raw.model, latencyMs: Date.now() - startTime, reasoning: raw.reasoning };
    } catch (parseError) {
      if (!isAgentJsonParseError(parseError)) throw parseError;
      const parseMessage = parseError instanceof Error ? parseError.message : "JSON 解析失败";
      logger.error("[orchestrate-provider] json_parse_error", {
        agent: traceLabel,
        provider,
        model: modelName,
        message: parseMessage,
        textChars: raw.text?.length ?? 0,
      });

      // Local multi-repair already failed — one model-side rewrite, same provider.
      logger.info("[orchestrate-provider] json_repair_retry", {
        agent: traceLabel,
        provider,
        model: modelName,
        tag: logTag,
      });
      const repairPrompt = [
        systemPrompt,
        "",
        "# CRITICAL OUTPUT RULE",
        "Return ONLY one valid JSON object. No markdown fences. No commentary.",
        "Escape all quotes inside strings. No trailing commas. Complete all braces.",
      ].join("\n");
      const repairedRaw = await withTimeout(
        call(repairPrompt, buildJsonRepairUserContent(raw.text, userContent)),
        timeoutMs,
        `${traceLabel} ${provider}:${modelName} json-repair`
      );
      const output = parseAgentJson(repairedRaw.text, repairedRaw.model);
      return { output, model: repairedRaw.model, latencyMs: Date.now() - startTime, reasoning: repairedRaw.reasoning };
    }
  };

  if (params.modelOverride) {
    const { provider: ovProvider, model: ovModel } = params.modelOverride;
    if (!TEXT_PROVIDER_IDS.has(ovProvider)) {
      throw new Error(`modelOverride 指向未知 provider: ${ovProvider}`);
    }
    if (isProviderQuotaSkipped(ovProvider)) {
      errors.push(`[${canonicalProviderId(ovProvider)}] 本进程已因额度耗尽跳过`);
    } else {
      const ovStart = Date.now();
      logger.info("[orchestrate-provider] start (override)", {
        agent: traceLabel,
        provider: ovProvider,
        model: ovModel,
      });
      try {
        const result = await invokeAndParse(
          ovProvider,
          ovModel,
          (sys, user) =>
            dispatchSingleProvider({
              provider: ovProvider,
              model: ovModel,
              env,
              agentId,
              systemPrompt: sys,
              userContent: user,
              responseSchema,
              maxTokens,
              codexBin,
              reasoningEffort,
            }),
          timeoutForProviderModel(env, ovProvider, ovModel, providerTimeoutMs),
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
        const message = error instanceof Error ? error.message : `${ovProvider} 调用失败`;
        logger.error("[orchestrate-provider] error (override)", {
          agent: traceLabel,
          provider: ovProvider,
          model: ovModel,
          latencyMs: Date.now() - ovStart,
          message,
        });
        noteProviderFailure(ovProvider, message);
        if (isHardProviderFailure(message)) hardFailuresThisCall += 1;
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
    call: (sys: string, user: string) => Promise<{ text: string; model: string }>
  ): Promise<{ ok: true; result: CallAgentResult } | { ok: false; msg: string }> => {
    const providerStart = Date.now();
    logger.info("[orchestrate-provider] start", {
      agent: traceLabel,
      provider,
      model: modelName,
    });
    try {
      const result = await invokeAndParse(
        provider,
        modelName,
        call,
        timeoutForProviderModel(env, provider, modelName, providerTimeoutMs),
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
      const message = error instanceof Error ? error.message : `${provider} 调用失败`;
      logger.error("[orchestrate-provider] error", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
        message,
      });
      noteProviderFailure(provider, message);
      if (isHardProviderFailure(message)) hardFailuresThisCall += 1;
      return { ok: false, msg: message };
    }
  };

  for (const provider of providerOrder) {
    if (isProviderQuotaSkipped(provider)) {
      errors.push(`[${canonicalProviderId(provider)}] 本进程已因额度耗尽跳过`);
      continue;
    }
    if (shouldSkipSlowFallback(provider, hardFailuresThisCall)) {
      errors.push(`[${canonicalProviderId(provider)}] 已因连续失败跳过慢速兜底`);
      continue;
    }
    if (provider === "deepseek") {
      const apiKey = envValue(env, "DEEPSEEK_API_KEY");
      const baseUrl = (envValue(env, "DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, "");
      const model = envValue(env, "DEEPSEEK_MODEL") || modelForAgent(env, "DEEPSEEK", agentId, "deepseek-v4-pro");
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "deepseek", model });
        if (onMissing === "error") errors.push(`[deepseek:${model}] 未配置 DEEPSEEK_API_KEY`);
        continue;
      }
      const out = await runOne("deepseek", model, (sys, user) =>
        callDeepSeekAgent({ apiKey, baseUrl, model, systemPrompt: sys, userContent: user, maxTokens })
      );
      if (out.ok) {
        return out.result;
      }
      errors.push(`[deepseek:${model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "mimo") {
      const apiKey = envValue(env, "MIMO_API_KEY");
      const model = modelForAgent(env, "MIMO", agentId, "mimo-v2.5-pro");
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
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
        if (isProviderQuotaSkipped("mimo")) break;
        const out = await runOne(`mimo@${clusterUrl}`, model, (sys, user) =>
          callMimoAgent({ baseUrl: clusterUrl, apiKey, model, systemPrompt: sys, userContent: user, maxTokens })
        );
        if (out.ok) {
          return out.result;
        }
        errors.push(`[${clusterUrl}] ${(out as { ok: false; msg: string }).msg}`);
      }
      continue;
    }

    if (provider === "minimax") {
      const apiKey = getMiniMaxApiKey(env);
      const model = modelForAgent(env, "MINIMAX", agentId, "MiniMax-M2.7-highspeed");
      const baseUrl = (envValue(env, "MINIMAX_BASE_URL") || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "minimax", model });
        if (onMissing === "error") errors.push(`[minimax:${model}] 未配置 MINIMAX_API_KEY / MINIMAX_TOKEN_PLAN_KEY`);
        continue;
      }
      const out = await runOne("minimax", model, (sys, user) =>
        callMiniMaxAgent({
          baseUrl,
          apiKey,
          authHeader: getMiniMaxAuthHeader(env),
          model,
          systemPrompt: sys,
          userContent: user,
          ...miniMaxCallOptions(env, model, maxTokens),
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
      const out = await runOne("stepfun", model, (sys, user) =>
        callStepFunAgent({
          baseUrl,
          apiKey,
          model,
          systemPrompt: sys,
          userContent: user,
          maxTokens: stepFunMaxTokensForModel(env, model, maxTokens),
          reasoningEffort: stepFunReasoningEffortForModel(env, model, reasoningEffort),
        })
      );
      if (out.ok) {
        return out.result;
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
      if (attemptedOverride?.provider === provider && attemptedOverride.model === model) continue;
      if (!apiKey) {
        if (onMissing === "log") logger.info("[orchestrate-provider] missing api key", { provider: "360", model });
        if (onMissing === "error") errors.push(`[360:${model}] 未配置 360 API key`);
        continue;
      }
      const out = await runOne("360", model, (sys, user) =>
        call360ChatAgent({ apiKey, baseUrl, model, systemPrompt: sys, userContent: user, maxTokens })
      );
      if (out.ok) {
        return out.result;
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
      const out = await runOne("anthropic-local", anthropicConfig.model, (sys, user) =>
        callAnthropicAgent({
          baseUrl: anthropicConfig.baseUrl,
          token: anthropicConfig.token,
          model: anthropicConfig.model,
          systemPrompt: sys,
          userContent: user,
          maxTokens,
        })
      );
      if (out.ok) {
        return out.result;
      }
      errors.push(`[anthropic:${anthropicConfig.model}] ${(out as { ok: false; msg: string }).msg}`);
      continue;
    }

    if (provider === "codex") {
      const model = envValue(env, "CODEX_LOCAL_MODEL") || "gpt-5.5";
      const out = await runOne("codex-cli", model, (sys, user) =>
        callCodexAgent({ codexBin, model, systemPrompt: sys, userContent: user, responseSchema, maxTokens })
      );
      if (out.ok) {
        return out.result;
      }
      errors.push(`[codex:${model}] ${(out as { ok: false; msg: string }).msg}`);
    }
  }

  const friendlyMessage =
    errors.length > 0 ? "所有备用模型均已调用失败，请检查模型配置或稍后重试" : "没有可用的 Agent provider";
  throw new ProviderFallbackError(friendlyMessage, errors);
}
