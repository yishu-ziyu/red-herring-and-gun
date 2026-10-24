/**
 * 检索方没给发布日期的来源：读网页开头，取网页自己写的发布元数据。
 * 只读 <head> 附近的一小段，有总时限；读不到就是没有，不阻断出结果。
 */
import { dateFromHtml, normalizeInvestigationSourceUrl, normalizePublishedDate } from "../../../shared/investigation/index.js";
import { fetchPage, pageCacheFor } from "./publicWeb.js";

const MAX_URLS = 24;
const CONCURRENCY = 6;
const MIN_BUDGET_MS = 500;

type BundleLike = { byAtomKey?: Record<string, Array<{ url?: string; publishedAt?: string }>> } | undefined;

/** 返回 { 规范化 URL → YYYY-MM-DD }，只含读到日期的来源。 */
export async function readSourcePageDates(
  bundle: BundleLike,
  extraUrls: readonly string[],
  opts: { signal?: AbortSignal; deadlineMs?: number } = {}
): Promise<Record<string, string>> {
  const candidates = new Set<string>();
  for (const list of Object.values(bundle?.byAtomKey ?? {})) {
    for (const s of list ?? []) {
      const url = normalizeInvestigationSourceUrl(String(s?.url ?? ""));
      if (url && !normalizePublishedDate(s?.publishedAt)) candidates.add(url);
    }
  }
  for (const u of extraUrls) if (u) candidates.add(normalizeInvestigationSourceUrl(u));
  const urls = [...candidates].filter((u) => /^https?:\/\//i.test(u)).slice(0, MAX_URLS);
  const cache = pageCacheFor(opts.signal);
  const out: Record<string, string> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      if (opts.signal?.aborted) return;
      if (opts.deadlineMs !== undefined && opts.deadlineMs - Date.now() <= MIN_BUDGET_MS) return;
      const url = urls[cursor++];
      try {
        const page = await fetchPage(url, { mode: "head", signal: opts.signal, deadlineMs: opts.deadlineMs, cache });
        if (page.status < 200 || page.status >= 300 || !/html/i.test(String(page.headers["content-type"] ?? "html"))) continue;
        const day = dateFromHtml(page.text);
        if (day) out[url] = day;
      } catch {
        // 打不开、超时：这个来源就没有网页元数据日期。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return out;
}
