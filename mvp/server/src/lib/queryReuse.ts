/**
 * Query reuse — accepted search_strategy 问法并进首轮实搜。
 * 只复用 query 字符串；旧案 URL / 判词不得进种子。
 */

import { buildAtomSearchQueries } from "./atomSearchQuery.js";
import type { MemoryCandidate, MemoryCandidateHit, SearchStrategyMemoryPayload } from "./memoryCandidateTypes.js";

export const REUSE_QUERY_CAP = 3;

const VERDICT_ONLY =
  /^(true|false|unverified|mixed_misleading|mixed|exaggerated|能信|不能信|还查不清|有真有假|部分成立|只能信一部分|部分可信|可信|不可信)$/i;

export function extractReusableQueries(hits: MemoryCandidateHit[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const candidate = hit?.candidate;
    if (!candidate || candidate.status !== "accepted") continue;
    if (candidate.kind !== "search_strategy") continue;
    for (const raw of strategyQueries(candidate)) {
      if (!isReusableQueryText(raw)) continue;
      if (seen.has(raw)) continue;
      if (isProvenanceUrl(candidate, raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export function mergeReuseSeeds(recipe: string[], seeds: string[], max = REUSE_QUERY_CAP): string[] {
  const usableSeeds = uniqueKeep((seeds ?? []).filter(isReusableQueryText));
  if (usableSeeds.length === 0) return [...(recipe ?? [])];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const q = typeof value === "string" ? value.trim() : "";
    if (!q || seen.has(q) || out.length >= max) return;
    seen.add(q);
    out.push(q);
  };

  for (const seed of usableSeeds) {
    if (recipe.includes(seed)) continue;
    push(seed);
    break;
  }
  for (const q of recipe ?? []) push(q);
  return out;
}

export function buildQueriesWithReuse(atom: string, hits: MemoryCandidateHit[] = []): string[] {
  const recipe = buildAtomSearchQueries(atom);
  return mergeReuseSeeds(recipe, extractReusableQueries(hits));
}

function strategyQueries(candidate: MemoryCandidate): string[] {
  const payload = candidate.payload as Partial<SearchStrategyMemoryPayload> | undefined;
  if (!payload || !Array.isArray(payload.effectiveQueries)) return [];
  return payload.effectiveQueries.filter((item): item is string => typeof item === "string");
}

function isReusableQueryText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const q = value.trim();
  if (!q) return false;
  if (looksLikeUrl(q) || VERDICT_ONLY.test(q)) return false;
  return true;
}

function looksLikeUrl(value: string): boolean {
  const t = value.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (/^www\./i.test(t)) return true;
  if (!/\s/.test(t) && /\.[a-z]{2,}(\/|$|\?)/i.test(t)) return true;
  return false;
}

function isProvenanceUrl(candidate: MemoryCandidate, query: string): boolean {
  const urls = candidate.provenance?.sourceUrls ?? [];
  return urls.some((url) => url && url === query);
}

function uniqueKeep(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const q = item.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}
