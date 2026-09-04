/**
 * searchProviders.ts — 并行搜索矩阵（360 智搜 / AnySearch / Metaso / Tavily / Exa）
 * 与 per-atom 检索入口 retrieveAtomSources。失败不阻断整次核查。
 */

import { randomUUID } from "node:crypto";

import { buildQueriesWithReuse } from "./queryReuse.js";

import { mergeParallelSearchPayloads } from "./atomSearchQuery.js";

import { canonicalizeUrl } from "./retrievalFilter.js";

import type { MemoryCandidateHit } from "../text/memoryCandidateTypes.js";

import { stringItems } from "../util/valueCoerce.js";

import { fetchWithTimeout, getTimeoutMs, withTimeout } from "../util/httpUtils.js";

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

function getSearchFetchTimeoutMs(env: Record<string, string>) {
  return getTimeoutMs(env, "SEARCH_FETCH_TIMEOUT_MS", 10000);
}

const SEARCH_QUOTA_SKIP_MS = 10 * 60 * 1000;
const searchQuotaExhaustedUntil = new Map<string, number>();

export function resetSearchQuotaSkipForTests(): void {
  searchQuotaExhaustedUntil.clear();
}

export function isHardSearchQuotaError(message: string): boolean {
  return /quota exceeded|insufficient balance|余额不足|额度不足|insufficient.?quota|exceeded your (?:current )?quota|credit(?:s)? (?:exhausted|exceeded|limit)|billing hard limit|over_quota|无可用额度|please top up|usage limit|exceeds your plan|HTTP 402\b|HTTP 432\b/i.test(
    message
  );
}

export function isSearchQuotaSkipped(provider: string): boolean {
  const until = searchQuotaExhaustedUntil.get(provider);
  return typeof until === "number" && until > Date.now();
}

function noteSearchFailure(provider: string, message: string): void {
  if (isHardSearchQuotaError(message)) {
    searchQuotaExhaustedUntil.set(provider, Date.now() + SEARCH_QUOTA_SKIP_MS);
  }
}

function httpFailMessage(name: string, response: Response, data: unknown): string {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const error = rec.error;
  const detailField = rec.detail;
  const errorMessage =
    error && typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : typeof error === "string"
        ? error
        : "";
  const detailMessage =
    detailField && typeof detailField === "object" && detailField !== null && "error" in detailField
      ? String((detailField as { error: unknown }).error ?? "")
      : typeof detailField === "string"
        ? detailField
        : "";
  const detail =
    errorMessage ||
    detailMessage ||
    (typeof rec.message === "string" ? rec.message : "") ||
    response.statusText ||
    "";
  return `${name} 调用失败：HTTP ${response.status}${detail ? ` ${detail}` : ""}`;
}

export function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "Parallel Search";
  if (result?._source === "anysearch-search") return "AnySearch";
  if (result?._source === "metaso-search") return "Metaso Search";
  if (result?._source === "tavily-search") return "Tavily Search";
  if (result?._source === "exa-search") return "Exa Search";
  if (result?._source === "360-mwebsearch") return "360 智搜";
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

export function buildReportEvidenceInputs(steps: any[], searchResult?: any) {
  const factStep = steps.find((step) => step.agent === "fact_checker");
  const sourceStep = steps.find((step) => step.agent === "source_validator");
  const sources = Array.isArray(searchResult?.sources)
    ? searchResult.sources.slice(0, 8).map((source: any, index: number) => ({
        ref: source?.id || `S${index + 1}`,
        title: source?.title || source?.name || `来源 ${index + 1}`,
        url: source?.url || source?.link || "",
        domain: source?.domain || source?.site || "",
        snippet: source?.snippet || source?.summary || source?.content || "",
        role: source?.evidenceRole || source?.role || "线索",
        credibility: source?.credibility || source?.credibilityScore || "",
      }))
    : [];

  return {
    searchSummary: {
      tool: getSearchToolName(searchResult),
      answer: typeof searchResult?.answer === "string" ? searchResult.answer.slice(0, 900) : "",
      sources,
      supportingEvidence: stringItems(searchResult?.supportingEvidence).slice(0, 5),
      contradictingEvidence: stringItems(searchResult?.contradictingEvidence).slice(0, 5),
      unresolvedEvidenceGaps: stringItems(searchResult?.unresolvedEvidenceGaps).slice(0, 5),
      relatedQuestions: stringItems(searchResult?.relatedQuestions).slice(0, 4),
    },
    factFindings: {
      result: factStep?.output?.factCheckResult ?? "unverified",
      confidence: factStep?.output?.confidence ?? "low",
      sources: stringItems(factStep?.output?.sources).slice(0, 6),
      keyFindings: stringItems(factStep?.output?.keyFindings).slice(0, 5),
      counterEvidence: stringItems(factStep?.output?.counterEvidence).slice(0, 5),
    },
    sourceAudit: {
      reliability: sourceStep?.output?.sourceReliability ?? "unverified",
      verifiedSources: stringItems(sourceStep?.output?.verifiedSources).slice(0, 5),
      questionableSources: stringItems(sourceStep?.output?.questionableSources).slice(0, 5),
      missingSources: stringItems(sourceStep?.output?.missingSources).slice(0, 5),
      notes: typeof sourceStep?.output?.verificationNotes === "string" ? sourceStep.output.verificationNotes.slice(0, 500) : "",
    },
  };
}

