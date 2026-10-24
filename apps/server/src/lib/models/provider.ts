export interface ModelRequest {
  env: Record<string, string>;
  agentId?: string;
  model: string;
  system: string;
  user: string;
  /** Image data URLs; only providers with `vision` accept them. */
  images?: string[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ModelReply {
  text: string;
  /** `<provider>:<model>` */
  model: string;
  reasoning?: string;
}

export interface ModelProvider {
  id: "minimax" | "stepfun";
  vision: boolean;
  apiKeyEnv: string;
  configured(env: Record<string, string>): boolean;
  modelFor(env: Record<string, string>, agentId: string | undefined, withImages: boolean): string;
  /** Per-attempt timeout for this model; undefined means the caller's default. */
  timeoutMs(env: Record<string, string>, model: string): number | undefined;
  /** How many timeouts in a row make the router skip this provider for the process. */
  skipAfterTimeouts(model: string, timeoutMs: number): number;
  call(request: ModelRequest): Promise<ModelReply>;
}

export type ProviderFailureKind = "quota" | "auth" | "connect" | "empty" | "http";

export class ProviderError extends Error {
  kind: ProviderFailureKind;
  cause?: unknown;
  constructor(kind: ProviderFailureKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** Out-of-credit replies, shared by model and search providers; any of them parks the provider. */
export function isQuotaReply(detail: string): boolean {
  return /quota exceeded|insufficient balance|余额不足|额度不足|insufficient.?quota|exceeded your (?:current )?quota|credit(?:s)? (?:exhausted|exceeded|limit)|billing hard limit|over_quota|无可用额度|please top up|usage limit|exceeds your plan|HTTP 402\b/i.test(
    detail
  );
}

const AUTH_REPLY = /invalid api key|invalid_key|incorrect api key|unauthorized|ENOENT|authentication fails|api key[\s\S]{0,80}is invalid|no active [\w ]{0,30}subscription/i;

export function providerHttpError(label: string, detail: string): ProviderError {
  const kind = isQuotaReply(detail) ? "quota" : AUTH_REPLY.test(detail) ? "auth" : "http";
  return new ProviderError(kind, `${label} API 调用失败：${detail}`);
}

/** A reply with no usable text. Not a hard failure: the model may just have run out of tokens while thinking. */
export function emptyReplyError(label: string, detail: string): ProviderError {
  return new ProviderError("empty", `${label} API 没有返回可解析文本${detail}`);
}

/** fetch that reports "never reached the server" as a connect failure; the router retries only those. */
export async function fetchModel(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError && error.message === "fetch failed") {
      throw new ProviderError("connect", error.message, (error as { cause?: unknown }).cause);
    }
    throw error;
  }
}

/** Reads the passed env first (it overrides process.env); blank counts as unset. */
export function envValue(env: Record<string, string>, key: string): string {
  const fromEnv = env[key]?.trim();
  return fromEnv || process.env[key]?.trim() || "";
}

/** "rumor_detector" / "report-composer" -> "RUMOR_DETECTOR" / "REPORT_COMPOSER" */
export function agentEnvKey(agentId?: string): string {
  return agentId ? agentId.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() : "";
}

/** <PREFIX>_<AGENT>_MODEL, then <PREFIX>_MODEL, then the provider default. */
export function modelFromEnv(
  env: Record<string, string>,
  prefix: string,
  agentId: string | undefined,
  fallback: string
): string {
  const key = agentEnvKey(agentId);
  return (key && envValue(env, `${prefix}_${key}_MODEL`)) || envValue(env, `${prefix}_MODEL`) || fallback;
}
