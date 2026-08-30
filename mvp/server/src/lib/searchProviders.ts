/**
 * searchProviders.ts — 并行搜索矩阵（360 智搜 / AnySearch / Metaso / Tavily / Exa）
 * 与 per-atom 检索入口 retrieveAtomSources。失败不阻断整次核查。
 */

import { randomUUID } from "node:crypto";

import { buildQueriesWithReuse } from "./queryReuse.js";

import { mergeParallelSearchPayloads } from "./atomSearchQuery.js";

import type { MemoryCandidateHit } from "./memoryCandidateTypes.js";

import { stringItems } from "./valueCoerce.js";

import { fetchWithTimeout, getTimeoutMs, withTimeout } from "./httpUtils.js";

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

export async function callParallelSearchProviders({
  env,
  query,
  model,
  refProm,
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
}) {
  const providers: SearchProviderId[] = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      provider,
      result: await callSearchProviderWithTimeout({ env, provider, query, model, refProm }),
    }))
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

  const sources = successes.flatMap(({ result }) => result.sources ?? []);
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

/** Production per-atom search: recipe + accepted reuse query, then merge URLs. */
export async function retrieveAtomSources(
  env: Record<string, string>,
  atom: string,
  reuseHits?: MemoryCandidateHit[]
) {
  const queries = buildQueriesWithReuse(atom, reuseHits ?? []);
  const settled = await Promise.allSettled(
    queries.map((query) => callParallelSearchProviders({ env, query }))
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
  if (ok.length === 0) {
    return build360SearchFailure(atom, failures.join("；") || "检索未返回真实结果");
  }
  const merged = mergeParallelSearchPayloads(atom, ok);
  if (failures.length > 0) {
    const gaps = Array.isArray(merged.unresolvedEvidenceGaps)
      ? merged.unresolvedEvidenceGaps.filter((g): g is string => typeof g === "string")
      : [];
    merged.unresolvedEvidenceGaps = [...gaps, ...failures].slice(0, 8);
  }
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
