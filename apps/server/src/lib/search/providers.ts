import { randomUUID } from "node:crypto";

import { getTimeoutMs, withExecutionBudget, type ExecutionBudget } from "../executionBudget.js";
import { isQuotaReply } from "../models/provider.js";

type Env = Record<string, string>;

export type SearchProviderId =
  | "360_search"
  | "any_search"
  | "metaso_search"
  | "tavily_search"
  | "exa_search"
  | "minimax_search"
  | "stepfun_search";

/** The one source shape every provider adapter produces. */
export type SearchSource = {
  title: string;
  url: string;
  snippet: string;
  credibility: string;
  publishedAt?: string;
  publisher?: string;
};

export type ProviderResult = {
  sources: SearchSource[];
  /** Only for providers that return their own synthesized answer. */
  answer?: string;
};

export interface SearchProvider {
  id: SearchProviderId;
  label: string;
  configured(env: Env): boolean;
  search(query: string, ctx: { env: Env; signal: AbortSignal }): Promise<ProviderResult>;
}

function setting(env: Env, key: string, fallback = ""): string {
  return env[key] || process.env[key] || fallback;
}

const SEARCH_QUOTA_SKIP_MS = 10 * 60 * 1000;
const searchQuotaExhaustedUntil = new Map<string, number>();

/** Some search APIs report an exhausted plan as HTTP 432. */
function isHardSearchQuotaError(message: string): boolean {
  return isQuotaReply(message) || /HTTP 432\b/i.test(message);
}

