/**
 * searchProviders.ts — 并行搜索矩阵与 per-atom 检索入口 retrieveAtomSources。失败不阻断整次核查。
 * 默认引擎：MiniMax 套餐 / 阶跃 Step Plan / Exa / 百度千帆 / 本机 open-webSearch（各自有密钥或地址才启用）。
 * 360 / AnySearch / Metaso / Tavily 只在 SEARCH_PROVIDERS 里点名且有密钥时启用。
 */

import { randomUUID } from "node:crypto";

import { buildAtomSearchQueries, mergeParallelSearchPayloads } from "./atomSearchQuery.js";

import { canonicalizeUrl } from "./retrievalFilter.js";

import { stringItems } from "./valueCoerce.js";

import { fetchWithTimeout, getTimeoutMs } from "./httpUtils.js";
import { withExecutionBudget, type ExecutionBudget } from "./executionBudget.js";

function getSearch360ApiKey(env: Record<string, string>) {
  return env.QIHOO_360_API_KEY || process.env.QIHOO_360_API_KEY || "";
}

function getTavilyApiKey(env: Record<string, string>) {
  return env.TAVILY_API_KEY || process.env.TAVILY_API_KEY || "";
}

function getMetasoApiKey(env: Record<string, string>) {
  return env.METASO_API_KEY || process.env.METASO_API_KEY || "";
}

function getExaApiKey(env: Record<string, string>) {
  return env.EXA_API_KEY || process.env.EXA_API_KEY || "";
}

function getAnySearchApiKey(env: Record<string, string>) {
  return env.ANYSEARCH_API_KEY || process.env.ANYSEARCH_API_KEY || "";
}

function getMiniMaxSearchApiKey(env: Record<string, string>) {
  return env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY || "";
}

function getStepFunSearchApiKey(env: Record<string, string>) {
  return env.STEPFUN_API_KEY || process.env.STEPFUN_API_KEY || "";
}

function getQianfanApiKey(env: Record<string, string>) {
  return env.QIANFAN_API_KEY || process.env.QIANFAN_API_KEY || "";
}

function getOpenWebSearchUrl(env: Record<string, string>) {
  return (env.OPEN_WEBSEARCH_URL || process.env.OPEN_WEBSEARCH_URL || "").trim().replace(/\/+$/, "");
}

function envFieldPresent(env: Record<string, string>, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

const SEARCH_QUOTA_SKIP_MS = 10 * 60 * 1000;
const searchQuotaExhaustedUntil = new Map<string, number>();

export function resetSearchQuotaSkipForTests(): void {
  searchQuotaExhaustedUntil.clear();
}

export function isHardSearchQuotaError(message: string): boolean {
  return /quota exceeded|insufficient balance|余额不足|额度不足|insufficient.?quota|exceeded your (?:current )?quota|credit(?:s)? (?:exhausted|exceeded|limit)|billing hard limit|over_quota|无可用额度|please top up|usage limit|exceeds your plan|daily free quota|QUOTA_USER_DAILY_FREE|HTTP 402\b|HTTP 432\b/i.test(
    message
  );
}

function noteSearchFailure(provider: string, message: string): void {
  if (isHardSearchQuotaError(message)) {
    searchQuotaExhaustedUntil.set(provider, Date.now() + SEARCH_QUOTA_SKIP_MS);
  }
}

function isSearchQuotaSkipped(provider: string): boolean {
  const until = searchQuotaExhaustedUntil.get(provider);
  return typeof until === "number" && until > Date.now();
}

function httpFailMessage(name: string, response: Response, data: unknown): string {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const error = rec.error;
  const errorMessage =
    error && typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : typeof error === "string"
        ? error
        : "";
  const detail =
    errorMessage ||
    (typeof rec.message === "string" ? rec.message : "") ||
    response.statusText ||
    "";
  return `${name} 调用失败：HTTP ${response.status}${detail ? ` ${detail}` : ""}`;
}

function getSearchFetchTimeoutMs(env: Record<string, string>) {
  return getTimeoutMs(env, "SEARCH_FETCH_TIMEOUT_MS", 10000);
}

export function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "Parallel Search";
  if (result?._source === "anysearch-search") return "AnySearch";
  if (result?._source === "metaso-search") return "Metaso Search";
  if (result?._source === "tavily-search") return "Tavily Search";
  if (result?._source === "exa-search") return "Exa Search";
  if (result?._source === "360-mwebsearch") return "360 智搜";
  if (result?._source === "minimax-coding-plan") return "MiniMax Token Plan";
  if (result?._source === "stepfun-step-plan") return "阶跃 Step Plan";
  if (result?._source === "qianfan-search") return "百度千帆搜索";
  if (result?._source === "open-websearch") return "open-webSearch";
  if (result?._source === "tool-error") return "Search Tool";
  return "Search";
}

export function build360SearchFailure(query: string, message: string) {
  return {
    answer: "",
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: [`360 搜索真实调用失败：${message}`],
    relatedQuestions: [],
    model: "360-ai-search:error",
    traceText: `360 搜索真实调用失败：“${query}”未产生可引用证据。原因：${message}`,
    _source: "tool-error",
  };
}

/** 给核查模型看的来源：标题、URL、域名、片段。不带 S1/C1 这类检索序号。 */
function agentFacingSource(source: any) {
  const url = String(source?.url || source?.link || "").trim();
  const domain = String(source?.domain || source?.site || "").trim();
  const title = String(source?.title || source?.name || "").trim().slice(0, 120) || domain || url;
  if (!title && !url) return null;
  return {
    title,
    url,
    domain,
    snippet: String(source?.snippet || source?.summary || source?.content || ""),
    role: source?.evidenceRole || source?.role || "线索",
    credibility: source?.credibility || "",
  };
}

function agentFacingSources(list: unknown, limit: number) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map(agentFacingSource).filter(Boolean);
}