export function compactSearchResultForAgent(searchResult: any) {
  const sources = Array.isArray(searchResult?.sources)
    ? searchResult.sources.slice(0, 8).map((source: any, index: number) => ({
        id: String(source?.id || `S${index + 1}`),
        title: String(source?.title || source?.name || `来源 ${index + 1}`).slice(0, 120),
        url: String(source?.url || source?.link || ""),
        domain: String(source?.domain || source?.site || ""),
        snippet: String(source?.snippet || source?.summary || source?.content || "").slice(0, 450),
        credibility: source?.credibility || source?.credibilityScore || "",
        role: source?.evidenceRole || source?.role || "线索",
      }))
    : [];

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
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
}) {
  const apiKey = getSearch360ApiKey(env);
  if (!apiKey) throw new Error("未配置 360 API key");
  return await call360MWebSearch({ env, apiKey, query, refProm });
}

export type SearchProviderId = "360_search" | "any_search" | "metaso_search" | "tavily_search" | "exa_search";

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

const SEARCH_PROVIDERS: SearchProviderId[] = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];

export async function callSearchProvider({
  env,
  provider,
  query,
  model,
  refProm,
}: {
  env: Record<string, string>;
  provider: string;
  query: string;
  model?: string;
  refProm?: string;
}) {
  if (isSearchQuotaSkipped(provider)) {
    throw new Error(`${getProviderLabel(provider)} 额度耗尽，本进程已跳过`);
  }
  try {
    switch (provider) {
      case "360_search":
        return await call360AiSearch({ env, query, model, refProm });
      case "any_search":
        return await callAnySearchSearch({ env, query });
      case "metaso_search":
        return await callMetasoSearch({ env, query });
      case "tavily_search":
        return await callTavilySearch({ env, query });
      case "exa_search":
        return await callExaSearch({ env, query });
      default:
        throw new Error(`未知搜索 Provider：${provider}`);
    }
  } catch (reason) {
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
}: {
  env: Record<string, string>;
  provider: SearchProviderId;
  query: string;
  model?: string;
  refProm?: string;
}) {
  return await withTimeout(
    callSearchProvider({ env, provider, query, model, refProm }),
    getTimeoutMs(env, "SEARCH_PROVIDER_TIMEOUT_MS", 25000),
    getProviderLabel(provider)
  );
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
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
  /** 每个 Provider 的 start/success/failure 实时上报（SSE search_progress 数据源）。 */
  onProviderEvent?: (event: ProviderCallEvent) => void;
}) {
  const providers: SearchProviderId[] = SEARCH_PROVIDERS;
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      onProviderEvent?.({ provider, status: "running", resultCount: 0 });
      try {
        const result = await callSearchProviderWithTimeout({ env, provider, query, model, refProm });
        const resultCount = Array.isArray(result?.sources) ? result.sources.length : 0;
        onProviderEvent?.({ provider, status: "completed", resultCount });
        return { provider, result };
      } catch (error) {
        onProviderEvent?.({ provider, status: "failed", resultCount: 0 });
        throw error;
      }
    })
  );

  const successes: Array<{ provider: SearchProviderId; result: any }> = [];
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

/** Production per-atom search: recipe + accepted reuse query, then merge URLs. */
export async function retrieveAtomSources(
  env: Record<string, string>,
  atom: string,
  reuseHits?: MemoryCandidateHit[],
  onProgress?: (event: SearchProgressEvent) => void
) {
  const queries = buildQueriesWithReuse(atom, reuseHits ?? []);
  const queryCount = queries.length;

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
    if (!onProgress) return;
    onProgress({
      type: "search_progress",
      atom,
      phase,
      queryCount,
      providers: SEARCH_PROVIDERS.map((provider) => ({
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
    queries.map((query) => callParallelSearchProviders({ env, query, onProviderEvent }))
  );
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
  const rawResultCount = SEARCH_PROVIDERS.reduce((n, p) => n + (resultTotals.get(p) ?? 0), 0);

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
  };
  return labels[provider] ?? provider;
}

async function callAnySearchSearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getAnySearchApiKey(env);
  const response = await fetchWithTimeout("https://api.anysearch.com/mcp", {
    method: "POST",
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

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpFailMessage("AnySearch", response, data));
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
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getTavilyApiKey(env);
  if (!apiKey) throw new Error("未配置 Tavily API key");

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
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

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpFailMessage("Tavily Search", response, data));
  }

  return normalizeTavilySearchResponse(data, query);
}

async function callMetasoSearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getMetasoApiKey(env);
  if (!apiKey) throw new Error("未配置 Metaso API key");

  const scope = env.METASO_SEARCH_SCOPE || process.env.METASO_SEARCH_SCOPE || "webpage";
  const response = await fetchWithTimeout("https://metaso.cn/api/v1/search", {
    method: "POST",
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

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpFailMessage("Metaso Search", response, data));
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
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getExaApiKey(env);
  if (!apiKey) throw new Error("未配置 Exa API key");

  const type = env.EXA_SEARCH_TYPE || process.env.EXA_SEARCH_TYPE || "auto";
  const response = await fetchWithTimeout("https://api.exa.ai/search", {
    method: "POST",
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

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpFailMessage("Exa Search", response, data));
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
}: {
  env: Record<string, string>;
  apiKey: string;
  query: string;
  refProm?: string;
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
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }, getSearchFetchTimeoutMs(env), `360 智搜 ${selectedRefProm}`);
  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpFailMessage(`360 智搜 ${selectedRefProm}`, response, data));
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
): Array<{ title: string; url: string; snippet: string; credibility: string }> {
  const out: Array<{ title: string; url: string; snippet: string; credibility: string }> = [];
  for (let index = 0; index < items.length && out.length < 8; index += 1) {
    const source = items[index];
    if (!source || typeof source !== "object") continue;
    const url = String(source?.url || source?.link || source?.href || source?.web_url || source?.display_url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue; // 无有效 URL = 不可追溯，直接丢
    out.push({
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
    });
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
