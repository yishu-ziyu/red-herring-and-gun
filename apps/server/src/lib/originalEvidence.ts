import dns from "node:dns/promises";
import https from "node:https";
import { isPrivateAddressText } from "./orchestrateByo.js";
import { isBlockedTestLlmUrl } from "./ssrfGuard.js";
import type { AtomSearchBundle, SearchOneAtom } from "./atomSearch.js";

const MAX_BYTES = 240_000;
const MAX_TEXT = 80_000;

/** A search summary is never page text. Failed retrieval leaves originalText absent. */
export async function fetchOriginalText(url: string, signal?: AbortSignal): Promise<string | undefined> {
  let current = url;
  for (let redirect = 0; redirect < 3; redirect++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return undefined; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return undefined;
    if (isPrivateAddressText(parsed.hostname) || isBlockedTestLlmUrl(current)) return undefined;
    try {
      const addresses = await dns.lookup(parsed.hostname, { all: true });
      if (!addresses.length || addresses.some(({ address }) =>
        isPrivateAddressText(address) || isBlockedTestLlmUrl(`https://${address.includes(":") ? `[${address}]` : address}`)
      )) return undefined;
      // Pin the validated DNS result for this connection; repeat validation after each redirect.
      const result = await new Promise<{ status: number; location?: string; contentType: string; body: Buffer }>((resolve, reject) => {
        const address = addresses[0];
        const request = https.request(parsed, {
          method: "GET",
          family: address.family,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
          headers: { accept: "text/html,text/plain", "accept-encoding": "identity", "user-agent": "RedHerringGun/1.0" },
        }, (response) => {
          const status = response.statusCode ?? 0;
          const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
          const contentType = String(response.headers["content-type"] ?? "");
          if ((status >= 300 && status < 400) || status !== 200 || !/text\/(html|plain)/i.test(contentType)) {
            response.resume();
            resolve({ status, location, contentType, body: Buffer.alloc(0) });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) { request.destroy(new Error("source body too large")); return; }
            chunks.push(chunk);
          });
          response.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks) }));
          response.on("error", reject);
        });
        request.on("error", reject);
        request.end();
      });
      if (result.status >= 300 && result.status < 400) {
        const location = result.location;
        if (!location) return undefined;
        current = new URL(location, current).toString();
        continue;
      }
      if (result.status !== 200) return undefined;
      const head = new TextDecoder("latin1").decode(result.body.subarray(0, 4096));
      const charset = /charset=["']?([\w-]+)/i.exec(result.contentType)?.[1]
        ?? /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
      let raw: string;
      try { raw = new TextDecoder(charset).decode(result.body); }
      catch { raw = new TextDecoder().decode(result.body); }
      const text = raw
        .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_m, n: string) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n.toLowerCase() as "nbsp"])
        .replace(/\s+/g, " ").trim();
      return text.length >= 40 ? text.slice(0, MAX_TEXT) : undefined;
    } catch {
      signal?.throwIfAborted();
      return undefined;
    }
  }
  return undefined;
}

/** One bounded body fetch per returned source; every later search pass uses this seam. */
export function withOriginalText(searchOne: SearchOneAtom, signal?: AbortSignal,
  fetchText: (url: string, signal?: AbortSignal) => Promise<string | undefined> = fetchOriginalText): SearchOneAtom {
  return async (query) => {
    const result = await searchOne(query);
    if (!result || typeof result !== "object") return result;
    const record = result as { sources?: unknown };
    if (!Array.isArray(record.sources)) return result;
    const sources = await Promise.all(record.sources.map(async (source, index) => {
      if (!source || typeof source !== "object") return source;
      const item = source as Record<string, unknown>;
      const { originalText: _providerClaim, originalScope: _providerScope, ...safe } = item;
      if (index >= 5) return safe;
      const url = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
      return { ...safe, originalText: url ? await fetchText(url, signal) : undefined };
    }));
    return { ...result, sources };
  };
}

/** Keep model context bounded while retaining the complete body for verification. */
export function agentVisibleSearches(bundle: AtomSearchBundle): AtomSearchBundle["forAgent"] {
  return bundle.forAgent.map(({ claimAtom, sources }) => ({
    claimAtom,
    sources: sources.map((source) => {
      const body = source.originalScope ?? source.originalText;
      if (!body) return source;
      const anchor = source.snippet.length >= 12 ? body.indexOf(source.snippet.slice(0, 40)) : -1;
      const start = anchor > 800 ? anchor - 800 : 0;
      return { ...source, originalText: body.slice(start, start + 6000) };
    }),
  }));
}