async function timedFetch(url: string | URL, init: RequestInit, env: Env, label: string) {
  const timeoutMs = getTimeoutMs(env, "SEARCH_FETCH_TIMEOUT_MS", 10000);
  init.signal?.throwIfAborted();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  } catch (error) {
    init.signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} 超时 ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(label: string, url: string | URL, init: RequestInit, env: Env, signal: AbortSignal) {
  const response = await timedFetch(url, { ...init, signal }, env, label);
  const data: any = await response.json().catch(() => null);
  return { response, data };
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

function mapProviderSources(items: any[], titleFallback: string): SearchSource[] {
  const out: SearchSource[] = [];
  for (let index = 0; index < items.length && out.length < 8; index += 1) {
    const source = items[index];
    if (!source || typeof source !== "object") continue;
    const url = String(source?.url || source?.link || source?.href || source?.web_url || source?.display_url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue; // 无有效 URL = 不可追溯，直接丢
    const publishedAt = String(source?.publishedAt || source?.date || source?.time || "").trim();
    // 发布者只取 provider 实际返回的字段；拿不到就是缺失，不用站点名或抓取信息补造。
    const publisher = String(source?.publisher || source?.siteName || source?.site_name || source?.site || "").trim();
    const row: SearchSource = {
      title: String(source?.title || source?.name || source?.site_name || `${titleFallback} ${out.length + 1}`).slice(0, 200),
      url,
      // 关系核验需要看到转折后的限制条件（「虽然……但……」），摘要给足 900 字。
      snippet: String(
        source?.summary_ai ||
          source?.summary ||
          source?.snippet ||
          source?.content ||
          source?.text ||
          source?.description ||
          source?.desc ||
          ""
      ).slice(0, 900),
      credibility: estimateSourceCredibility(url),
    };
    if (publishedAt) row.publishedAt = publishedAt;
    if (publisher) row.publisher = publisher;
    out.push(row);
  }
  return out;
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

function minimaxCodingPlanSearchUrl(env: Env): string {
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

function stepPlanMcpSearchUrl(env: Env): string {
  const raw = (env.STEPFUN_BASE_URL || "https://api.stepfun.com/step_plan").replace(/\/+$/, "");
  if (raw.includes("/step_plan")) {
    const base = raw.replace(/\/v1$/, "");
    return `${base}/v1/mcp/web_search/mcp`;
  }
  return "https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp";
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

const provider360: SearchProvider = {
  id: "360_search",
  label: "360 Search",
  configured: (env) => Boolean(setting(env, "QIHOO_360_API_KEY")),
  async search(query, { env, signal }) {
    const refProm = setting(env, "SEARCH360_REF_PROM", "aiso-max");
    const url = new URL("https://api.360.cn/v2/mwebsearch");
    url.searchParams.set("q", query);
    url.searchParams.set("ref_prom", refProm);
    url.searchParams.set("sid", randomUUID());
    url.searchParams.set("count", "8");
    url.searchParams.set("summary_len", "500");
    url.searchParams.set("freshness", "1");
    // 提供方侧轻度控噪：偏可信源、尽量排除 AIGC 页（非全量质量保证）
    url.searchParams.set("trusted_sources", "1");
    url.searchParams.set("exclude_aigc", "true");

    const label = `360 智搜 ${refProm}`;
    const { response, data } = await fetchJson(label, url, {
      method: "GET",
      headers: { Authorization: `Bearer ${setting(env, "QIHOO_360_API_KEY")}`, "Content-Type": "application/json" },
    }, env, signal);
    if (!response.ok) {
      throw new Error(`${label} 调用失败：${data?.error?.message || data?.message || response.statusText}`);
    }
    if (data?.errno != null && Number(data.errno) !== 0) {
      throw new Error(`${label} 调用失败：${data?.message || `errno ${data.errno}`}`);
    }
    const rawItems =
      data?.items ||
      data?.results ||
      data?.data?.items ||
      data?.data?.results ||
      data?.data?.list ||
      data?.result ||
      data?.data ||
      [];
    return { sources: mapProviderSources(Array.isArray(rawItems) ? rawItems : [], "360 智搜来源") };
  },
};

const providerAnySearch: SearchProvider = {
  id: "any_search",
  label: "AnySearch",
  // The endpoint also answers without a key.
  configured: () => true,
  async search(query, { env, signal }) {
    const apiKey = setting(env, "ANYSEARCH_API_KEY");
    const { response, data } = await fetchJson("AnySearch", "https://api.anysearch.com/mcp", {
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
            max_results: Number(setting(env, "ANYSEARCH_MAX_RESULTS", "6")),
            zone: setting(env, "ANYSEARCH_ZONE", "cn"),
          },
        },
      }),
    }, env, signal);
    if (!response.ok) {
      throw new Error(`AnySearch 调用失败：${data?.error?.message || data?.message || response.statusText}`);
    }
    if (data?.error) {
      throw new Error(`AnySearch 调用失败：${data.error?.message || JSON.stringify(data.error)}`);
    }
    const text = String(
      data?.result?.content?.find?.((item: any) => item?.type === "text")?.text ||
      data?.result?.content?.[0]?.text ||
      ""
    );
    return { sources: mapProviderSources(parseAnySearchMarkdownResults(text), "AnySearch 来源") };
  },
};

const providerMetaso: SearchProvider = {
  id: "metaso_search",
  label: "Metaso Search",
  configured: (env) => Boolean(setting(env, "METASO_API_KEY")),
  async search(query, { env, signal }) {
    const { response, data } = await fetchJson("Metaso Search", "https://metaso.cn/api/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setting(env, "METASO_API_KEY")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        scope: setting(env, "METASO_SEARCH_SCOPE", "webpage"),
        size: Number(setting(env, "METASO_SEARCH_SIZE", "10")),
        includeSummary: true,
        includeRawContent: false,
        conciseSnippet: true,
      }),
    }, env, signal);
    if (!response.ok) {
      throw new Error(`Metaso Search 调用失败：${data?.error?.message || data?.error || data?.message || response.statusText}`);
    }
    if (data?.errCode || data?.code) {
      throw new Error(`Metaso Search 调用失败：${data?.errMsg || data?.message || data?.error || `错误码 ${data.errCode || data.code}`}`);
    }
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
    return {
      sources: mapProviderSources(Array.isArray(rawItems) ? rawItems : [], "Metaso 来源"),
      answer: String(data?.answer || data?.summary || data?.data?.answer || data?.data?.summary || ""),
    };
  },
};

const providerTavily: SearchProvider = {
  id: "tavily_search",
  label: "Tavily Search",
  configured: (env) => Boolean(setting(env, "TAVILY_API_KEY")),
  async search(query, { env, signal }) {
    const { response, data } = await fetchJson("Tavily Search", "https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setting(env, "TAVILY_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: setting(env, "TAVILY_SEARCH_DEPTH", "basic"),
        max_results: Number(setting(env, "TAVILY_MAX_RESULTS", "6")),
        include_answer: true,
        include_raw_content: false,
        include_favicon: true,
        include_usage: true,
      }),
    }, env, signal);
    if (!response.ok) {
      throw new Error(`Tavily Search 调用失败：${data?.error || data?.message || response.statusText}`);
    }
    const items = (Array.isArray(data?.results) ? data.results : []).map((s: any) => ({
      ...s,
      snippet: s?.content || s?.raw_content || s?.snippet,
    }));
    return { sources: mapProviderSources(items, "Tavily 来源"), answer: String(data?.answer || "") };
  },
};

