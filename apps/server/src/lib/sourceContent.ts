import type { RunRecorder } from "./runRecorder.js";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { isBlockedUrl } from "./ssrfGuard.js";
import type { AtomSearchBundle, AtomSearchSource } from "./atomSearch.js";
import { SOURCE_CONTENT_MAX_CHARS } from "../../../shared/investigation/material.js";

const MAX_URLS = 8;
const DIRECT_TIMEOUT_MS = 8_000;
const JINA_TIMEOUT_MS = 12_000;
const DIRECT_MAX_BYTES = 2_000_000;
const JINA_MAX_BYTES = 64_000;
const MAX_REDIRECTS = 5;
const MIN_CONTENT_CHARS = 200;
const SHORT_PAGE_CHARS = 600;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ACCESS_WALL = /sina visitor system|登录后查看|登录可见|登录后可见|请先登录|需要登录|sign in to continue|log in to continue|\bpassport\.[a-z0-9-]+\.(?:com|cn|net)\b|captcha|access denied|verify you are human/i;

type ContentResult = Pick<AtomSearchSource, "excerptKind" | "fetchStatus" | "fetchNote" | "retrievedAt"> & { snippet?: string; readMethod?: "direct" | "reader" | "blocked" };
type Attempt = { ok: true; text: string } | { ok: false; status?: number; reason: string };

// ssrfGuard only checks the hostname as written; resolving here rejects public names that point at private addresses at connect time.
function guardedLookup(hostname: string, options: object, callback: (...args: any[]) => void) {
  lookup(hostname, { ...options, all: true }, (error, addresses: any) => {
    if (error) return callback(error);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as Array<{ address: string; family: number }>;
    const allowed = list.filter((a) => !isBlockedUrl(a.family === 6 ? `http://[${a.address}]/` : `http://${a.address}/`));
    if (!allowed.length) return callback(new Error("blocked-address"));
    if ((options as { all?: boolean }).all) return callback(null, allowed);
    callback(null, allowed[0]!.address, allowed[0]!.family);
  });
}

function get(url: string, signal: AbortSignal, maxBytes: number, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    let current = url;
    let hops = 0;
    const go = () => {
      if (isBlockedUrl(current)) return reject(new Error("blocked-url"));
      const mod = current.startsWith("https:") ? https : http;
      const req = mod.get(current, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate, br", ...headers }, lookup: guardedLookup as any, signal }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (++hops > MAX_REDIRECTS) return reject(new Error("too-many-redirects"));
          current = new URL(res.headers.location, current).href;
          return go();
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
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks), finalUrl: current });
            return;
          }
          chunks.push(chunk);
        });
        stream.once("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), finalUrl: current }));
        stream.once("error", reject);
      });
      req.once("error", reject);
    };
    go();
  });
}

function decodeHtml(body: Buffer, contentType: string): string {
  const sniff = body.subarray(0, 4096).toString("latin1");
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
  try { return new TextDecoder(charset.toLowerCase()).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", hellip: "…", middot: "·" };
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t　]+/g, " ")
    .trim();
}

