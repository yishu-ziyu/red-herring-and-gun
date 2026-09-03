import { parse, type HTMLElement, type Node, NodeType } from "node-html-parser";
import { blockedFetchReason } from "./ssrfGuard.js";
import type { FetchedPage, WebFetchOptions } from "./types.js";

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const BLOCK_TAGS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "section", "article"]);
const STRIP_TAGS = new Set(["script", "style", "noscript", "template"]);

function mergeSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([timeout, signal]);
}

function unreachable(finalUrl: string, error: string, status = 0): FetchedPage {
  return {
    finalUrl,
    status,
    contentType: "",
    text: "",
    links: [],
    images: [],
    reachable: false,
    error,
  };
}

function isHtmlType(contentType: string): boolean {
  const main = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!main) return true;
  return main === "text/html" || main === "application/xhtml+xml";
}

async function readLimited(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      const take = maxBytes - total;
      if (take > 0) chunks.push(value.subarray(0, take));
      truncated = true;
      total = maxBytes;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function absHttp(raw: string, base: string): string | undefined {
  try {
    const resolved = new URL(raw.trim(), base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;
    return resolved.href;
  } catch {
    return undefined;
  }
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function toIsoDate(raw: string): string | undefined {
  const s = raw.trim();
  const zh = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (zh) {
    const month = Number(zh[2]);
    const day = Number(zh[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${zh[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

function asDatePublished(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function findDatePublished(value: unknown): string | undefined {
  if (typeof value === "string") {
    try {
      return findDatePublished(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDatePublished(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if ("datePublished" in value) {
    const direct = asDatePublished((value as { datePublished: unknown }).datePublished);
    if (direct) return direct;
  }
  for (const nested of Object.values(value)) {
    const found = findDatePublished(nested);
    if (found) return found;
  }
  return undefined;
}

function metaContent(root: HTMLElement, attr: "property" | "name", wanted: string): string | undefined {
  for (const el of root.querySelectorAll("meta")) {
    const got = (el.getAttribute(attr) ?? "").toLowerCase();
    if (got !== wanted) continue;
    const content = el.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

function walkText(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text;
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = (el.rawTagName ?? "").toLowerCase();
  if (STRIP_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  const inner = el.childNodes.map(walkText).join("");
  if (BLOCK_TAGS.has(tag)) return `\n${inner}\n`;
  return inner;
}

function normalizeText(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ExtractedHtml = {
  title?: string;
  publishedAt?: string;
  text: string;
  links: string[];
  images: string[];
};

export function extractHtml(html: string, baseUrl: string): ExtractedHtml {
  const root = parse(html);
  const titleTag = root.querySelector("title")?.text.trim();
  const ogTitle = metaContent(root, "property", "og:title");
  const title = titleTag || ogTitle || undefined;

  let publishedRaw =
    metaContent(root, "property", "article:published_time") ??
    metaContent(root, "name", "pubdate");
  if (!publishedRaw) {
    for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
      publishedRaw = findDatePublished(script.text);
      if (publishedRaw) break;
    }
  }

  const links = dedupe(
    root
      .querySelectorAll("a")
      .map((a) => absHttp(a.getAttribute("href") ?? "", baseUrl))
      .filter((u): u is string => Boolean(u))
  );
  const images = dedupe(
    root
      .querySelectorAll("img")
      .map((img) => absHttp(img.getAttribute("src") ?? "", baseUrl))
      .filter((u): u is string => Boolean(u))
  );

  const text = normalizeText(walkText(root));
  const publishedAt = publishedRaw
    ? toIsoDate(publishedRaw)
    : toIsoDate(text.match(/(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})/)?.[0] ?? "");

  return { title, publishedAt, text, links, images };
}

export async function webFetch(url: string, opts: WebFetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    const signal = mergeSignal(timeoutMs, opts.signal);
    let current = url;
    let lastStatus = 0;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const blocked = await blockedFetchReason(current);
      if (blocked) return unreachable(current, blocked);
      const res = await fetch(current, { redirect: "manual", signal });
      lastStatus = res.status;
      if (REDIRECT_STATUS.has(res.status)) {
        if (hops === MAX_REDIRECTS) {
          return unreachable(current, "too many redirects", res.status);
        }
        const loc = res.headers.get("location");
        if (!loc) return unreachable(current, "redirect missing location", res.status);
        void res.body?.cancel();
        current = new URL(loc, current).href;
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const { bytes, truncated } = await readLimited(res, maxBytes);
      const raw = new TextDecoder("utf-8").decode(bytes);
      if (!isHtmlType(contentType)) {
        return {
          finalUrl: current,
          status: res.status,
          contentType,
          text: "",
          links: [],
          images: [],
          reachable: true,
          truncated: truncated || undefined,
        };
      }
      const extracted = extractHtml(raw, current);
      return {
        finalUrl: current,
        status: res.status,
        contentType,
        html: raw,
        text: extracted.text,
        title: extracted.title,
        publishedAt: extracted.publishedAt,
        links: extracted.links,
        images: extracted.images,
        reachable: true,
        truncated: truncated || undefined,
      };
    }
    return unreachable(url, "too many redirects", lastStatus);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return unreachable(url, error);
  }
}
