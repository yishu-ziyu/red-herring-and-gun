import { fuseByRrf, type RankedDoc } from "./evidencePursuit/index.js";
import { isSearchSourceConfigured, parseDisabledSearchProviderIds, SEARCH_CATALOG } from "./searchCatalog.js";
import { callSearchProvider } from "./searchProviders.js";
import { toEvidence } from "./toEvidence.js";
import type { Evidence, Provenance } from "./types.js";
import { withTimeout } from "../util/httpUtils.js";
import { pickAuditionChunk, sanitizeSearchError } from "./semanticRecall.js";

export type SearchHit = {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
  provider?: string;
};

export type SearchProviderFn = (query: string) => Promise<readonly SearchHit[]>;

export type SearchErrorCategory = "timeout" | "aborted" | "network" | "auth" | "quota" | "unknown";
export type SearchSourceOutcome = "ok" | "failed" | "cancelled";

export type SearchProgress = {
  kind: "provider.started" | "provider.finished" | "provider.failed" | "provider.cancelled" | "merged";
  provider?: string;
  query?: string;
  claimId?: string;
  count?: number;
  latencyMs?: number;
  outcome?: SearchSourceOutcome;
  errorCategory?: SearchErrorCategory;
};

export async function searchAll(
  env: Readonly<{ [key: string]: string | undefined }>,
  query: string,
  opts?: {
    onProgress?: (p: SearchProgress) => void;
    providers?: SearchProviderFn[];
    signal?: AbortSignal;
    timeoutMs?: number;
    claimId?: string;
    clock?: () => number;
  },
): Promise<Evidence[]> {
  const providers = opts?.providers ?? defaultSearchProviders(env);
  const onProgress = opts?.onProgress;
  const now = opts?.clock ?? Date.now;
  const names = providers.map((fn, index) => providerName(fn, index));
  const claimId = opts?.claimId;

  for (const name of names) {
    onProgress?.({
      kind: "provider.started",
      provider: name,
      query,
      ...(claimId !== undefined ? { claimId } : {}),
    });
  }

  const settled = await Promise.allSettled(
    providers.map(async (fn, index) => {
      const name = names[index] ?? `p${index + 1}`;
      const started = now();
      try {
        const hits = await runProvider(fn, query, name, opts);
        onProgress?.({
          kind: "provider.finished",
          provider: name,
          query,
          ...(claimId !== undefined ? { claimId } : {}),
          count: hits.length,
          latencyMs: Math.max(0, now() - started),
          outcome: "ok",
        });
        return hits;
      } catch (reason) {
        const classified = classifySearchFailure(reason);
        onProgress?.({
          kind: classified.outcome === "cancelled" ? "provider.cancelled" : "provider.failed",
          provider: name,
          query,
          ...(claimId !== undefined ? { claimId } : {}),
          count: 0,
          latencyMs: Math.max(0, now() - started),
          outcome: classified.outcome,
          errorCategory: classified.category,
        });
        throw reason;
      }
    }),
  );

  const rankedLists: RankedDoc[][] = [];
  settled.forEach((item, index) => {
    if (item.status !== "fulfilled") return;
    const fallbackName = names[index] ?? "";
    rankedLists.push(
      item.value.map((hit) => ({
        url: hit.url,
        rec: hitToRec(hit, hit.provider ?? fallbackName),
      })),
    );
  });

  const fused = rankedLists.length === 0 ? [] : fuseByRrf(rankedLists);
  const seen = new Set<string>();
  const unique: Omit<Evidence, "id">[] = [];
  for (const doc of fused) {
    const hit = recToHit(doc.rec);
    const provider = hit.provider;
    const provenance: Provenance = provider
      ? { kind: "search", query, provider }
      : { kind: "search", query };
    const ev = toEvidence(hit, provenance);
    if (!ev) continue;
    if (seen.has(ev.canonicalUrl)) continue;
    seen.add(ev.canonicalUrl);
    unique.push(ev);
  }

  const withIds: Evidence[] = unique.map((ev, index) => ({ ...ev, id: `e${index + 1}` }));
  onProgress?.({ kind: "merged", count: withIds.length });
  return withIds;
}

export function defaultSearchProviders(
  env: Readonly<{ [key: string]: string | undefined }>,
): SearchProviderFn[] {
  const bound = stringEnv(env);
  const disabled = parseDisabledSearchProviderIds(env);
  return SEARCH_CATALOG.filter((meta) => isSearchSourceConfigured(env, meta) && !disabled.has(meta.id)).map((meta) => {
    const id = meta.id;
    const fn: SearchProviderFn = async (query) => {
      const result: unknown = await callSearchProvider({
        env: bound,
        provider: id,
        query,
      });
      return hitsFromUnknown(result).map((hit) => ({ ...hit, provider: hit.provider ?? id }));
    };
    Object.defineProperty(fn, "name", { value: id });
    return fn;
  });
}