export function compactSearchResultForAgent(searchResult: any) {
  const sources = agentFacingSources(searchResult?.sources, 8).map((source) => ({
    ...source!,
    title: String(source!.title).slice(0, 120),
    snippet: String(source!.snippet).slice(0, 450),
  }));

  return {
    answer: typeof searchResult?.answer === "string" ? searchResult.answer.slice(0, 1800) : "",
    sources,
    supportingEvidence: stringItems(searchResult?.supportingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    contradictingEvidence: stringItems(searchResult?.contradictingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    unresolvedEvidenceGaps: stringItems(searchResult?.unresolvedEvidenceGaps).slice(0, 4).map((item) => item.slice(0, 240)),
    relatedQuestions: stringItems(searchResult?.relatedQuestions).slice(0, 4),
    model: String(searchResult?.model || ""),
    traceText: String(searchResult?.traceText || "").slice(0, 700),
    _source: searchResult?._source || "search",
  };
}

/**
 * 360 检索（生产唯一路径）。
 * 2026-08-06 实测：`/v1/search/aisearch` 持续 18–25s 超时，已下线该路径，
 * 仅保留可用的 `/v2/mwebsearch`（含 trusted_sources / exclude_aigc）。
 */
async function call360AiSearch({
  env,
  query,
  model: _model,
  refProm,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
  signal?: AbortSignal;
}) {
  const apiKey = getSearch360ApiKey(env);
  if (!apiKey) throw new Error("未配置 360 API key");
  return await call360MWebSearch({ env, apiKey, query, refProm, signal });
}

export type SearchProviderId =
  | "360_search"
  | "any_search"
  | "metaso_search"
  | "tavily_search"
  | "exa_search"
  | "minimax_search"
  | "stepfun_search"
  | "qianfan_search"
  | "open_websearch";

/** 单 Provider 在产品侧的进度态（SSE search_progress 用，不含任何诊断/密钥/请求 ID）。 */
export type SearchProviderProgress = {
  id: SearchProviderId;
  label: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  resultCount: number;
};

/** 每原子一条的多路检索进度事件（前端消费，字段语义冻结自 Issue #9）。 */
export type SearchProgressEvent = {
  type: "search_progress";
  atom: string;
  phase: "started" | "progress" | "completed";
  queryCount: number;
  providers: SearchProviderProgress[];
  stats?: {
    rawResultCount: number;
    uniqueSourceCount: number;
    sharedSourceCount: number;
    singleProviderSourceCount: number;
  };
  sources?: Array<{ title: string; url: string; providerOrigins: string[] }>;
  timestamp: number;
};

const ALL_SEARCH_PROVIDERS: SearchProviderId[] = [
  "360_search",
  "any_search",
  "metaso_search",
  "tavily_search",
  "exa_search",
  "minimax_search",
  "stepfun_search",
  "qianfan_search",
  "open_websearch",
];

/** 不点名时的默认引擎。360 / AnySearch / Metaso / Tavily 要在 SEARCH_PROVIDERS 里点名才用。 */
const DEFAULT_SEARCH_PROVIDERS: SearchProviderId[] = [
  "minimax_search",
  "stepfun_search",
  "exa_search",
  "qianfan_search",
  "open_websearch",
];

const PROVIDER_KEY_FIELD: Record<SearchProviderId, string> = {
  "360_search": "QIHOO_360_API_KEY",
  any_search: "ANYSEARCH_API_KEY",
  metaso_search: "METASO_API_KEY",
  tavily_search: "TAVILY_API_KEY",
  exa_search: "EXA_API_KEY",
  minimax_search: "MINIMAX_API_KEY",
  stepfun_search: "STEPFUN_API_KEY",
  qianfan_search: "QIANFAN_API_KEY",
  open_websearch: "OPEN_WEBSEARCH_URL",
};

function envValue(env: Record<string, string>, key: string): string {
  const value = env[key] ?? process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function parallelSearchProviders(env: Record<string, string>): SearchProviderId[] {
  const named = envValue(env, "SEARCH_PROVIDERS")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SearchProviderId => (ALL_SEARCH_PROVIDERS as string[]).includes(s));
  const wanted = named.length > 0 ? named : DEFAULT_SEARCH_PROVIDERS;
  return wanted.filter((id) => envValue(env, PROVIDER_KEY_FIELD[id]).length > 0);
}

/** 每个 atom 每个引擎最多跑几条查询（默认 2）。 */
function maxQueriesPerAtom(env: Record<string, string>): number {
  const n = Number(envValue(env, "SEARCH_QUERIES_PER_ATOM") || 2);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** 保留原句直查，再按原顺序补到上限。 */
export function capAtomQueries(atom: string, queries: string[], max: number): string[] {
  if (queries.length <= max) return queries;
  const t = atom.replace(/\s+/g, " ").trim();
  const exact = queries.find((q) => q === t);
  const rest = queries.filter((q) => q !== exact);
  return (exact ? [exact, ...rest] : rest).slice(0, max);
}

/** 进程内并发闸。阶跃 Step Plan 账号并发上限 8，评测 --jobs 2 每进程各占一半。 */
const providerInFlight = new Map<string, number>();
const providerWaiters = new Map<string, Array<() => void>>();
function providerConcurrency(env: Record<string, string>, provider: string): number {
  if (provider !== "stepfun_search") return Infinity;
  const n = Number(envValue(env, "STEPFUN_SEARCH_MAX_CONCURRENCY") || 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 4;
}
async function withProviderSlot<T>(env: Record<string, string>, provider: string, run: () => Promise<T>): Promise<T> {
  const limit = providerConcurrency(env, provider);
  if (limit === Infinity) return run();
  while ((providerInFlight.get(provider) ?? 0) >= limit) {
    await new Promise<void>((resolve) => {
      const list = providerWaiters.get(provider) ?? [];
      list.push(resolve);
      providerWaiters.set(provider, list);
    });
  }
  providerInFlight.set(provider, (providerInFlight.get(provider) ?? 0) + 1);
  try {
    return await run();
  } finally {
    providerInFlight.set(provider, (providerInFlight.get(provider) ?? 1) - 1);
    providerWaiters.get(provider)?.shift()?.();
  }
}

export async function callSearchProvider({
  env,
  provider,
  query,
  model,
  refProm,
  signal: parentSignal,
  deadlineMs,
}: {
  env: Record<string, string>;
  provider: string;
  query: string;
  model?: string;
  refProm?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}) {
  parentSignal?.throwIfAborted();
  if (isSearchQuotaSkipped(provider)) {
    throw new Error(`${getProviderLabel(provider)} 额度耗尽，本进程已跳过`);
  }
  try {
    return await withProviderSlot(env, provider, () => withExecutionBudget(async (signal) => {
      switch (provider) {
        case "360_search":
          return await call360AiSearch({ env, query, model, refProm, signal });
        case "any_search":
          return await callAnySearchSearch({ env, query, signal });
        case "metaso_search":
          return await callMetasoSearch({ env, query, signal });
        case "tavily_search":
          return await callTavilySearch({ env, query, signal });
        case "exa_search":
          return await callExaSearch({ env, query, signal });
        case "minimax_search":
          return await callMiniMaxCodingPlanSearch({ env, query, signal });
        case "stepfun_search":
          return await callStepFunPlanMcpSearch({ env, query, signal });
        case "qianfan_search":
          return await callQianfanWebSearch({ env, query, signal });
        case "open_websearch":
          return await callOpenWebSearch({ env, query, signal });
        default:
          throw new Error(`未知搜索 Provider：${provider}`);
      }
    }, { signal: parentSignal, deadlineMs, timeoutMs: getTimeoutMs(env, "SEARCH_PROVIDER_TIMEOUT_MS", 25000), label: getProviderLabel(provider) }));
  } catch (reason) {
    parentSignal?.throwIfAborted();
    const message = reason instanceof Error ? reason.message : String(reason);
    noteSearchFailure(provider, message);
    throw reason;
  }
}

async function callSearchProviderWithTimeout({
  env,
  provider,
  query,
  model,
  refProm,
  signal,
  deadlineMs,
}: {
  env: Record<string, string>;
  provider: SearchProviderId;
  query: string;
  model?: string;
  refProm?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}) {
  return callSearchProvider({ env, provider, query, model, refProm, signal, deadlineMs });
}

/** 单 Provider 单次查询的调用结果（仅产品字段，无诊断）。 */
export type ProviderCallEvent = {
  provider: SearchProviderId;
  status: "running" | "completed" | "failed";
  resultCount: number;
};

export async function callParallelSearchProviders({
  env,
  query,
  model,
  refProm,
  onProviderEvent,
  signal,
  deadlineMs,
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
  /** 每个 Provider 的 start/success/failure 实时上报（SSE search_progress 数据源）。 */
  onProviderEvent?: (event: ProviderCallEvent) => void;
  signal?: AbortSignal;
  deadlineMs?: number;
}) {
  signal?.throwIfAborted();
  const providers: SearchProviderId[] = parallelSearchProviders(env);
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      onProviderEvent?.({ provider, status: "running", resultCount: 0 });
      try {
        const result = await callSearchProviderWithTimeout({ env, provider, query, model, refProm, signal, deadlineMs });
        signal?.throwIfAborted();
        const resultCount = Array.isArray(result?.sources) ? result.sources.length : 0;
        onProviderEvent?.({ provider, status: "completed", resultCount });
        return { provider, result };
      } catch (error) {
        signal?.throwIfAborted();
        onProviderEvent?.({ provider, status: "failed", resultCount: 0 });
        throw error;
      }
    })
  );

  const successes: Array<{ provider: SearchProviderId; result: any }> = [];
  signal?.throwIfAborted();
  const failures: string[] = [];
  settled.forEach((item, index) => {
    const provider = providers[index];
    if (item.status === "fulfilled") {
      successes.push(item.value);
    } else {
      const message = item.reason instanceof Error ? item.reason.message : `${provider} 未返回真实结果`;
      failures.push(`${getProviderLabel(provider)} 真实调用失败：${message}`);
    }
  });

  if (successes.length === 0) {
    throw new Error(failures.join("；") || "所有搜索 Provider 均未返回真实结果");
  }

  // 每条来源打上来源 Provider 归属；mergeParallelSearchPayloads 跨查询 UNION。
  const sources = successes.flatMap(({ provider, result }) =>
    (result.sources ?? []).map((source: any) => ({ ...source, providerOrigins: [provider] }))
  );
  const has360Success = successes.some(({ provider }) => provider === "360_search");
  const providerSummary = successes
    .map(({ provider, result }) => `${getProviderLabel(provider)} ${result.sources?.length ?? 0} 条`)
    .join("，");
  return {
    answer: successes
      .map(({ provider, result }) => `【${getProviderLabel(provider)}】${result.answer || result.traceText || "已返回真实来源"}`)
      .join("\n\n"),
    sources,
    unresolvedEvidenceGaps: failures,
    relatedQuestions: Array.from(new Set(successes.flatMap(({ result }) => result.relatedQuestions ?? []))).slice(0, 8),
    model: successes.map(({ result }) => result.model).filter(Boolean).join(" + "),
    traceText: `${has360Success ? "并行检索含 360 智搜(mweb)" : "360 智搜未返回可用结果，已用其它源交叉"}：${providerSummary}。${failures.length ? `失败：${failures.join("；")}` : ""}`,
    _source: "parallel-search",
  };
}

/** 收敛统计：rawResultCount 由调用方传入（含重复的逐 provider 逐 query 返回数之和）。 */
export function computeSearchProgressStats(
  sources: Array<Record<string, unknown>>,
  rawResultCount: number
): NonNullable<SearchProgressEvent["stats"]> {
  const originsByKey = new Map<string, Set<string>>();
  for (const rec of sources) {
    if (!rec || typeof rec !== "object") continue;
    const url = String(rec.url ?? "").trim();
    if (!url) continue;
    const key = canonicalizeUrl(url) ?? url;
    const origins = Array.isArray(rec.providerOrigins)
      ? rec.providerOrigins.filter((o): o is string => typeof o === "string")
      : [];
    const set = originsByKey.get(key) ?? new Set<string>();
    origins.forEach((o) => set.add(o));
    originsByKey.set(key, set);
  }
  let sharedSourceCount = 0;
  let singleProviderSourceCount = 0;
  for (const set of originsByKey.values()) {
    if (set.size >= 2) sharedSourceCount += 1;
    else if (set.size === 1) singleProviderSourceCount += 1;
  }
  return { rawResultCount, uniqueSourceCount: originsByKey.size, sharedSourceCount, singleProviderSourceCount };
}

/** 事件 sources 与 stats 同口径：按规范化 URL 合并 providerOrigins，只留产品字段。 */
function publicProgressSources(
  sources: Array<Record<string, unknown>>
): NonNullable<SearchProgressEvent["sources"]> {
  const byKey = new Map<string, { title: string; url: string; providerOrigins: string[] }>();
  for (const rec of sources) {
    if (!rec || typeof rec !== "object") continue;
    const url = String(rec.url ?? "").trim();
    if (!url) continue;
    const key = canonicalizeUrl(url) ?? url;
    const origins = Array.isArray(rec.providerOrigins)
      ? rec.providerOrigins.filter((o): o is string => typeof o === "string")
      : [];
    const existing = byKey.get(key);
    if (existing) {
      for (const o of origins) if (!existing.providerOrigins.includes(o)) existing.providerOrigins.push(o);
      continue;
    }
    byKey.set(key, { title: String(rec.title ?? "").slice(0, 200), url, providerOrigins: [...origins] });
  }
  return [...byKey.values()];
}

/** Production per-atom search: query recipe, then merge URLs. */
export async function retrieveAtomSources(
  env: Record<string, string>,
  atom: string,
  onProgress?: (event: SearchProgressEvent) => void,
  execution: ExecutionBudget = {},
) {
  execution.signal?.throwIfAborted();
  const queries = capAtomQueries(atom, buildAtomSearchQueries(atom), maxQueriesPerAtom(env));
  const queryCount = queries.length;
  const providers = parallelSearchProviders(env);

  // 跨 query 聚合的 provider 状态：running 计数 + 成功/失败调用数 + 累计返回条数。
  const inFlight = new Map<SearchProviderId, number>();
  const okCalls = new Map<SearchProviderId, number>();
  const failedCalls = new Map<SearchProviderId, number>();
  const resultTotals = new Map<SearchProviderId, number>();

  const statusOf = (provider: SearchProviderId): SearchProviderProgress["status"] => {
    if ((inFlight.get(provider) ?? 0) > 0) return "running";
    const ok = okCalls.get(provider) ?? 0;
    const fail = failedCalls.get(provider) ?? 0;
    if (ok + fail === 0) return "pending";
    if (ok === 0) return "failed";
    return fail > 0 ? "partial" : "completed";
  };
  const emit = (
    phase: SearchProgressEvent["phase"],
    extra?: Pick<SearchProgressEvent, "stats" | "sources">
  ) => {
    if (!onProgress || execution.signal?.aborted) return;
    onProgress({
      type: "search_progress",
      atom,
      phase,
      queryCount,
      providers: providers.map((provider) => ({
        id: provider,
        label: getProviderLabel(provider),
        status: statusOf(provider),
        resultCount: resultTotals.get(provider) ?? 0,
      })),
      timestamp: Date.now(),
      ...extra,
    });
  };

  const onProviderEvent = (event: ProviderCallEvent) => {
    const provider = event.provider;
    if (event.status === "running") {
      inFlight.set(provider, (inFlight.get(provider) ?? 0) + 1);
    } else {
      inFlight.set(provider, Math.max(0, (inFlight.get(provider) ?? 1) - 1));
      if (event.status === "completed") {
        okCalls.set(provider, (okCalls.get(provider) ?? 0) + 1);
        resultTotals.set(provider, (resultTotals.get(provider) ?? 0) + event.resultCount);
      } else {
        failedCalls.set(provider, (failedCalls.get(provider) ?? 0) + 1);
      }
    }
    emit("progress");
  };

  emit("started");
  const settled = await Promise.allSettled(
    queries.map((query) => callParallelSearchProviders({ env, query, onProviderEvent, ...execution }))
  );
  execution.signal?.throwIfAborted();
  const ok: Record<string, unknown>[] = [];
  const failures: string[] = [];
  settled.forEach((item, index) => {
    if (item.status === "fulfilled") {
      ok.push(item.value as Record<string, unknown>);
      return;
    }
    const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
    failures.push(`${queries[index]}：${message}`);
  });
  const rawResultCount = providers.reduce((n, p) => n + (resultTotals.get(p) ?? 0), 0);

  if (ok.length === 0) {
    // 全失败：completed 帧给出可解释的全 failed 状态（无来源、统计归零），兜底行为不变。
    emit("completed", {
      stats: computeSearchProgressStats([], rawResultCount),
      sources: [],
    });
    return build360SearchFailure(atom, failures.join("；") || "检索未返回真实结果");
  }
  const merged = mergeParallelSearchPayloads(atom, ok);
  if (failures.length > 0) {
    const gaps = Array.isArray(merged.unresolvedEvidenceGaps)
      ? merged.unresolvedEvidenceGaps.filter((g): g is string => typeof g === "string")
      : [];
    merged.unresolvedEvidenceGaps = [...gaps, ...failures].slice(0, 8);
  }
  // 统计必须基于截断前的完整结果集。merged.sources 只保留前 24 条供后续 Agent
  // 使用，不能反过来污染“真实去重来源数”。公开来源清单仍限长，避免 SSE 过大。
  const progressSources = ok.flatMap((payload) =>
    Array.isArray(payload.sources)
      ? payload.sources.filter(
          (source): source is Record<string, unknown> => Boolean(source) && typeof source === "object"
        )
      : []
  );
  emit("completed", {
    stats: computeSearchProgressStats(progressSources, rawResultCount),
    sources: publicProgressSources(progressSources).slice(0, 24),
  });
  return merged;
}

export function getProviderLabel(provider: SearchProviderId | string) {
  const labels: Record<string, string> = {
    "360_search": "360 Search",
    any_search: "AnySearch",
    metaso_search: "Metaso Search",
    tavily_search: "Tavily Search",
    exa_search: "Exa Search",
    minimax_search: "MiniMax Token Plan",
    stepfun_search: "阶跃 Step Plan",
    qianfan_search: "百度千帆搜索",
    open_websearch: "open-webSearch",
  };
  return labels[provider] ?? provider;
}

function minimaxCodingPlanSearchUrl(env: Record<string, string>): string {
  const raw = (env.MINIMAX_BASE_URL || env.MINIMAX_API_HOST || "https://api.minimaxi.com").trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    if (host === "api.minimax.io" || host.endsWith(".minimax.io")) {
      return "https://api.minimax.io/v1/coding_plan/search";
    }
    if (host === "api.minimax.cn" || host.endsWith(".minimax.cn")) {
      return "https://api.minimax.cn/v1/coding_plan/search";
    }
  } catch {
    // 无法解析时走国内默认 host
  }
  return "https://api.minimaxi.com/v1/coding_plan/search";
}

