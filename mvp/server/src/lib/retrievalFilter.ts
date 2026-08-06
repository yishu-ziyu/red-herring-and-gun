/**
 * 检索筛选漏斗 v1（决策：2026-08-06-retrieval-quality-decision）
 * 硬过滤 → 跨源去重 → 可用度打分截断 top-K
 * 纯函数，无 I/O。
 */

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
};

export type FilterMeta = {
  before: number;
  afterFilter: number;
  afterDedupe: number;
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
export function scoreSource(s: FilterableSource): number {
  let usability = 40;
  const tier = credibilityTier(s.credibility);
  usability += tier * 15; // 0/15/30/45
  const snipLen = (s.snippet || "").trim().length;
  if (snipLen === 0) usability -= 20;
  else if (snipLen < 40) usability -= 8;
  else if (snipLen >= 80) usability += 10;
  if (!(s.title || "").trim()) usability -= 15;
  else usability += 5;

  const rank = typeof s.providerRank === "number" ? s.providerRank : 7;
  const providerRankScore = Math.max(0, 100 - rank * 12);

  const score = 0.6 * providerRankScore + 0.4 * Math.max(0, Math.min(100, usability));
  return score;
}

/** S3 打分截断 */
export function topKSources(sources: FilterableSource[], k: number = DEFAULT_TOP_K): FilterableSource[] {
  const sorted = [...sources].sort((a, b) => scoreSource(b) - scoreSource(a));
  return sorted.slice(0, Math.max(0, k));
}

/**
 * 单原子（或一批已合并）来源：S1 → S2 → S3
 */
export function filterAtomSources(
  sources: FilterableSource[],
  options?: { topK?: number; denylist?: string[] }
): FilterAtomSourcesResult {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const denylist = options?.denylist ?? DEFAULT_DENY_HOST_SUFFIXES;
  const before = sources.length;
  const afterFilterList = hardFilterSources(sources, denylist);
  const afterFilter = afterFilterList.length;
  const afterDedupeList = dedupeSources(afterFilterList);
  const afterDedupe = afterDedupeList.length;
  const afterTopKList = topKSources(afterDedupeList, topK);
  return {
    sources: afterTopKList,
    meta: {
      before,
      afterFilter,
      afterDedupe,
      afterTopK: afterTopKList.length,
    },
  };
}
