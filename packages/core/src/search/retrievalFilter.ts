/**
 * 检索筛选漏斗 v1（决策：2026-08-06-retrieval-quality-decision）
 * 硬过滤 → 跨源去重 → 可用度打分截断 top-K
 * 纯函数，无 I/O。
 */

import { semanticScore } from "./semanticRecall.js";

export const DEFAULT_TOP_K = 5;

/** 默认可扩展 denylist（主机后缀或完整 host，小写） */
export const DEFAULT_DENY_HOST_SUFFIXES: string[] = [
  "bit.ly",
  "t.cn",
  "tinyurl.com",
  "doubleclick.net",
  "googlesyndication.com",
];

export type FilterableSource = {
  url: string;
  title: string;
  snippet: string;
  credibility?: string;
  /** 源内原次序，0 最好；缺省视为靠后 */
  providerRank?: number;
  /** ISO 时间字符串；时间敏感查询加新度，无则不加不减 */
  publishedAt?: string;
};

export const PER_HOST_CAP = 2;

export type FilterMeta = {
  before: number;
  afterFilter: number;
  afterDedupe: number;
  /** 同站限流后（新增，不计入旧四数口径时可忽略） */
  afterHostCap?: number;
  afterTopK: number;
};

export type FilterAtomSourcesResult = {
  sources: FilterableSource[];
  meta: FilterMeta;
};

/**
 * 规范化 URL：小写 host、去 hash、去常见追踪参数。
 * 非法则返回 null。
 */
export function canonicalizeUrl(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    // 去常见追踪参数
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "fbclid", "gclid"];
    for (const k of drop) u.searchParams.delete(k);
    // 排序 query 使键稳定
    u.searchParams.sort();
    // 去掉默认端口
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    // trailing slash 统一：pathname 为 / 时保留，其它去尾 /
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

function registrableHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isDeniedHost(host: string, denylist: string[]): boolean {
  if (!host) return false;
  for (const d of denylist) {
    const needle = d.toLowerCase().replace(/^\./, "");
    if (host === needle || host.endsWith(`.${needle}`)) return true;
  }
  return false;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
}

/** S1 硬过滤 */
export function hardFilterSources(
  sources: FilterableSource[],
  denylist: string[] = DEFAULT_DENY_HOST_SUFFIXES
): FilterableSource[] {
  const out: FilterableSource[] = [];
  for (const s of sources) {
    if (!s || typeof s.url !== "string") continue;
    const canon = canonicalizeUrl(s.url);
    if (!canon) continue;
    const title = String(s.title || "").trim();
    const snippet = String(s.snippet || "").trim();
    if (!title && !snippet) continue;
    const host = registrableHost(canon);
    if (isDeniedHost(host, denylist)) continue;
    out.push({
      url: canon,
      title: title.slice(0, 200),
      snippet: snippet.slice(0, 500),
      credibility: s.credibility,
      providerRank: s.providerRank,
      ...(typeof s.publishedAt === "string" && s.publishedAt ? { publishedAt: s.publishedAt } : {}),
    });
  }
  return out;
}

function credibilityTier(c?: string): number {
  switch (c) {
    case "高":
      return 3;
    case "中":
      return 2;
    case "低":
      return 0;
    default:
      return 1; // 未知
  }
}

/** S2 跨源去重：同规范化 URL；否则 域名+标题。入口可重复 canonicalize，便于单测直调。 */
export function dedupeSources(sources: FilterableSource[]): FilterableSource[] {
  const byKey = new Map<string, FilterableSource>();
  for (const s of sources) {
    const canon = canonicalizeUrl(s.url) || s.url;
    const host = registrableHost(canon);
    const key = canon || `${host}|${normalizeTitle(s.title)}`;
    const candidate: FilterableSource = { ...s, url: canon };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, candidate);
      continue;
    }
    // 保留可信度更高，其次摘要更长
    const better =
      credibilityTier(candidate.credibility) > credibilityTier(prev.credibility) ||
      (credibilityTier(candidate.credibility) === credibilityTier(prev.credibility) &&
        (candidate.snippet?.length || 0) > (prev.snippet?.length || 0));
    if (better) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

