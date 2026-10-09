/**
 * 检索方没给发布日期的来源：读网页开头，取网页自己写的发布元数据（#140）。
 * 只读 <head> 附近的一小段，有总时限；读不到就是没有，不阻断出结果。
 * 每一跳都过 ssrfGuard，和引用探活同一口径。
 */
import { dateFromHtml, normalizeInvestigationSourceUrl, normalizePublishedDate } from "./investigation/index.js";
import { isBlockedUrl } from "./ssrfGuard.js";

const MAX_URLS = 24;
const CONCURRENCY = 6;
const PER_URL_TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; RedHerringGun/1.0; source-date)";

type BundleLike = { byAtomKey?: Record<string, Array<{ url?: string; publishedAt?: string }>> } | undefined;

async function readHead(url: string, signal: AbortSignal): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!/^https?:\/\//i.test(current) || isBlockedUrl(current)) return "";
    const res = await fetch(current, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept: "text/html" } });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      void res.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
      continue;
    }
    if (!res.ok || !res.body || !/html/i.test(res.headers.get("content-type") ?? "html")) {
      void res.body?.cancel().catch(() => {});
      return "";
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    void reader.cancel().catch(() => {});
    // 日期是 ASCII：GBK 页面按 UTF-8 解码也不影响读日期。
    return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  }
  return "";
}

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
  const out: Record<string, string> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      if (opts.signal?.aborted) return;
      const url = urls[cursor++];
      const left = opts.deadlineMs !== undefined ? opts.deadlineMs - Date.now() : PER_URL_TIMEOUT_MS;
      if (left <= 500) return;
      const timeout = AbortSignal.timeout(Math.min(PER_URL_TIMEOUT_MS, left));
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      try {
        const day = dateFromHtml(await readHead(url, signal));
        if (day) out[url] = day;
      } catch {
        // 打不开、超时：这个来源就没有网页元数据日期。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return out;
}