function stepPlanMcpSearchUrl(env: Record<string, string>): string {
  const raw = (env.STEPFUN_BASE_URL || "https://api.stepfun.com/step_plan").replace(/\/+$/, "");
  if (raw.includes("/step_plan")) {
    const base = raw.replace(/\/v1$/, "");
    return `${base}/v1/mcp/web_search/mcp`;
  }
  return "https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp";
}

function parseJsonOrSse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 可能是 SSE 夹了 JSON
    }
  }
  let last: unknown = null;
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^data:\s*(.+)$/);
    if (!match) continue;
    const payload = match[1].trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      last = JSON.parse(payload);
    } catch {
      // 跳过非 JSON 行
    }
  }
  return last;
}

function throwIfMiniMaxSearchFailed(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const base = (data as { base_resp?: { status_code?: unknown; status_msg?: unknown } }).base_resp;
  if (!base || typeof base !== "object") return;
  const code = Number(base.status_code);
  if (!Number.isFinite(code) || code === 0) return;
  const msg = String(base.status_msg ?? `status_code ${code}`);
  throw new Error(`MiniMax 调用失败：${msg}`);
}

function mcpSearchRows(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  if (rec.error && typeof rec.error === "object") {
    const message = String((rec.error as { message?: unknown }).message ?? "MCP error");
    throw new Error(`阶跃 Step Plan 调用失败：${message}`);
  }
  const result =
    rec.result && typeof rec.result === "object" ? (rec.result as Record<string, unknown>) : rec;
  if (result.isError === true) {
    const content = result.content;
    const text =
      Array.isArray(content) && content[0] && typeof content[0] === "object" && "text" in content[0]
        ? String((content[0] as { text: unknown }).text ?? "")
        : "MCP error";
    throw new Error(`阶跃 Step Plan 调用失败：${text.slice(0, 300)}`);
  }
  const structured = result.structuredContent;
  if (structured && typeof structured === "object") {
    const rows = (structured as { results?: unknown }).results;
    if (Array.isArray(rows)) return rows;
  }
  const content = result.content;
  if (!Array.isArray(content)) return [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = "text" in block ? String((block as { text: unknown }).text ?? "") : "";
    if (!text.trim()) continue;
    try {
      const parsed = JSON.parse(text) as { results?: unknown };
      if (Array.isArray(parsed?.results)) return parsed.results;
    } catch {
      // 非 JSON 文本块
    }
  }
  return [];
}

async function callMiniMaxCodingPlanSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getMiniMaxSearchApiKey(env);
  if (!apiKey) throw new Error("未配置 MiniMax API key");
  const response = await fetchWithTimeout(
    minimaxCodingPlanSearchUrl(env),
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
    },
    getSearchFetchTimeoutMs(env),
    "MiniMax"
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(httpFailMessage("MiniMax", response, data));
  throwIfMiniMaxSearchFailed(data);
  const organic =
    data && typeof data === "object" && Array.isArray((data as { organic?: unknown }).organic)
      ? (data as { organic: unknown[] }).organic
      : [];
  const sources = mapProviderSources(organic, (i) => `MiniMax 来源 ${i}`);
  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n"),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["MiniMax 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`],
    model: "coding-plan-web-search",
    traceText: `MiniMax 返回 ${sources.length} 条可追溯来源。`,
    _source: "minimax-coding-plan",
  };
}

async function callStepFunPlanMcpSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getStepFunSearchApiKey(env);
  if (!apiKey) throw new Error("未配置阶跃 API key");
  const response = await fetchWithTimeout(
    stepPlanMcpSearchUrl(env),
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: {
            query,
            n: Number(env.STEPFUN_SEARCH_SIZE || process.env.STEPFUN_SEARCH_SIZE || 8),
          },
        },
      }),
    },
    getSearchFetchTimeoutMs(env),
    "阶跃 Step Plan"
  );
  const raw = await response.text().catch(() => "");
  const data = parseJsonOrSse(raw);
  if (!response.ok) throw new Error(httpFailMessage("阶跃 Step Plan", response, data));
  const rows = mcpSearchRows(data);
  const sources = mapProviderSources(rows, (i) => `阶跃来源 ${i}`);
  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n"),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["阶跃 Step Plan 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`],
    model: "step-plan-mcp-web-search",
    traceText: `阶跃 Step Plan 返回 ${sources.length} 条可追溯来源。`,
    _source: "stepfun-step-plan",
  };
}