const providerExa: SearchProvider = {
  id: "exa_search",
  label: "Exa Search",
  configured: (env) => Boolean(setting(env, "EXA_API_KEY")),
  async search(query, { env, signal }) {
    const { response, data } = await fetchJson("Exa Search", "https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": setting(env, "EXA_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: setting(env, "EXA_SEARCH_TYPE", "auto"),
        numResults: Number(setting(env, "EXA_MAX_RESULTS", "6")),
        // highlights 作主摘要（省 token）；text 短截断作兜底
        contents: {
          highlights: true,
          text: { maxCharacters: 800 },
        },
      }),
    }, env, signal);
    if (!response.ok) {
      throw new Error(`Exa Search 调用失败：${data?.error?.message || data?.error || data?.message || response.statusText}`);
    }
    const items = (Array.isArray(data?.results) ? data.results : []).map((s: any) => ({
      ...s,
      snippet:
        (Array.isArray(s?.highlights) ? s.highlights.filter(Boolean).join(" ") : "") ||
        s?.summary ||
        s?.text ||
        "",
    }));
    return { sources: mapProviderSources(items, "Exa 来源"), answer: String(data?.context || "") };
  },
};

const providerMiniMax: SearchProvider = {
  id: "minimax_search",
  label: "MiniMax Token Plan",
  configured: (env) => Boolean(setting(env, "MINIMAX_API_KEY")),
  async search(query, { env, signal }) {
    const { response, data } = await fetchJson("MiniMax", minimaxCodingPlanSearchUrl(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setting(env, "MINIMAX_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
    }, env, signal);
    if (!response.ok) throw new Error(httpFailMessage("MiniMax", response, data));
    throwIfMiniMaxSearchFailed(data);
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    return { sources: mapProviderSources(organic, "MiniMax 来源") };
  },
};

const providerStepFun: SearchProvider = {
  id: "stepfun_search",
  label: "阶跃 Step Plan",
  configured: (env) => Boolean(setting(env, "STEPFUN_API_KEY")),
  async search(query, { env, signal }) {
    const response = await timedFetch(stepPlanMcpSearchUrl(env), {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${setting(env, "STEPFUN_API_KEY")}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: { query, n: Number(setting(env, "STEPFUN_SEARCH_SIZE", "8")) },
        },
      }),
    }, env, "阶跃 Step Plan");
    const data = parseJsonOrSse(await response.text().catch(() => ""));
    if (!response.ok) throw new Error(httpFailMessage("阶跃 Step Plan", response, data));
    return { sources: mapProviderSources(mcpSearchRows(data), "阶跃来源") };
  },
};

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  provider360,
  providerAnySearch,
  providerMetaso,
  providerTavily,
  providerExa,
  providerMiniMax,
  providerStepFun,
];

export function configuredProviders(env: Env): SearchProvider[] {
  return SEARCH_PROVIDERS.filter((provider) => provider.configured(env));
}

/** One provider call under the per-call budget; a hard quota failure parks the provider for 10 minutes. */
export async function callProvider(
  provider: SearchProvider,
  query: string,
  ctx: ExecutionBudget & { env: Env },
): Promise<ProviderResult> {
  ctx.signal?.throwIfAborted();
  const until = searchQuotaExhaustedUntil.get(provider.id);
  if (typeof until === "number" && until > Date.now()) {
    throw new Error(`${provider.label} 额度耗尽，本进程已跳过`);
  }
  try {
    return await withExecutionBudget((signal) => provider.search(query, { env: ctx.env, signal }), {
      signal: ctx.signal,
      deadlineMs: ctx.deadlineMs,
      timeoutMs: getTimeoutMs(ctx.env, "SEARCH_PROVIDER_TIMEOUT_MS", 25000),
      label: provider.label,
    });
  } catch (reason) {
    ctx.signal?.throwIfAborted();
    const message = reason instanceof Error ? reason.message : String(reason);
    if (isHardSearchQuotaError(message)) searchQuotaExhaustedUntil.set(provider.id, Date.now() + SEARCH_QUOTA_SKIP_MS);
    throw reason;
  }
}
