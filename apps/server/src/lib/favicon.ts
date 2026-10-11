/**
 * favicon.ts — GET /api/favicon?host=…：服务端代取来源网站自己的图标，校验后缓存。
 *
 * 为什么由服务端代取：浏览器只连我们自己的服务器，不连 Google 等第三方图标服务（那会把用户在看哪些来源泄露出去），
 * 也不直接连来源网站。服务端因此成了替人访问外网的代理，每一跳都要过 SSRF 检查：
 * 主机名规则 → 自己做 DNS 解析并逐个检查 IP → 连接时钉死到检查过的 IP（防 DNS rebinding 在检查和连接之间换地址）。
 * 只收魔数确认过的位图格式；SVG 能带脚本，一律不收。上游的正文和错误细节从不回传给浏览器。
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import type { Request, Response } from "express";
import { isBlockedIp } from "./ssrfGuard.js";
import { clientIpKey } from "./checkQuota.js";

// 名字里不能带 bot：实测 www.kepuchina.cn 的防火墙对含 bot 的 UA 一律回 502
const USER_AGENT = "RedHerringAndGun-Favicon/1.0";
const PER_REQUEST_TIMEOUT_MS = 3_000;
const HOST_BUDGET_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 100 * 1024;
// 首页里声明的图标最多试这么多个，再退到 /favicon.ico；多试只会吃掉 5 秒预算
const MAX_DECLARED_CANDIDATES = 2;
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60_000;
const NEGATIVE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
// 每条缓存除图片字节外的估算开销，让「未取到」的条目也计入总量
const CACHE_ENTRY_OVERHEAD = 256;
const MAX_CONCURRENT_FETCHES = 4;
// 排队太长说明有人在刷，直接回 503 而不是无限堆积请求
const MAX_QUEUED_FETCHES = 200;
// 只限制会触发外网抓取的请求（缓存命中不计）。一页结果几十个来源，留足余量
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX_UPSTREAM_PER_IP = 200;
const RATE_MAX_TRACKED_IPS = 10_000;

const SUCCESS_CACHE_CONTROL = "public, max-age=604800, immutable";
const MISS_CACHE_CONTROL = "public, max-age=86400";

class FaviconMiss extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** 日志只记短原因：错误码或自定义原因，绝不带完整网址。 */
function reasonOf(error: unknown): string {
  if (error instanceof FaviconMiss) return error.reason;
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "error";
}

// ── 主机名校验 ────────────────────────────────────────────────

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// 顶级域只收字母或 punycode：这样 127.0.0.1、127.1、1.0x7f 这类会被 URL 解析器当成 IPv4 的写法全部挡在外面
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
// arpa 同时覆盖 home.arpa 和反向解析域
const BLOCKED_SUFFIXES = ["localhost", "local", "localdomain", "internal", "lan", "arpa"];
const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata.tencentyun.com"]);

/**
 * 只接受纯主机名（LDH 标签、至少一个点）。冒号、方括号、@ 都不在允许字符里，
 * 所以端口、userinfo、IPv6 字面量天然被拒；IPv4 各种写法靠顶级域规则拒。
 */
export function normalizeFaviconHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase();
  if (!host || host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!TLD.test(labels[labels.length - 1]!)) return null;
  if (BLOCKED_HOSTS.has(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;
  return host;
}

// ── 带 SSRF 防护的单次请求 ───────────────────────────────────

type Pinned = { address: string; family: number };

async function resolveVetted(host: string, deadline: number): Promise<Pinned> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FaviconMiss("dns-timeout")), Math.max(1, deadline - Date.now()));
  });
  let addresses: dns.LookupAddress[];
  try {
    addresses = await Promise.race([dns.promises.lookup(host, { all: true }), timeout]);
  } catch (error) {
    throw error instanceof FaviconMiss ? error : new FaviconMiss("dns-error");
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0) throw new FaviconMiss("dns-empty");
  // 任何一个地址不合格就整体拒绝：只挑合格的那个连，等于允许攻击者用多条记录混进内网地址试探
  if (addresses.some((entry) => isBlockedIp(entry.address))) throw new FaviconMiss("dns-blocked");
  // 优先 IPv4：不少服务器没有可用的 IPv6 出口，先连 IPv6 只会白白超时
  return addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
}

/**
 * 让 http/https 连接直接用检查过的地址，而不是再查一次 DNS。
 * 主机名照常传给 request，所以 SNI、证书校验和 Host 头仍然按主机名走。
 * Node 开启 autoSelectFamily 时会以 all: true 调用 lookup，两种回调形式都要支持。
 */