async function callAnySearchSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getAnySearchApiKey(env);
  const response = await fetchWithTimeout("https://api.anysearch.com/mcp", {
    method: "POST",
    signal,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query,
          max_results: Number(env.ANYSEARCH_MAX_RESULTS || process.env.ANYSEARCH_MAX_RESULTS || 6),
          zone: env.ANYSEARCH_ZONE || process.env.ANYSEARCH_ZONE || "cn",
        },
      },
    }),
  }, getSearchFetchTimeoutMs(env), "AnySearch");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`AnySearch 调用失败：${detail}`);
  }
  if (data?.error) {
    const detail = data.error?.message || JSON.stringify(data.error);
    throw new Error(`AnySearch 调用失败：${detail}`);
  }

  return normalizeAnySearchResponse(data, query);
}

async function callTavilySearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getTavilyApiKey(env);
  if (!apiKey) throw new Error("未配置 Tavily API key");

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: env.TAVILY_SEARCH_DEPTH || process.env.TAVILY_SEARCH_DEPTH || "basic",
      max_results: Number(env.TAVILY_MAX_RESULTS || process.env.TAVILY_MAX_RESULTS || 6),
      include_answer: true,
      include_raw_content: false,
      include_favicon: true,
      include_usage: true,
    }),
  }, getSearchFetchTimeoutMs(env), "Tavily Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error || data?.message || response.statusText;
    throw new Error(`Tavily Search 调用失败：${detail}`);
  }

  return normalizeTavilySearchResponse(data, query);
}

async function callMetasoSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getMetasoApiKey(env);
  if (!apiKey) throw new Error("未配置 Metaso API key");

  const scope = env.METASO_SEARCH_SCOPE || process.env.METASO_SEARCH_SCOPE || "webpage";
  const response = await fetchWithTimeout("https://metaso.cn/api/v1/search", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      scope,
      size: Number(env.METASO_SEARCH_SIZE || process.env.METASO_SEARCH_SIZE || 10),
      includeSummary: true,
      includeRawContent: false,
      conciseSnippet: true,
    }),
  }, getSearchFetchTimeoutMs(env), "Metaso Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || response.statusText;
    throw new Error(`Metaso Search 调用失败：${detail}`);
  }
  if (data?.errCode || data?.code) {
    const detail = data?.errMsg || data?.message || data?.error || `错误码 ${data.errCode || data.code}`;
    throw new Error(`Metaso Search 调用失败：${detail}`);
  }

  return normalizeMetasoSearchResponse(data, query, scope);
}

