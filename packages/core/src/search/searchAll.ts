import { fuseByRrf, type RankedDoc } from "./evidencePursuit/index.js";
import { isSearchSourceConfigured, SEARCH_CATALOG } from "./searchCatalog.js";
import { callSearchProvider } from "./searchProviders.js";
import { toEvidence } from "./toEvidence.js";
import type { Evidence, Provenance } from "./types.js";
import { withTimeout } from "../util/httpUtils.js";

export type SearchHit = {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
  provider?: string;
};

export type SearchProviderFn = (query: string) => Promise<readonly SearchHit[]>;

export type SearchProgress = {
  kind: "provider.started" | "provider.finished" | "provider.failed" | "merged";
  provider?: string;
  count?: number;
  error?: string;
};

export async function searchAll(
  env: Readonly<{ [key: string]: string | undefined }>,
  query: string,
  opts?: {
    onProgress?: (p: SearchProgress) => void;
    providers?: SearchProviderFn[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<Evidence[]> {
  const providers = opts?.providers ?? defaultSearchProviders(env);
  const onProgress = opts?.onProgress;
  const names = providers.map((fn, index) => providerName(fn, index));

  for (const name of names) {
    onProgress?.({ kind: "provider.started", provider: name });
  }

  const settled = await Promise.allSettled(
    providers.map(async (fn, index) => {
      const name = names[index] ?? `p${index + 1}`;
      try {
        const hits = await runProvider(fn, query, name, opts);
        onProgress?.({ kind: "provider.finished", provider: name, count: hits.length });
        return hits;
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason);
        onProgress?.({ kind: "provider.failed", provider: name, error });
        throw reason;
      }
    })
  );

  const rankedLists: RankedDoc[][] = [];
  settled.forEach((item, index) => {
    if (item.status !== "fulfilled") return;
    const fallbackName = names[index] ?? "";
    rankedLists.push(
      item.value.map((hit) => ({
        url: hit.url,
        rec: hitToRec(hit, hit.provider ?? fallbackName),
      }))
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
  env: Readonly<{ [key: string]: string | undefined }>
): SearchProviderFn[] {
  const bound = stringEnv(env);
  return SEARCH_CATALOG.filter((meta) => isSearchSourceConfigured(env, meta)).map((meta) => {
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

async function runProvider(
  fn: SearchProviderFn,
  query: string,
  name: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
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