function pinnedLookup(pinned: Pinned): net.LookupFunction {
  return ((_hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  }) as net.LookupFunction;
}

type FetchOptions = {
  accept: string;
  maxBytes: number;
  /** true：超过上限就截断并用已读到的部分（读首页只需要 <head>）；false：超过上限即失败（图标）。 */
  truncate: boolean;
  /** 不满足就不读正文直接失败。图标不看上游 Content-Type，只看魔数。 */
  acceptContentType?: (contentType: string) => boolean;
  /** 读到这个标记就提前结束。首页的图标声明在 <head> 里，慢站点读完整页常常超时。 */
  stopMarker?: RegExp;
};

type Upstream = { status: number; location?: string; body: Buffer };

const EMPTY = Buffer.alloc(0);

async function fetchOnce(url: URL, options: FetchOptions, deadline: number): Promise<Upstream> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FaviconMiss("bad-scheme");
  if (url.port && url.port !== "80" && url.port !== "443") throw new FaviconMiss("bad-port");
  if (url.username || url.password) throw new FaviconMiss("userinfo");
  const host = normalizeFaviconHost(url.hostname);
  if (!host) throw new FaviconMiss("bad-host");
  const budget = Math.min(PER_REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (budget <= 0) throw new FaviconMiss("budget");
  const requestDeadline = Date.now() + budget;
  const pinned = await resolveVetted(host, requestDeadline);
  const client = url.protocol === "https:" ? https : http;

  return new Promise<Upstream>((resolve, reject) => {
    let settled = false;
    const settle = (error: unknown, value?: Upstream) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const req = client.request({
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // 不带 Cookie、Referer；明确要求不压缩，服务器仍然压缩时下面再解
      headers: { "User-Agent": USER_AGENT, Accept: options.accept, "Accept-Encoding": "identity" },
      lookup: pinnedLookup(pinned),
      // 不复用连接：连接池按主机名复用，可能绕过本次钉死的地址
      agent: false,
    });
    const timer = setTimeout(() => settle(new FaviconMiss("timeout")), Math.max(1, requestDeadline - Date.now()));
    req.on("error", (error) => settle(error));
    req.on("response", (res) => {
      res.on("error", (error) => settle(error));
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        settle(null, { status, location: res.headers.location, body: EMPTY });
        return;
      }
      if (status !== 200) {
        settle(null, { status, body: EMPTY });
        return;
      }
      const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
      if (options.acceptContentType && !options.acceptContentType(contentType)) {
        settle(new FaviconMiss("content-type"));
        return;
      }
      const declaredLength = Number(res.headers["content-length"]);
      if (!options.truncate && Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        settle(new FaviconMiss("too-large"));
        return;
      }
      const encoding = String(res.headers["content-encoding"] ?? "identity").trim().toLowerCase();
      let stream: Readable = res;
      if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding !== "identity" && encoding !== "") {
        settle(new FaviconMiss("encoding"));
        return;
      }
      // 上限按解压后的字节数算，压缩炸弹也被截住
      const chunks: Buffer[] = [];
      let total = 0;
      const finish = () => settle(null, { status, body: Buffer.concat(chunks, total) });
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        if (total + chunk.length > options.maxBytes) {
          if (!options.truncate) {
            settle(new FaviconMiss("too-large"));
            return;
          }
          chunks.push(chunk.subarray(0, options.maxBytes - total));
          total = options.maxBytes;
          finish();
          return;
        }
        chunks.push(chunk);
        total += chunk.length;
        if (options.stopMarker) {
          // 带上前一块的尾巴，标记跨块也能认出来
          const previous = chunks.length > 1 ? chunks[chunks.length - 2]!.toString("latin1").slice(-16) : "";
          if (options.stopMarker.test(previous + chunk.toString("latin1"))) finish();
        }
      });
      stream.on("end", finish);
      if (stream !== res) stream.on("error", () => settle(new FaviconMiss("decode")));
    });
    req.end();
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 跟随重定向；每一跳都重新走 fetchOnce 里的主机名、端口和 DNS 检查。返回最终网址，用于解析相对链接。 */
async function fetchFollowing(start: URL, options: FetchOptions, deadline: number): Promise<{ url: URL; body: Buffer }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    const res = await fetchOnce(url, options, deadline);
    if (REDIRECT_STATUSES.has(res.status)) {
      if (!res.location || hop >= MAX_REDIRECTS) throw new FaviconMiss("redirects");
      try {
        url = new URL(res.location, url);
      } catch {
        throw new FaviconMiss("bad-redirect");
      }
      continue;
    }
    if (res.status !== 200) throw new FaviconMiss(`http-${res.status}`);
    return { url, body: res.body };
  }
}