/**
 * 可用度分 0–100：域名启发式 + 摘要/标题。
 * provider_rank_score：0 最好 → 映射高分。
 */
/** 合集页只认词形沉底，不写站点名单。 */
export function isCollectionPageSource(s: FilterableSource): boolean {
  return /(合集|汇总|盘点|大全|一览|榜单|\bTop\s*\d+)/.test(`${s.title || ""} ${s.snippet || ""}`);
}

/** 反证（辟谣/不实） vs 支撑（其余）：同站限流时两边各至少留一条。 */
export function sourceStance(s: FilterableSource): "refute" | "support" {
  return /(辟谣|不实|假消息|谣言|官方声明|从未发布|系编造)/.test(`${s.title || ""} ${s.snippet || ""}`)
    ? "refute"
    : "support";
}

/** 新度加成：30 天内 +8，一年内 +3，无效/缺失 0。 */
export function freshnessBoost(publishedAt?: string, now = Date.now()): number {
  if (!publishedAt) return 0;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / 86400000;
  if (days < 0 || days > 366) return 0;
  if (days <= 31) return 8;
  return 3;
}

export function scoreSource(s: FilterableSource, query = ""): number {
  let usability = 40;
  const tier = credibilityTier(s.credibility);
  usability += tier * 15; // 0/15/30/45
  const snipLen = (s.snippet || "").trim().length;
  if (snipLen === 0) usability -= 20;
  else if (snipLen < 40) usability -= 8;
  else if (snipLen >= 80) usability += 10;
  if (!(s.title || "").trim()) usability -= 15;
  else usability += 5;

  const text = `${s.title || ""} ${s.snippet || ""}`;
  const collection = isCollectionPageSource(s);
  // 合集页的辟谣词不计增益（转载不计增益），再沉底。
  if (!collection && /(辟谣|不实|假消息|谣言|官方声明|从未发布|系编造)/.test(text)) usability += 22;
  const hostBlob = `${s.url || ""} ${s.title || ""}`;
  if (/piyao\.org\.cn|news\.cn|xinhuanet|gmw\.cn|people\.com\.cn|\.gov\.cn/.test(hostBlob)) {
    usability += 12;
  }

  if (collection) usability -= 18;
  usability += freshnessBoost(s.publishedAt);
  if (query) {
    // 语义相关优先于关键词命中：确定性本地分，只做加成，不改旧口径 baseline。
    usability += semanticScore(query, `${s.title || ""} ${s.snippet || ""}`) * 30;
  }

  const rank = typeof s.providerRank === "number" ? s.providerRank : 7;
  const providerRankScore = Math.max(0, 100 - rank * 12);

  const score = 0.6 * providerRankScore + 0.4 * Math.max(0, Math.min(100, usability));
  return score;
}



/** S3 打分截断（可选传 query 开语义加成；不传则旧口径不变） */
export function topKSources(sources: FilterableSource[], k: number = DEFAULT_TOP_K, query = ""): FilterableSource[] {
  const sorted = [...sources].sort((a, b) => scoreSource(b, query) - scoreSource(a, query));
  return sorted.slice(0, Math.max(0, k));
}

/**
 * S2.5 同站限流：每站只留 cap 条（默认 2），支撑/反证各至少留一条。
 * 输入应已按分排好序；同站内优先保留高分，缺 stance 时用首个被挤掉的同 stance 换末位。
 */