async function callExaSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getExaApiKey(env);
  if (!apiKey) throw new Error("未配置 Exa API key");

  const type = env.EXA_SEARCH_TYPE || process.env.EXA_SEARCH_TYPE || "auto";
  const response = await fetchWithTimeout("https://api.exa.ai/search", {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type,
      numResults: Number(env.EXA_MAX_RESULTS || process.env.EXA_MAX_RESULTS || 6),
      // 2026 Exa docs：highlights 作主摘要（省 token）；text 短截断作兜底
      contents: {
        highlights: true,
        text: { maxCharacters: 800 },
      },
    }),
  }, getSearchFetchTimeoutMs(env), "Exa Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || response.statusText;
    throw new Error(`Exa Search 调用失败：${detail}`);
  }

  return normalizeExaSearchResponse(data, query, type);
}

function normalizeTavilySearchResponse(data: any, query: string) {
  const rawItems = Array.isArray(data?.results) ? data.results : [];
  // Tavily: content 字段即摘要
  const items = rawItems.map((s: any) => ({
    ...s,
    snippet: s?.content || s?.raw_content || s?.snippet,
  }));
  const sources = mapProviderSources(items, (i) => `Tavily 来源 ${i}`);

  return {
    answer: String(data?.answer || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `tavily-search:${data?.auto_parameters?.search_depth || "basic"}`,
    traceText: `Tavily Search 返回 ${sources.length} 条可追溯来源，请求 ID：${data?.request_id || "unknown"}。`,
    _source: "tavily-search",
  };
}

function normalizeMetasoSearchResponse(data: any, query: string, scope: string) {
  const rawItems =
    data?.results ||
    data?.items ||
    data?.list ||
    data?.data?.results ||
    data?.data?.items ||
    data?.data?.list ||
    data?.data?.webpages ||
    data?.webpages ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sources = mapProviderSources(items, (i) => `Metaso 来源 ${i}`);

  return {
    answer: String(data?.answer || data?.summary || data?.data?.answer || data?.data?.summary || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Metaso Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `metaso-search:${scope}`,
    traceText: `Metaso Search 返回 ${sources.length} 条可追溯来源。`,
    _source: "metaso-search",
  };
}

function normalizeAnySearchResponse(data: any, query: string) {
  const text = String(
    data?.result?.content?.find?.((item: any) => item?.type === "text")?.text ||
    data?.result?.content?.[0]?.text ||
    ""
  );
  const rawItems = parseAnySearchMarkdownResults(text);
  const sources = mapProviderSources(rawItems, (i) => `AnySearch 来源 ${i}`);

  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n") || text,
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["AnySearch 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: "anysearch:mcp-search",
    traceText: `AnySearch 返回 ${sources.length} 条可追溯来源。`,
    _source: "anysearch-search",
  };
}

function parseAnySearchMarkdownResults(text: string) {
  const sections = text.split(/\n###\s+\d+\.\s+/).slice(1);
  return sections.map((section) => {
    const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = lines[0] ?? "";
    const urlLine = lines.find((line) => line.startsWith("- **URL**:"));
    const url = urlLine?.replace("- **URL**:", "").trim() ?? "";
    const dateLine = lines.find((line) => /^date:/i.test(line));
    const publishedAt = dateLine?.replace(/^date:/i, "").trim() ?? "";
    const snippet = lines
      .filter((line) => !line.startsWith("- **URL**:") && !/^date:/i.test(line))
      .slice(1)
      .join(" ")
      .replace(/^-\s*/, "")
      .trim();
    return { title, url, snippet, publishedAt };
  }).filter((item) => item.title || item.url || item.snippet);
}

function normalizeExaSearchResponse(data: any, query: string, type: string) {
  const rawItems = Array.isArray(data?.results) ? data.results : [];
  // Exa 2026 docs 推荐 highlights 作摘要；text 作全文补充
  const items = rawItems.map((s: any) => ({
    ...s,
    snippet:
      (Array.isArray(s?.highlights) ? s.highlights.filter(Boolean).join(" ") : "") ||
      s?.summary ||
      s?.text ||
      "",
  }));
  const sources = mapProviderSources(items, (i) => `Exa 来源 ${i}`);

  return {
    answer: String(data?.context || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Exa Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `exa-search:${data?.searchType || type}`,
    traceText: `Exa Search 返回 ${sources.length} 条可追溯来源，请求 ID：${data?.requestId || "unknown"}。`,
    _source: "exa-search",
  };
}

async function call360MWebSearch({
  env,
  apiKey,
  query,
  refProm,
  signal,
}: {
  env: Record<string, string>;
  apiKey: string;
  query: string;
  refProm?: string;
  signal?: AbortSignal;
}) {
  const selectedRefProm =
    refProm ||
    env.SEARCH360_REF_PROM ||
    process.env.SEARCH360_REF_PROM ||
    "aiso-max";
  const url = new URL("https://api.360.cn/v2/mwebsearch");
  url.searchParams.set("q", query);
  url.searchParams.set("ref_prom", selectedRefProm);
  url.searchParams.set("sid", randomUUID());
  url.searchParams.set("count", "8");
  url.searchParams.set("summary_len", "500");
  url.searchParams.set("freshness", "1");
  // 提供方侧轻度控噪：偏可信源、尽量排除 AIGC 页（非全量质量保证）
  url.searchParams.set("trusted_sources", "1");
  url.searchParams.set("exclude_aigc", "true");

  const response = await fetchWithTimeout(url, {
    signal,
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }, getSearchFetchTimeoutMs(env), `360 智搜 ${selectedRefProm}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`360 智搜 ${selectedRefProm} 调用失败：${detail}`);
  }
  if (data?.errno != null && Number(data.errno) !== 0) {
    throw new Error(`360 智搜 ${selectedRefProm} 调用失败：${data?.message || `errno ${data.errno}`}`);
  }

  return normalize360MWebSearchResponse(data, query, selectedRefProm);
}

/** 域名启发式：粗标可信度。不是权威鉴定，只减少「按排名瞎标高」的误导。 */
function estimateSourceCredibility(url: string): string {
  if (!url) return "未知";
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (
      host.endsWith(".gov.cn") ||
      host.endsWith(".edu.cn") ||
      /\.(gov|edu)$/.test(host) ||
      host.endsWith(".gov") ||
      host.endsWith(".edu") ||
      /(who\.int|nih\.gov|cdc\.gov|fda\.gov|nature\.com|science\.org|thelancet\.com|bmj\.com|cas\.cn|chinacdc\.cn|xinhuanet\.com|people\.com\.cn|cctv\.com)$/.test(host) ||
      host.includes("wikipedia.org")
    ) {
      return "高";
    }
    if (
      /(weixin\.qq\.com|zhihu\.com|baidu\.com|toutiao\.com|xiaohongshu\.com|douyin\.com|weibo\.com|bilibili\.com|sohu\.com|netease\.com|qq\.com)$/.test(host) ||
      host.includes("mp.weixin")
    ) {
      return "低";
    }
  } catch {
    return "未知";
  }
  return "中";
}

function mapProviderSources(
  items: any[],
  titleFallback: (index: number) => string
): Array<{ title: string; url: string; snippet: string; credibility: string; publishedAt?: string; publisher?: string }> {
  const out: Array<{ title: string; url: string; snippet: string; credibility: string; publishedAt?: string; publisher?: string }> = [];
  for (let index = 0; index < items.length && out.length < 8; index += 1) {
    const source = items[index];
    if (!source || typeof source !== "object") continue;
    const url = String(source?.url || source?.link || source?.href || source?.web_url || source?.display_url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue; // 无有效 URL = 不可追溯，直接丢
    const publishedAt = String(source?.publishedAt || source?.date || source?.time || "").trim();
    // 发布者只取 provider 实际返回的字段；拿不到就是缺失，不用站点名或抓取信息补造。
    const publisher = String(source?.publisher || source?.siteName || source?.site_name || source?.site || "").trim();
    const row: { title: string; url: string; snippet: string; credibility: string; publishedAt?: string; publisher?: string } = {
      title: String(source?.title || source?.name || source?.site_name || titleFallback(out.length + 1)).slice(0, 200),
      url,
      snippet: String(
        source?.summary_ai ||
          source?.summary ||
          source?.snippet ||
          source?.content ||
          source?.text ||
          source?.description ||
          source?.desc ||
          ""
      ).slice(0, 500),
      credibility: estimateSourceCredibility(url),
    };
    if (publishedAt) row.publishedAt = publishedAt;
    if (publisher) row.publisher = publisher;
    out.push(row);
  }
  return out;
}

function normalize360MWebSearchResponse(data: any, query: string, refProm: string) {
  const rawItems =
    data?.items ||
    data?.results ||
    data?.data?.items ||
    data?.data?.results ||
    data?.data?.list ||
    data?.result ||
    data?.data ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sources = mapProviderSources(items, (i) => `360 智搜来源 ${i}`);
  const answer = sources.length > 0
    ? sources.map((source) => `【${source.title}】${source.snippet}`).filter(Boolean).join("\n")
    : `360 智搜已返回“${query}”的检索响应，但未解析到可追溯来源。`;

  return {
    answer,
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `360-mwebsearch:${refProm}`,
    traceText: `360 智搜 ${refProm} 返回 ${sources.length} 条可追溯来源（已跳过失效 aisearch）。`,
    _source: "360-mwebsearch",
  };
}

/* ------------------------------------------------------------ 百度千帆 web_search */

/** 千帆 query 上限 72 字符（一个汉字算 2），超出部分官方直接截掉；这里先按同一口径截断。 */
function clipQianfanQuery(query: string): string {
  let width = 0;
  let out = "";
  for (const ch of query) {
    width += /[\u0000-\u00ff]/.test(ch) ? 1 : 2;
    if (width > 72) break;
    out += ch;
  }
  return out;
}

/**
 * 千帆只搜这些站点（search_filter.match.site，文档上限 100 个；子域名一并命中，例如 zj.xinhuanet.com）。
 * 不过滤时结果偏向最新自媒体，烟测里没有一条被用作依据。过滤后搜不到就是没有，不退回全网搜索。
 */
const QIANFAN_DEFAULT_SITES = [
  "gov.cn", "www.gov.cn", "nhc.gov.cn", "piyao.org.cn", "news.cn", "xinhuanet.com", "people.com.cn",
  "cctv.com", "cctv.cn", "cnr.cn", "gmw.cn", "chinanews.com.cn", "chinadaily.com.cn", "chinacdc.cn",
  "thepaper.cn", "caixin.com", "guokr.com", "dxy.cn", "who.int",
];

function qianfanSites(env: Record<string, string>): string[] {
  const raw = envValue(env, "QIANFAN_SITES");
  const list = raw ? raw.split(",").map((s) => s.trim().replace(/^\*\./, "")).filter(Boolean) : QIANFAN_DEFAULT_SITES;
  return [...new Set(list)].slice(0, 100);
}

const QIANFAN_RECENCY = new Set(["week", "month", "semiyear", "year"]);

async function callQianfanWebSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const apiKey = getQianfanApiKey(env);
  if (!apiKey) throw new Error("未配置百度千帆 API key");
  const topK = Number(envValue(env, "QIANFAN_SEARCH_TOP_K") || 10);
  const response = await fetchWithTimeout("https://qianfan.baidubce.com/v2/ai_search/web_search", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: clipQianfanQuery(query) }],
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: Number.isFinite(topK) && topK > 0 ? Math.min(50, topK) : 10 }],
      search_filter: { match: { site: qianfanSites(env) } },
      ...(QIANFAN_RECENCY.has(envValue(env, "QIANFAN_RECENCY")) ? { search_recency_filter: envValue(env, "QIANFAN_RECENCY") } : {}),
    }),
  }, getSearchFetchTimeoutMs(env), "百度千帆搜索");
  const data: any = await response.json().catch(() => null);
  if (!response.ok || data?.code || data?.error) {
    const detail = [data?.code, data?.message || data?.error?.message || data?.error || response.statusText].filter(Boolean).join(" ");
    throw new Error(`百度千帆搜索调用失败：HTTP ${response.status} ${String(detail ?? "")}`.trim());
  }
  const refs = Array.isArray(data?.references) ? data.references : [];
  const sources = mapProviderSources(
    refs.map((r: any) => ({ ...r, snippet: r?.snippet || r?.content, siteName: r?.website })),
    (i) => `百度千帆来源 ${i}`,
  );
  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n"),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["百度千帆搜索未返回可引用来源。"],
    relatedQuestions: [],
    model: "qianfan:baidu_search_v2",
    traceText: `百度千帆搜索返回 ${sources.length} 条可追溯来源，请求 ID：${data?.request_id || "unknown"}。`,
    _source: "qianfan-search",
  };
}

/* ------------------------------------------------- 本机 open-webSearch 旁路服务 */

/**
 * open-webSearch（Apache-2.0）在本机跑 `open-websearch serve`，靠抓取 Bing / 百度结果页取结果，
 * 随时可能被验证码或限流挡住。每个子引擎单独熔断：连续失败（报错、空结果、验证码）达到阈值后
 * 跳过一段时间，不拖慢整次检索。百度结果是 baidu.com/link 跳转链接，必须解析成原网址才能当证据。
 */
const OPEN_WEBSEARCH_BREAK_AFTER = 3;
const OPEN_WEBSEARCH_BREAK_MS = 10 * 60 * 1000;
const openWebSearchFailures = new Map<string, number>();
const openWebSearchOpenUntil = new Map<string, number>();

export function resetOpenWebSearchBreakerForTests(): void {
  openWebSearchFailures.clear();
  openWebSearchOpenUntil.clear();
}

function openWebSearchEngineOpen(engine: string): boolean {
  const until = openWebSearchOpenUntil.get(engine);
  return typeof until === "number" && until > Date.now();
}

function noteOpenWebSearchResult(engine: string, ok: boolean): void {
  if (ok) {
    openWebSearchFailures.set(engine, 0);
    return;
  }
  const n = (openWebSearchFailures.get(engine) ?? 0) + 1;
  openWebSearchFailures.set(engine, n);
  if (n >= OPEN_WEBSEARCH_BREAK_AFTER) {
    openWebSearchOpenUntil.set(engine, Date.now() + OPEN_WEBSEARCH_BREAK_MS);
    openWebSearchFailures.set(engine, 0);
  }
}

const BAIDU_LINK = /^https?:\/\/(?:www\.)?baidu\.com\/link\?/i;
/** 解析后仍落在百度自身的搜索页、验证码页、视频聚合页：不是原始来源，丢弃。 */
const BAIDU_NON_SOURCE = /^https?:\/\/(?:(?:www|m|wappass)\.)?baidu\.com(?:\/|$)/i;
const CAPTCHA_HINT = /captcha|验证码|安全验证|unusual traffic|are you a robot|wappass\.baidu\.com/i;

/** baidu.com/link 跳转 → 原网址。http 版在境外常超时，统一改走 https；解析不出就返回 null（丢弃该条）。 */
async function resolveBaiduLink(url: string, signal?: AbortSignal): Promise<string | null> {
  const httpsUrl = url.replace(/^http:/i, "https:");
  try {
    const response = await fetchWithTimeout(httpsUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
    }, 6000, "百度跳转解析");
    const location = response.headers.get("location");
    if (location && /^https?:\/\//i.test(location) && !BAIDU_LINK.test(location)) {
      await response.body?.cancel();
      return location;
    }
    const body = (await response.text().catch(() => "")).slice(0, 4000);
    const m = body.match(/URL='([^']+)'/) || body.match(/location\.replace\("([^"]+)"\)/);
    return m && /^https?:\/\//i.test(m[1]!) ? m[1]! : null;
  } catch {
    return null;
  }
}

async function searchOpenWebSearchEngine(
  base: string,
  engine: string,
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Array<Record<string, unknown>>> {
  const response = await fetchWithTimeout(`${base}/search`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, engines: [engine], limit: 10 }),
  }, timeoutMs, `open-webSearch ${engine}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
  if (CAPTCHA_HINT.test(text.slice(0, 2000)) && !text.includes('"results":[{')) throw new Error("验证码拦截");
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("返回不是 JSON");
  }
  const results = Array.isArray(data?.data?.results) ? data.data.results : [];
  if (results.length === 0) throw new Error("空结果");
  const resolved = await Promise.all(
    results.map(async (r: any) => {
      const raw = String(r?.url || "");
      const url = BAIDU_LINK.test(raw) ? await resolveBaiduLink(raw, signal) : raw;
      if (!url || BAIDU_NON_SOURCE.test(url)) return null;
      return { title: r?.title, url, snippet: r?.description, siteName: r?.source, engine };
    }),
  );
  const kept = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
  if (kept.length === 0) throw new Error("跳转链接全部解析失败");
  return kept;
}

async function callOpenWebSearch({
  env,
  query,
  signal,
}: {
  env: Record<string, string>;
  query: string;
  signal?: AbortSignal;
}) {
  const base = getOpenWebSearchUrl(env);
  if (!base) throw new Error("未配置 OPEN_WEBSEARCH_URL");
  const engines = (envValue(env, "OPEN_WEBSEARCH_ENGINES") || "bing,baidu")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const live = engines.filter((e) => !openWebSearchEngineOpen(e));
  if (live.length === 0) throw new Error(`open-webSearch 引擎均在熔断中：${engines.join(",")}`);
  const timeoutMs = getSearchFetchTimeoutMs(env);
  const settled = await Promise.allSettled(
    live.map((engine) => searchOpenWebSearchEngine(base, engine, query, signal, timeoutMs)),
  );
  const items: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  settled.forEach((item, i) => {
    const engine = live[i]!;
    if (item.status === "fulfilled") {
      noteOpenWebSearchResult(engine, true);
      items.push(...item.value);
    } else {
      signal?.throwIfAborted();
      noteOpenWebSearchResult(engine, false);
      failures.push(`${engine}：${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
    }
  });
  if (items.length === 0) throw new Error(`open-webSearch 无结果（${failures.join("；")}）`);
  // 各子引擎轮流取，避免一个引擎占满 8 条上限。
  const byEngine = live.map((e) => items.filter((it) => it.engine === e));
  const interleaved: Array<Record<string, unknown>> = [];
  for (let i = 0; interleaved.length < items.length; i += 1) {
    for (const list of byEngine) if (list[i]) interleaved.push(list[i]!);
  }
  const sources = mapProviderSources(interleaved, (i) => `open-webSearch 来源 ${i}`);
  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n"),
    sources,
    unresolvedEvidenceGaps: failures.map((f) => `open-webSearch ${f}`),
    relatedQuestions: [],
    model: `open-websearch:${live.join("+")}`,
    traceText: `open-webSearch 返回 ${sources.length} 条可追溯来源${failures.length ? `；失败：${failures.join("；")}` : ""}。`,
    _source: "open-websearch",
  };
}