// ── 从首页 HTML 找图标 ───────────────────────────────────────

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 0xfffd);
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 0xfffd);
    return named[lower] ?? match;
  });
}

/** 解析一个标签的属性；同名属性按 HTML 规则取第一个。 */
function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<[a-z]+/i, "");
  for (const match of body.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

/**
 * 给声明的图标打分：位图格式里 PNG/ICO 最好；声明了 16–64 像素的优先，越接近 32 越好。
 * 没写 sizes 的 apple-touch-icon 按惯例是 180 像素，体积大、可能超过 100 KB，排在后面。
 */
function scoreCandidate(url: URL, type: string, sizes: string, isTouchIcon: boolean): number {
  let score = 0;
  const format = type || (/\.(png|ico|gif|jpe?g|webp)$/.exec(url.pathname.toLowerCase())?.[1] ?? "");
  if (/png|ico|icon/.test(format)) score += 20;
  else if (/gif|jpe?g|webp/.test(format)) score += 10;
  const dims = sizes
    .toLowerCase()
    .split(/\s+/)
    .map((size) => /^(\d+)x(\d+)$/.exec(size))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  if (dims.length > 0) {
    const fitting = dims.filter((d) => d >= 16 && d <= 64);
    if (fitting.length > 0) score += 30 - Math.min(...fitting.map((d) => Math.abs(d - 32))) / 4;
    else if (dims.some((d) => d > 64)) score += 5;
  } else {
    score += isTouchIcon ? 5 : 15;
  }
  return score;
}

function declaredIcons(html: string, pageUrl: URL): URL[] {
  let base = pageUrl;
  const baseTag = /<base\b[^>]*>/i.exec(html);
  const baseHref = baseTag ? tagAttributes(baseTag[0]).get("href")?.trim() : undefined;
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl);
    } catch {
      // 坏的 <base> 当作没有
    }
  }
  const scored: Array<{ url: URL; score: number }> = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const isTouchIcon = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!rel.includes("icon") && !isTouchIcon) continue;
    const href = attributes.get("href")?.trim();
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const type = (attributes.get("type") ?? "").toLowerCase();
    if (type.includes("svg") || url.pathname.toLowerCase().endsWith(".svg")) continue;
    scored.push({ url, score: scoreCandidate(url, type, attributes.get("sizes") ?? "", isTouchIcon) });
  }
  // sort 是稳定的：同分时保留页面里的先后顺序
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.url);
}

// ── 图片格式 ─────────────────────────────────────────────────

/** 只按魔数认格式；上游声称的 Content-Type 不可信，不参与判断。 */
function sniffImageType(body: Buffer): string | null {
  if (body.length < 12) return null;
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  // ICO：保留字 0、类型 1（2 是光标）、图像数至少 1
  if (body.readUInt16LE(0) === 0 && body.readUInt16LE(2) === 1 && body.readUInt16LE(4) > 0) return "image/x-icon";
  const ascii6 = body.toString("latin1", 0, 6);
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// ── 抓取一个主机的图标 ───────────────────────────────────────

type CacheEntry = { body: Buffer; contentType: string; expiresAt: number } | { body: null; expiresAt: number };

const HTML_OPTIONS: FetchOptions = {
  accept: "text/html,application/xhtml+xml;q=0.9",
  maxBytes: MAX_HTML_BYTES,
  truncate: true,
  acceptContentType: (contentType) => contentType.includes("text/html") || contentType.includes("application/xhtml+xml"),
  stopMarker: /<\/head\s*>/i,
};

const ICON_OPTIONS: FetchOptions = {
  accept: "image/png,image/x-icon,image/vnd.microsoft.icon,image/gif,image/jpeg,image/webp;q=0.9",
  maxBytes: MAX_ICON_BYTES,
  truncate: false,
};

/** 从不抛错：失败一律变成「未取到」条目，由调用方缓存。 */
async function fetchFavicon(host: string): Promise<CacheEntry> {
  const deadline = Date.now() + HOST_BUDGET_MS;
  const candidates: URL[] = [];
  let lastReason = "no-icon";
  try {
    const page = await fetchFollowing(new URL(`https://${host}/`), HTML_OPTIONS, deadline);
    // latin1 逐字节保留：页面可能是 GBK 等编码，而 <link> 标签本身都是 ASCII
    candidates.push(...declaredIcons(page.body.toString("latin1"), page.url).slice(0, MAX_DECLARED_CANDIDATES));
  } catch (error) {
    lastReason = `page:${reasonOf(error)}`;
  }
  candidates.push(new URL(`https://${host}/favicon.ico`), new URL(`http://${host}/favicon.ico`));

  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate.href)) continue;
    tried.add(candidate.href);
    if (Date.now() >= deadline) {
      lastReason = "budget";
      break;
    }
    try {
      const { body } = await fetchFollowing(candidate, ICON_OPTIONS, deadline);
      const contentType = sniffImageType(body);
      if (contentType) return { body, contentType, expiresAt: Date.now() + POSITIVE_TTL_MS };
      lastReason = "not-image";
    } catch (error) {
      lastReason = reasonOf(error);
    }
  }
  console.warn(`[favicon] ${host} miss: ${lastReason}`);
  return { body: null, expiresAt: Date.now() + NEGATIVE_TTL_MS };
}

