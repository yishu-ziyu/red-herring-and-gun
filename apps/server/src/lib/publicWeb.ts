import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { withExecutionBudget } from "./executionBudget.js";
import { guardedLookup, isBlockedUrl } from "./ssrfGuard.js";

export type PageMode = "probe" | "head" | "article";

export type Page = {
  status: number;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  text: string;
};

export const ARTICLE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; RedHerringGun/1.0; source-check)";

const MODES: Record<PageMode, { timeoutMs: number; maxBytes: number; headers: Record<string, string> }> = {
  probe: { timeoutMs: 6_000, maxBytes: 0, headers: { "User-Agent": BOT_UA } },
  head: { timeoutMs: 5_000, maxBytes: 256 * 1024, headers: { "User-Agent": BOT_UA, Accept: "text/html" } },
  article: {
    timeoutMs: ARTICLE_TIMEOUT_MS,
    maxBytes: 2_000_000,
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6" },
  },
};

/** A page fetched once in a mode can answer the cheaper modes of the same run. */
const REUSABLE_FROM: Record<PageMode, PageMode[]> = {
  article: ["article"],
  head: ["article", "head"],
  probe: ["article", "head", "probe"],
};

export type PageCache = Map<string, Map<PageMode, Promise<Page>>>;

const runCaches = new WeakMap<AbortSignal, PageCache>();

/**
 * One cache per investigation run, keyed by the run's abort signal: the article read, citation
 * liveness and publish-date reads all receive that same signal, and the cache is collected with it.
 */
export function pageCacheFor(signal: AbortSignal | undefined): PageCache | undefined {
  if (!signal) return undefined;
  let cache = runCaches.get(signal);
  if (!cache) {
    cache = new Map();
    runCaches.set(signal, cache);
  }
  return cache;
}

export class UnreachablePageError extends Error {
  constructor(readonly reason: "blocked-url" | "too-many-redirects") {
    super(reason);
    this.name = "UnreachablePageError";
  }
}

export function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !isBlockedUrl(raw);
  } catch {
    return false;
  }
}

/** 规范化 URL：小写 host、去 hash、去常见追踪参数；非 http(s) 或非法则返回 null。 */
export function canonicalizeUrl(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "fbclid", "gclid"]) {
      u.searchParams.delete(k);
    }
    u.searchParams.sort();
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

function decodeBody(body: Buffer, contentType: string): string {
  const sniff = body.subarray(0, 4096).toString("latin1");
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
  try { return new TextDecoder(charset.toLowerCase()).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}

function request(url: string, signal: AbortSignal, maxBytes: number, headers: Record<string, string>): Promise<Page> {
  return new Promise((resolve, reject) => {
    let current = url;
    let hops = 0;
    const go = () => {
      if (!isPublicHttpUrl(current)) return reject(new UnreachablePageError("blocked-url"));
      const mod = current.startsWith("https:") ? https : http;
      const req = mod.get(current, { headers: { "Accept-Encoding": "gzip, deflate, br", ...headers }, lookup: guardedLookup as any, signal }, (res) => {
        const status = res.statusCode ?? 0;
        const finish = (body: Buffer) => resolve({ status, finalUrl: current, headers: res.headers, text: body.length ? decodeBody(body, String(res.headers["content-type"] || "")) : "" });
        res.once("error", reject);
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (++hops > MAX_REDIRECTS) return reject(new UnreachablePageError("too-many-redirects"));
          try { current = new URL(res.headers.location, current).href; } catch (error) { return reject(error); }
          return go();
        }
        if (maxBytes === 0) {
          res.destroy();
          return finish(Buffer.alloc(0));
        }
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let full = false;
        stream.on("data", (chunk: Buffer) => {
          if (full) return;
          size += chunk.length;
          if (size > maxBytes) {
            full = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            res.destroy();
            finish(Buffer.concat(chunks));
            return;
          }
          chunks.push(chunk);
        });
        stream.once("end", () => finish(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
      req.on("error", reject);
    };
    go();
  });
}

function derive(page: Page, from: PageMode, mode: PageMode, maxBytes: number): Page {
  if (mode === "probe") return { ...page, text: "" };
  if (mode === "head" && from === "article") return { ...page, text: page.text.slice(0, maxBytes) };
  return page;
}

/**
 * The only way the server reads a page on the public web. Every request, including each redirect
 * hop, passes the SSRF guard and connects only to addresses that resolve outside private ranges.
 * `probe` stops at the response headers, `head` reads a short prefix, `article` reads the page.
 * Throws UnreachablePageError for blocked addresses and redirect loops.
 */
export async function fetchPage(
  url: string,
  options: {
    mode: PageMode;
    signal?: AbortSignal;
    deadlineMs?: number;
    timeoutMs?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
    cache?: PageCache;
  },
): Promise<Page> {
  const { mode, cache } = options;
  const spec = MODES[mode];
  const maxBytes = options.maxBytes ?? spec.maxBytes;
  const key = cache ? canonicalizeUrl(url) ?? url : "";
  const entry = cache?.get(key);
  for (const from of REUSABLE_FROM[mode]) {
    const hit = entry?.get(from);
    if (!hit) continue;
    try { return derive(await hit, from, mode, maxBytes); } catch { options.signal?.throwIfAborted(); }
  }
  const pending = withExecutionBudget(
    (signal) => request(url, signal, maxBytes, { ...spec.headers, ...options.headers }),
    { signal: options.signal, deadlineMs: options.deadlineMs, timeoutMs: options.timeoutMs ?? spec.timeoutMs, label: "读取网页" },
  );
  if (cache) {
    const byMode = cache.get(key) ?? new Map<PageMode, Promise<Page>>();
    cache.set(key, byMode);
    byMode.set(mode, pending);
    pending.catch(() => { if (byMode.get(mode) === pending) byMode.delete(mode); });
  }
  return pending;
}
