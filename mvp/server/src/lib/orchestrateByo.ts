/**
 * orchestrateByo.ts — BYO key 接管调查管线的请求内凭证层。
 *
 * 用户在模型设置页保存的密钥随 orchestrate-stream 请求上行（payload.byoKey）。
 * 本模块负责四件事：
 *   1. parseByoConfig：请求内 BYO 配置的解析与校验（缺省 = 行为零变化；畸形 = 400 拒绝）；
 *   2. callByoAgent：用请求内凭证直调 OpenAI 兼容 /chat/completions 端点（request-scoped）；
 *   3. searchEnvWithByoCredentials：检索凭证绑定——BYO 端点命中 MiniMax / 阶跃时，
 *      对应检索路径换用用户密钥；其余端点的检索凭证仍全部来自服务端 env；
 *   4. ByoKeyError：凭证失败的 fail-closed 信号——绝不静默回退到服务端 env 密钥。
 * 纪律沿用 test-llm「永不记录 apiKey」：日志与错误信息只允许出现 modelName 这类非密标签。
 */

import dns from "node:dns/promises";

import { fetchWithTimeout } from "./httpUtils.js";
import { buildJsonRepairUserContent, parseAgentJson } from "./providerRouter.js";

export interface ByoConfig {
  /** 已去尾斜杠的接口地址（OpenAI 兼容根，例如 https://api.minimaxi.com/v1） */
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/**
 * BYO 凭证失败（鉴权失败 / 网络失败 / 端点不可用）的 fail-closed 信号。
 * userMessage 是给公开流错误的用户可读文案，绝不含 apiKey 或原始诊断。
 */
export class ByoKeyError extends Error {
  userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "ByoKeyError";
    this.userMessage = userMessage;
  }
}

// ───────────────────────────────────────────────────────────────
// SSRF 防线：与 test-llm 同一纪律（https-only、生产拒绝内网 / loopback / metadata）
// ───────────────────────────────────────────────────────────────

/**
 * dev 明文 HTTP 只放行真正的 loopback 主机名。按 URL 解析后的 hostname 精确判定，
 * 不用前缀匹配：「http://localhost.evil.com」这类公网域名不得借 localhost 前缀穿透。
 */
export function isLocalHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const hostname = parsed.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/** 覆盖 IPv4 私网/保留段、IPv6 ULA/链路本地、以及内网惯用主机名。 */
export function isPrivateAddressText(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // 含云 metadata 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 组播/保留段
    return false;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(h) || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
    return false;
  }
  return false;
}

/** 域名可能解析到内网 IP（含 DNS rebinding），生产环境必须解析后再核验。 */

type DnsLookupFn = (
  hostname: string,
  options: { all: true }
) => Promise<Array<{ address: string; family: number }>>;

const realLookup: DnsLookupFn = dns.lookup.bind(dns) as unknown as DnsLookupFn;
let lookupFn: DnsLookupFn = realLookup;

/** 测试注入点：替换 DNS 解析结果（仅测试用，生产路径始终真实解析）。 */
export function setDnsLookupForTests(fn: DnsLookupFn | undefined): void {
  lookupFn = fn ?? realLookup;
}

export async function baseUrlTargetsPrivateNetwork(baseUrl: string): Promise<boolean> {
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return true; // 非法 URL 一律拦
  }
  if (isPrivateAddressText(hostname)) return true;
  try {
    const resolved = await lookupFn(hostname, { all: true });
    return resolved.some((row) => isPrivateAddressText(row.address));
  } catch {
    // DNS 解析失败：交给后续 fetch 自然报错，不在这里放结论
    return false;
  }
}

// ───────────────────────────────────────────────────────────────
// parseByoConfig — 请求内 BYO 配置的解析与校验
// ───────────────────────────────────────────────────────────────

export type ByoConfigParseResult =
  | { ok: true; config?: ByoConfig }
  | { ok: false; error: string };

/**
 * payload.byoKey 的解析：
 * - 未携带（undefined / null）→ ok 且无 config，请求行为与现状完全一致；
 * - 携带但形状不完整 / baseUrl 不合安全规则 → ok=false（由 handler 回 400，绝不半信半疑地接管）；
 * - 合法 → 归一化后的 ByoConfig。
 */