export function classifySearchFailure(reason: unknown): {
  outcome: Exclude<SearchSourceOutcome, "ok">;
  category: SearchErrorCategory;
} {
  const message = reason instanceof Error ? reason.message : String(reason);
  const name = reason instanceof Error ? reason.name : "";
  if (
    name === "AbortError" ||
    message === "aborted" ||
    message === "This operation was aborted" ||
    message === "The operation was aborted"
  ) {
    return { outcome: "cancelled", category: "aborted" };
  }
  if (/超时 \d+ms/.test(message) || /\btimeout\b/i.test(message)) {
    return { outcome: "failed", category: "timeout" };
  }
  if (/unauthorized|invalid api key|incorrect api key|401\b/i.test(message)) {
    return { outcome: "failed", category: "auth" };
  }
  if (/quota|429\b|余额不足|额度不足/i.test(message)) {
    return { outcome: "failed", category: "quota" };
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|network/i.test(message)) {
    return { outcome: "failed", category: "network" };
  }
  return { outcome: "failed", category: "unknown" };
}

/** 单页全文抓取硬超时：一期 2.5 秒，超时丢弃并记 degraded，不阻断整次。 */
export const PAGE_FETCH_TIMEOUT_MS = 2500;

export type PageFetchOk = {
  url: string;
  text: string;
  chunk: string;
};

export type PageFetchOutcome = {
  ok: PageFetchOk[];
  dropped: Array<{ url: string; reason: string }>;
  degraded: boolean;
};

/**
 * 单页抓取扇出：每页独立硬超时，慢页丢弃、整次记 degraded、有出处照常返回。
 * reason 只放脱敏后的超时/失败分类，不泄漏密钥与原始错误。
 */
export async function fetchPagesWithHardTimeout(
  urls: string[],
  fetcher: (url: string) => Promise<{ title?: string; text: string }>,
  opts?: { timeoutMs?: number; queryForChunk?: string },
): Promise<PageFetchOutcome> {
  const timeoutMs = opts?.timeoutMs ?? PAGE_FETCH_TIMEOUT_MS;
  const queryForChunk = opts?.queryForChunk ?? "";
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const fetched = await withTimeout(Promise.resolve(fetcher(url)), timeoutMs, `抓取 ${url}`);
      return { url, fetched };
    }),
  );
  const ok: PageFetchOk[] = [];
  const dropped: Array<{ url: string; reason: string }> = [];
  settled.forEach((item, index) => {
    const url = urls[index];
    if (item.status === "fulfilled") {
      const text = String(item.value.fetched?.text || "").slice(0, 4000);
      if (!text.trim()) {
        dropped.push({ url, reason: "空页" });
        return;
      }
      ok.push({
        url,
        text,
        chunk: pickAuditionChunk(queryForChunk, String(item.value.fetched?.title || ""), text),
      });
      return;
    }
    const raw = item.reason instanceof Error ? item.reason.message : String(item.reason);
    const reason = /超时 \d+ms/.test(raw) ? "单页超时已丢弃" : sanitizeSearchError(raw);
    dropped.push({ url, reason });
  });
  return { ok, dropped, degraded: dropped.length > 0 };
}

async function runProvider(
  fn: SearchProviderFn,
  query: string,
  name: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<readonly SearchHit[]> {
  const signal = opts?.signal;
  if (signal?.aborted) throw new Error("aborted");
  let work: Promise<readonly SearchHit[]> = Promise.resolve(fn(query));
  if (signal) {
    // ponytail: 提供商 fetch 不收 signal，用 race 让调用方在 abort 时立即解脱；底层只读请求在后台自生自灭。要真正断连得把 signal 穿进每个 provider 的 fetch。
    const onAbort = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    work = Promise.race([work, onAbort]);
  }
  if (opts?.timeoutMs != null && opts.timeoutMs > 0) {
    return withTimeout(work, opts.timeoutMs, name);
  }
  return work;
}

function providerName(fn: SearchProviderFn, index: number): string {
  return fn.name || `p${index + 1}`;
}

function stringEnv(env: Readonly<{ [key: string]: string | undefined }>): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function hitsFromUnknown(result: unknown): SearchHit[] {
  if (!result || typeof result !== "object" || !("sources" in result)) return [];
  const sources = (result as { sources: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  const hits: SearchHit[] = [];
  for (const item of sources) {
    if (!item || typeof item !== "object") continue;
    const url = "url" in item && typeof item.url === "string" ? item.url : "";
    if (!url) continue;
    const hit: SearchHit = { url };
    if ("title" in item && typeof item.title === "string") hit.title = item.title;
    if ("snippet" in item && typeof item.snippet === "string") hit.snippet = item.snippet;
    if ("publishedAt" in item && typeof item.publishedAt === "string") hit.publishedAt = item.publishedAt;
    hits.push(hit);
  }
  return hits;
}

function hitToRec(hit: SearchHit, provider: string): RankedDoc["rec"] {
  const rec: RankedDoc["rec"] = { url: hit.url, provider };
  if (hit.title !== undefined) rec.title = hit.title;
  if (hit.snippet !== undefined) rec.snippet = hit.snippet;
  if (hit.publishedAt !== undefined) rec.publishedAt = hit.publishedAt;
  return rec;
}

function recToHit(rec: RankedDoc["rec"]): SearchHit {
  const hit: SearchHit = { url: String(rec.url ?? "") };
  if (typeof rec.title === "string") hit.title = rec.title;
  if (typeof rec.snippet === "string") hit.snippet = rec.snippet;
  if (typeof rec.publishedAt === "string") hit.publishedAt = rec.publishedAt;
  if (typeof rec.provider === "string") hit.provider = rec.provider;
  return hit;
}