export function extractArticleText(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|header|footer|nav|aside|form|select|button)\b[\s\S]*?<\/\1>/gi, "");
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1] ?? "");
  // Related-link lists ("·标题 2014年10月15日") look like paragraphs but are not article text.
  const isLinkLine = (t: string) => /^[·•]/.test(t) || /\d{4}[-年]\d{1,2}[-月]\d{1,2}日?$/.test(t) && t.length < 60;
  const pick = (tags: string) => [...new Set([...cleaned.matchAll(new RegExp(`<(${tags})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi"))]
    .map((m) => stripTags(m[2]!))
    .filter((t) => t.length >= 12 && !isLinkLine(t)))].join("\n");
  let text = pick("p|h1|h2|h3|blockquote");
  if (text.length < MIN_CONTENT_CHARS) text = pick("p|h1|h2|h3|blockquote|li|td");
  if (text.length < MIN_CONTENT_CHARS) {
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(cleaned)?.[1] ?? cleaned;
    text = stripTags(body.replace(/<\/(div|section|article|tr)>/gi, "\n")).split("\n").map((l) => l.trim()).filter((l) => l.length >= 12 && !isLinkLine(l)).join("\n");
  }
  return (title ? `${title}\n\n${text}` : text).trim();
}

function timeoutSignal(parent: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(ms)]);
}

/**
 * 转读服务返回整页 Markdown，导航、推荐阅读、评论区都在里面，常把一篇几百字的新闻撑过字数上限，
 * 被截断的正文又不能用来支持或反驳。只留正文样子的行。
 */
export function cleanReaderText(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const withoutImages = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
      const links = withoutImages.match(/\[[^\]]*\]\([^)]*\)/g) ?? [];
      const text = withoutImages.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^[\s*#>|-]+/, "").replace(/\s+/g, " ").trim();
      const outsideLinks = withoutImages.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/[\s*#>|·•\-]+/g, "");
      // A line that is only a link (menu item, related headline) is not article text.
      if (links.length > 0 && outsideLinks.length < 10) return "";
      return text;
    })
    // Login prompts and widget labels are short and have no sentence punctuation; article sentences do.
    .filter((line) => line.length >= 40 || (line.length >= 12 && /[。！？!?]/.test(line)))
    .join("\n");
}

function failure(error: unknown, signal: AbortSignal, parent: AbortSignal): Attempt {
  parent.throwIfAborted();
  const msg = error instanceof Error ? error.message : String(error);
  if (signal.aborted || /timeout|aborted/i.test(msg)) return { ok: false, reason: "超时" };
  if (/blocked/.test(msg)) return { ok: false, status: 451, reason: "地址被安全规则拦截" };
  if (/redirects/.test(msg)) return { ok: false, reason: "跳转次数过多" };
  const code = (error as { code?: string })?.code ?? "";
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return { ok: false, reason: "域名解析失败" };
  if (/ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|socket disconnected/i.test(code + msg)) return { ok: false, reason: "连接被断开" };
  if (/CERT|certificate/i.test(code + msg)) return { ok: false, reason: "证书错误" };
  return { ok: false, reason: `读取出错（${msg.slice(0, 60)}）` };
}

function judgeContent(content: string): Attempt {
  if (ACCESS_WALL.test(content.slice(0, 3000))) return { ok: false, status: 403, reason: "需要登录或验证" };
  if (content.length < MIN_CONTENT_CHARS) return { ok: false, reason: "正文为空或过短" };
  return { ok: true, text: content };
}

async function readDirect(url: string, parent: AbortSignal, retry = true): Promise<Attempt> {
  const signal = timeoutSignal(parent, DIRECT_TIMEOUT_MS);
  try {
    const res = await get(url, signal, DIRECT_MAX_BYTES, { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6" });
    if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    const type = String(res.headers["content-type"] || "");
    if (type && !/html|xml|text\/plain/i.test(type)) return { ok: false, reason: `不是网页（${type.split(";")[0]}）` };
    return judgeContent(extractArticleText(decodeHtml(res.body, type)));
  } catch (error) {
    const result = failure(error, signal, parent);
    // Resets during the TLS handshake are often transient on cross-border links; one quick retry recovers most of them.
    if (retry && !result.ok && result.reason === "连接被断开") return readDirect(url, parent, false);
    return result;
  }
}

async function readViaJina(url: string, parent: AbortSignal): Promise<Attempt> {
  const signal = timeoutSignal(parent, JINA_TIMEOUT_MS);
  try {
    const res = await get(`https://r.jina.ai/${encodeURIComponent(url)}`, signal, JINA_MAX_BYTES, { Accept: "text/plain" });
    if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    const text = res.body.toString("utf-8");
    const returnedUrl = text.match(/^URL Source:\s*(https?:\/\/\S+)/m)?.[1];
    if (returnedUrl && isBlockedUrl(returnedUrl)) return { ok: false, status: 451, reason: "跳转地址被安全规则拦截" };
    if (/^Warning:.*(?:[45]\d\d|error)/im.test(text)) return { ok: false, status: 403, reason: "原网站拒绝访问" };
    const start = text.search(/^Markdown Content:\s*$/m);
    return judgeContent(cleanReaderText(start >= 0 ? text.slice(start).replace(/^Markdown Content:\s*/, "") : text));
  } catch (error) {
    return failure(error, signal, parent);
  }
}

async function readSource(url: string, signal: AbortSignal, maxChars: number): Promise<ContentResult> {
  if (!/^https?:\/\//i.test(url) || isBlockedUrl(url) || new URL(url).username || new URL(url).password) {
    return { readMethod: "blocked", fetchStatus: "restricted", fetchNote: "网址被安全规则拦截，未读取正文，保留检索摘要" };
  }
  const direct = await readDirect(url, signal);
  // Short direct text usually means the article body is rendered by script; the reader service often gets more.
  let attempt: Attempt = direct;
  let readMethod: "direct" | "reader" = "direct";
  if (!direct.ok || direct.text.length < SHORT_PAGE_CHARS) {
    const viaJina = await readViaJina(url, signal);
    if ((viaJina.ok && (!direct.ok || viaJina.text.length > direct.text.length)) || !direct.ok) {
      attempt = viaJina;
      readMethod = "reader";
    }
  }
  if (attempt.ok) {
    const truncated = attempt.text.length > maxChars;
    return {
      readMethod,
      snippet: attempt.text.slice(0, maxChars),
      excerptKind: "page-excerpt",
      fetchStatus: truncated ? "truncated" : "fetched",
      retrievedAt: new Date().toISOString(),
      ...(truncated ? { fetchNote: "正文较长，只核对了前面一部分；后面的内容未读" } : {}),
    };
  }
  const fails = [direct, attempt] as Array<Extract<Attempt, { ok: false }>>;
  const restricted = fails.every((f) => f.status !== undefined && [401, 403, 429, 451].includes(f.status));
  return {
    readMethod,
    fetchStatus: restricted ? "restricted" : "failed",
    fetchNote: `正文没读到（直接读取：${fails[0]!.reason}；转读服务：${fails[1]!.reason}），保留检索摘要`,
  };
}

function unread(source: AtomSearchSource): boolean {
  return !source.provenance && source.excerptKind !== "page-excerpt" && (source.fetchStatus === undefined || source.fetchStatus === "snippet-only");
}

/** 每个原子取排名靠前的几条，判定前先读原文；总数受 MAX_URLS 限制。 */
export function pickUrlsToRead(bundle: AtomSearchBundle, perAtom = 3): string[] {
  const picked = new Set<string>();
  const lists = bundle.forAgent.map((item) => item.sources.filter((s) => /^https?:\/\//i.test(s.url) && unread(s)));
  for (let rank = 0; rank < perAtom && picked.size < MAX_URLS; rank++) {
    for (const list of lists) {
      const source = list[rank];
      if (source && picked.size < MAX_URLS) picked.add(source.url);
    }
  }
  return [...picked];
}

/** 只提升本轮检索材料；不增加搜索或模型调用，所有消费者仍读同一 canonical 材料。 */
export async function enrichSearchSources(bundle: AtomSearchBundle, signal?: AbortSignal, deadline?: number, selectedUrls: readonly string[] = [], onSource?: () => void, maxChars = SOURCE_CONTENT_MAX_CHARS, recorder?: RunRecorder): Promise<void> {
  signal?.throwIfAborted();
  const lists = Object.values(bundle.byAtomKey);
  const all = [...lists, bundle.aggregate.sources as AtomSearchSource[], ...bundle.forAgent.map((item) => item.sources)];
  const urls = new Set<string>();
  for (const url of selectedUrls) {
    if (urls.size >= MAX_URLS) break;
    if (all.some((list) => list.some((source) => source.url === url && unread(source)))) urls.add(url);
  }
  if (!urls.size) return;
  const budget = deadline === undefined ? DIRECT_TIMEOUT_MS + JINA_TIMEOUT_MS : Math.max(0, deadline - Date.now());
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), budget);
  try {
    await Promise.all([...urls].map(async (url) => {
      let result: ContentResult;
      try { result = await readSource(url, controller.signal, maxChars); }
      catch {
        signal?.throwIfAborted();
        result = { fetchStatus: "failed", fetchNote: "正文没读到（本次调查剩余时间不够），保留检索摘要" };
      }
      signal?.throwIfAborted();
      const original = all.flat().find((source) => source.url === url);
      const { readMethod, ...sourceResult } = result;
      const materialId = recorder?.recordMaterial({
        url, kind: result.excerptKind === "page-excerpt" ? "page-excerpt" : "search-snippet",
        content: result.snippet ?? original?.snippet ?? "",
        metadata: { ...sourceResult, readMethod: readMethod ?? "unknown", observedAt: new Date().toISOString(), retainedSearchSnippet: result.excerptKind !== "page-excerpt" },
      });
      for (const list of all) {
        for (const source of list) {
          if (source.url === url && unread(source)) Object.assign(source, { fetchNote: undefined }, sourceResult, materialId && result.excerptKind === "page-excerpt" ? { materialId } : {});
        }
      }
      onSource?.();
    }));
    signal?.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