export async function parseByoConfig(raw: unknown): Promise<ByoConfigParseResult> {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "byoKey 必须是 { baseUrl, apiKey, modelName } 对象" };
  }
  const { baseUrl, apiKey, modelName } = raw as Record<string, unknown>;
  if (
    typeof baseUrl !== "string" ||
    !baseUrl.trim() ||
    typeof apiKey !== "string" ||
    !apiKey.trim() ||
    typeof modelName !== "string" ||
    !modelName.trim()
  ) {
    return { ok: false, error: "byoKey 配置不完整：baseUrl、apiKey、modelName 三项都必填" };
  }
  const trimmedBase = baseUrl.trim();
  const isLocalHttp = isLocalHttpUrl(trimmedBase);
  let parsedOriginOk = false;
  try {
    parsedOriginOk = new URL(trimmedBase).protocol === "https:";
  } catch {
    parsedOriginOk = false;
  }
  if (!parsedOriginOk && !isLocalHttp) {
    return { ok: false, error: "byoKey.baseUrl 必须以 https:// 开头（dev 允许 http://localhost）" };
  }
  const normalizedBase = trimmedBase.replace(/\/$/, "");
  if (!isLocalHttp && (await baseUrlTargetsPrivateNetwork(normalizedBase))) {
    return { ok: false, error: "byoKey.baseUrl 禁止指向 loopback 或内网地址" };
  }
  return { ok: true, config: { baseUrl: normalizedBase, apiKey: apiKey.trim(), modelName: modelName.trim() } };
}

// ───────────────────────────────────────────────────────────────
// callByoAgent — 请求内凭证直调 OpenAI 兼容端点
// ───────────────────────────────────────────────────────────────

/** 服务器日志与诊断只允许这类非密标签（沿用 test-llm 的 safeLabel 纪律）。 */
function byoSafeLabel(byo: ByoConfig): string {
  return byo.modelName || "用户配置模型";
}

/** 诊断文本里的任何 apiKey 出现都替换为 ***（防 provider 回显把密钥带进日志）。 */
function sanitizeDetail(text: string, byo: ByoConfig): string {
  const safe = byo.apiKey ? text.split(byo.apiKey).join("***") : text;
  return safe.slice(0, 300);
}

function byoHttpError(status: number, data: unknown, byo: ByoConfig): ByoKeyError {
  void data; // 原始响应体不进用户文案也不进日志，避免任何回显链路
  if (status === 401 || status === 403) {
    return new ByoKeyError(
      "你保存的模型密钥没有通过校验（鉴权失败），这次核查已停止，没有消耗服务器额度。请到模型设置检查密钥后重试。"
    );
  }
  if (status === 402 || status === 429) {
    return new ByoKeyError(
      "你保存的模型密钥额度不足或被限流，这次核查已停止，没有消耗服务器额度。请检查这把密钥的额度后重试。"
    );
  }
  void byo;
  return new ByoKeyError(
    `你保存的模型服务调用失败（HTTP ${status}），这次核查已停止，没有消耗服务器额度。请检查模型设置里的接口地址、模型名与密钥。`
  );
}

/**
 * 单次 OpenAI 兼容 /chat/completions 调用 + JSON 解析（坏输出同端点重修一次，
 * 修不动抛普通 Error——那是模型输出问题，不是凭证问题，走现有 agent_error 语义）。
 */
async function callByoChatCompletion(
  byo: ByoConfig,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  timeoutMs: number
): Promise<{ text: string; reasoning?: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${byo.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${byo.apiKey}`,
        },
        body: JSON.stringify({
          model: byo.modelName,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
      },
      timeoutMs,
      byoSafeLabel(byo)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[byo-key] primary model call failed (network) label=${byoSafeLabel(byo)} detail=${sanitizeDetail(message, byo)}`
    );
    if (/超时 \d+ms/.test(message)) {
      throw new ByoKeyError(
        "连接你保存的模型服务超时，这次核查已停止，没有消耗服务器额度。请检查模型设置里的接口地址后重试。"
      );
    }
    throw new ByoKeyError(
      "连接你保存的模型服务失败，这次核查已停止，没有消耗服务器额度。请检查模型设置里的接口地址与密钥后重试。"
    );
  }
  if (!response.ok) {
    console.error(
      `[byo-key] primary model call failed (HTTP ${response.status}) label=${byoSafeLabel(byo)}`
    );
    throw byoHttpError(response.status, undefined, byo);
  }
  const data: unknown = await response.json().catch(() => null);
  const message =
    data && typeof data === "object"
      ? (data as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> })
          .choices?.[0]?.message
      : undefined;
  const text = typeof message?.content === "string" ? message.content : "";
  const reasoning =
    typeof message?.reasoning_content === "string" && message.reasoning_content.trim()
      ? message.reasoning_content
      : undefined;
  if (!text.trim() && !reasoning) {
    console.error(`[byo-key] primary model call returned no usable text label=${byoSafeLabel(byo)}`);
    throw new ByoKeyError(
      "你保存的模型服务没有返回可解析内容，这次核查已停止，没有消耗服务器额度。请检查模型设置里的模型名后重试。"
    );
  }
  return { text, reasoning };
}