// ── LRU 缓存（条目数和总字节双上限） ─────────────────────────

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

const entrySize = (entry: CacheEntry) => (entry.body?.length ?? 0) + CACHE_ENTRY_OVERHEAD;

function cacheDelete(host: string) {
  const entry = cache.get(host);
  if (!entry) return;
  cache.delete(host);
  cacheBytes -= entrySize(entry);
}

function cacheGet(host: string): CacheEntry | undefined {
  const entry = cache.get(host);
  if (!entry) return undefined;
  cacheDelete(host);
  if (entry.expiresAt <= Date.now()) return undefined;
  // Map 按插入顺序迭代：重新插入即移到「最近使用」一端
  cache.set(host, entry);
  cacheBytes += entrySize(entry);
  return entry;
}

function cacheSet(host: string, entry: CacheEntry) {
  cacheDelete(host);
  cache.set(host, entry);
  cacheBytes += entrySize(entry);
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cacheDelete(oldest);
  }
}

// ── 并发：同主机合并、全局限流 ───────────────────────────────

class QueueFull extends Error {}

let activeFetches = 0;
const waiting: Array<() => void> = [];

async function withFetchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) activeFetches++;
  else if (waiting.length >= MAX_QUEUED_FETCHES) throw new QueueFull();
  else await new Promise<void>((resolve) => waiting.push(resolve));
  // 5 秒预算从拿到名额才开始算：排队久不该让主机被误记成「未取到」并缓存一天
  try {
    return await task();
  } finally {
    // 名额直接交给下一个排队者；没人排队才归还
    const next = waiting.shift();
    if (next) next();
    else activeFetches--;
  }
}

const inflight = new Map<string, Promise<CacheEntry>>();

function lookupFavicon(host: string): Promise<CacheEntry> {
  const pending = inflight.get(host);
  if (pending) return pending;
  const promise = withFetchSlot(() => fetchFavicon(host))
    .then((entry) => {
      cacheSet(host, entry);
      return entry;
    })
    .finally(() => inflight.delete(host));
  inflight.set(host, promise);
  return promise;
}

// ── 每个来源 IP 的外网抓取次数（固定窗口） ───────────────────

const upstreamByIp = new Map<string, { windowStart: number; count: number }>();

function allowUpstreamFetch(ipKey: string, now = Date.now()): boolean {
  let bucket = upstreamByIp.get(ipKey);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    if (upstreamByIp.size >= RATE_MAX_TRACKED_IPS) {
      for (const [key, value] of upstreamByIp) if (now - value.windowStart >= RATE_WINDOW_MS) upstreamByIp.delete(key);
      if (upstreamByIp.size >= RATE_MAX_TRACKED_IPS) upstreamByIp.clear();
    }
    bucket = { windowStart: now, count: 0 };
    upstreamByIp.set(ipKey, bucket);
  }
  if (bucket.count >= RATE_MAX_UPSTREAM_PER_IP) return false;
  bucket.count++;
  return true;
}

// ── 路由处理 ─────────────────────────────────────────────────

export async function faviconHandler(req: Request, res: Response): Promise<void> {
  const host = normalizeFaviconHost(req.query.host);
  if (!host) {
    res.status(400).end();
    return;
  }
  let entry = cacheGet(host);
  if (!entry) {
    if (!inflight.has(host) && !allowUpstreamFetch(clientIpKey(req))) {
      res.status(429).setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }
    try {
      entry = await lookupFavicon(host);
    } catch {
      // 只有排队满会走到这里；是暂时状态，不缓存
      res.status(503).setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!entry.body) {
    res.status(404).setHeader("Cache-Control", MISS_CACHE_CONTROL);
    res.end();
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Cache-Control", SUCCESS_CACHE_CONTROL);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.end(entry.body);
}