export function limitPerHost(sources: FilterableSource[], cap: number = PER_HOST_CAP): FilterableSource[] {
  if (cap <= 0) return [];
  const kept: FilterableSource[] = [];
  const dropped: FilterableSource[] = [];
  const perHost = new Map<string, FilterableSource[]>();
  for (const s of sources) {
    const host = registrableHost(s.url);
    const list = perHost.get(host) ?? [];
    if (list.length < cap) {
      list.push(s);
      perHost.set(host, list);
      kept.push(s);
    } else {
      dropped.push(s);
    }
  }
  // stance 回补：某站 kept 全一边倒、而 dropped 有另一边时，换末位。
  for (const [, list] of perHost) {
    if (list.length < cap) continue;
    const stances = new Set(list.map(sourceStance));
    if (stances.size > 1) continue;
    const host = registrableHost(list[0].url);
    const need: "refute" | "support" = stances.has("refute") ? "support" : "refute";
    const swap = dropped.find((d) => registrableHost(d.url) === host && sourceStance(d) === need);
    if (!swap) continue;
    const idx = kept.lastIndexOf(list[list.length - 1]);
    if (idx >= 0) kept[idx] = swap;
  }
  return kept;
}

/** 过程可回看：每一跳的改写查询 + 粗排→精排数量 + 每页命中段。 */
export type HopTrace = {
  atom: string;
  issuedQueries: string[];
  before: number;
  afterFilter: number;
  afterDedupe: number;
  afterHostCap: number;
  afterTopK: number;
  chunks: Array<{ url: string; chunk: string }>;
};

export function buildHopTrace(input: {
  atom: string;
  issuedQueries: string[];
  meta: FilterMeta;
  sources: FilterableSource[];
  queryForChunk?: string;
}): HopTrace {
  const q = input.queryForChunk ?? input.atom;
  return {
    atom: input.atom,
    issuedQueries: [...input.issuedQueries],
    before: input.meta.before,
    afterFilter: input.meta.afterFilter,
    afterDedupe: input.meta.afterDedupe,
    afterHostCap: input.meta.afterHostCap ?? input.meta.afterDedupe,
    afterTopK: input.meta.afterTopK,
    chunks: input.sources.map((s) => ({
      url: s.url,
      chunk: pickAuditionChunkLocal(q, s.title, s.snippet),
    })),
  };
}

/** 命中段本地小实现（与 semanticRecall 同口径：首个实词命中窗口 120 字）。 */
function pickAuditionChunkLocal(query: string, title: string, snippet: string): string {
  const text = `${title || ""} ${snippet || ""}`.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const tokens = String(query || "")
    .replace(/[，。！？、；：""''（）【】《》「」『』…—\-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  let at = -1;
  for (const tok of tokens) {
    const i = text.indexOf(tok);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, 120);
  const start = Math.max(0, at - 20);
  return (start > 0 ? "…" : "") + text.slice(start, start + 120);
}

/**
 * 单原子（或一批已合并）来源：S1 → S2 → S2.5 同站限流 → S3
 */
export function filterAtomSources(
  sources: FilterableSource[],
  options?: { topK?: number; denylist?: string[]; query?: string; perHostCap?: number }
): FilterAtomSourcesResult {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const denylist = options?.denylist ?? DEFAULT_DENY_HOST_SUFFIXES;
  const query = options?.query ?? "";
  const perHostCap = options?.perHostCap ?? PER_HOST_CAP;
  const before = sources.length;
  const afterFilterList = hardFilterSources(sources, denylist);
  const afterFilter = afterFilterList.length;
  const afterDedupeList = dedupeSources(afterFilterList);
  const afterDedupe = afterDedupeList.length;
  const ranked = [...afterDedupeList].sort((a, b) => scoreSource(b, query) - scoreSource(a, query));
  const capped = limitPerHost(ranked, perHostCap);
  const afterHostCap = capped.length;
  const afterTopKList = topKSources(capped, topK, query);
  return {
    sources: afterTopKList,
    meta: {
      before,
      afterFilter,
      afterDedupe,
      afterHostCap,
      afterTopK: afterTopKList.length,
    },
  };
}