/** BYO 接管模式下的一次主力模型调用：返回与 callAgentWithFallback 兼容的结果形状。 */
export async function callByoAgent(params: {
  byo: ByoConfig;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ output: any; model: string; reasoning?: string }> {
  const { byo } = params;
  const raw = await callByoChatCompletion(
    byo,
    params.systemPrompt,
    params.userContent,
    params.maxTokens,
    params.timeoutMs
  );
  const modelLabel = `byo:${byo.modelName}`;
  try {
    return { output: parseAgentJson(raw.text, modelLabel), model: modelLabel, reasoning: raw.reasoning };
  } catch (parseError) {
    // 输出解析失败不是凭证失败：同端点用用户自己的密钥再修一次（与 fallback 链的 repair 重试同策略）。
    const repairRaw = await callByoChatCompletion(
      byo,
      [
        params.systemPrompt,
        "",
        "# CRITICAL OUTPUT RULE",
        "Return ONLY one valid JSON object. No markdown fences. No commentary.",
        "Escape all quotes inside strings. No trailing commas. Complete all braces.",
      ].join("\n"),
      buildJsonRepairUserContent(raw.text, params.userContent),
      params.maxTokens,
      params.timeoutMs
    );
    const output = parseAgentJson(repairRaw.text, modelLabel);
    return { output, model: modelLabel, reasoning: repairRaw.reasoning };
  }
}

// ───────────────────────────────────────────────────────────────
// 检索凭证绑定：BYO 端点命中哪家，哪家的检索路径换用户密钥
// ───────────────────────────────────────────────────────────────

function byoHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host: string, apex: string): boolean {
  return host === apex || host.endsWith(`.${apex}`);
}

/** MiniMax 官方 API 域（含国际 .minimax.io 与国内 .minimax.cn 别名族）。 */
export function isMiniMaxByoHost(baseUrl: string): boolean {
  const host = byoHostname(baseUrl);
  return (
    hostMatches(host, "minimaxi.com") || hostMatches(host, "minimax.io") || hostMatches(host, "minimax.cn")
  );
}

/** 阶跃星辰官方 API 域。 */
export function isStepFunByoHost(baseUrl: string): boolean {
  return hostMatches(byoHostname(baseUrl), "stepfun.com");
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

/**
 * 检索专用的请求内 env：
 * - BYO 端点命中 MiniMax → MiniMax token plan 检索路径换用户密钥，检索域名取用户端点 origin；
 * - 命中阶跃 → 阶跃 Step Plan 检索路径换用户密钥；
 * - 其余端点（DeepSeek / Kimi / 自定义等）→ 原样返回 env，检索凭证与服务端现状完全一致。
 * 该 env 只供检索链路使用；主力模型调用在接管模式下直调用户端点，不经过 provider 链。
 */
export function searchEnvWithByoCredentials(
  env: Record<string, string>,
  byo: ByoConfig | undefined
): Record<string, string> {
  if (!byo) return env;
  if (isMiniMaxByoHost(byo.baseUrl)) {
    return { ...env, MINIMAX_API_KEY: byo.apiKey, MINIMAX_BASE_URL: originOf(byo.baseUrl) };
  }
  if (isStepFunByoHost(byo.baseUrl)) {
    return { ...env, STEPFUN_API_KEY: byo.apiKey, STEPFUN_BASE_URL: originOf(byo.baseUrl) };
  }
  return env;
}
