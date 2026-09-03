import type { Claim, Evidence, Provenance } from "../casefile/schema.js";
import { originCluster } from "../fetch/originCluster.js";
import { tierOf } from "../rules/sourceTiers.js";
import {
  buildQueryPortfolio,
  selectPriorityQueries,
} from "../search/evidencePursuit/evidencePursuit.js";
import { searchAll, type SearchHit, type SearchProviderFn } from "../search/searchAll.js";
import { toEvidence } from "../search/toEvidence.js";
import type { StageContext } from "./context.js";

export type RetrieveInput = {
  providers: SearchProviderFn[];
  maxClaims?: number;
  queriesPerClaim?: number;
};

export type RetrieveResult = {
  searched: string[];
  skipped: string[];
};

const DEFAULT_MAX_CLAIMS = 6;
const DEFAULT_QUERIES_PER_CLAIM = 3;
const HAS_DIGIT = /\d/;

function loadBucket(claim: Claim): 0 | 1 {
  return claim.type === "causal" || HAS_DIGIT.test(claim.text) ? 0 : 1;
}

function byLoadThenOrder(a: Claim, b: Claim): number {
  const bucket = loadBucket(a) - loadBucket(b);
  if (bucket !== 0) return bucket;
  return a.order - b.order;
}

function selectByLoad(claims: readonly Claim[], maxClaims: number): { selected: Claim[]; skipped: Claim[] } {
  const ranked = claims.filter((claim) => claim.checkable).slice().sort(byLoadThenOrder);
  return { selected: ranked.slice(0, maxClaims), skipped: ranked.slice(maxClaims) };
}

/** buildQueryPortfolio 固定 6 路；首轮用同模块 selectPriorityQueries 收到 queriesPerClaim。 */
function queriesFor(atom: string, sourceText: string, max: number): string[] {
  const picked = selectPriorityQueries(buildQueryPortfolio(atom, sourceText), { max });
  const queries = picked.map((row) => row.query);
  return queries.length > 0 ? queries : [atom];
}

function nextEvidenceId(ctx: StageContext): string {
  return `e${ctx.current.evidence.length + 1}`;
}

function searchProvenance(query: string, provider: string | undefined): Provenance {
  return provider ? { kind: "search", query, provider } : { kind: "search", query };
}

function providerOf(item: Evidence): string | undefined {
  return item.provenance.kind === "search" ? item.provenance.provider : undefined;
}

function asHit(item: Evidence): SearchHit {
  const hit: SearchHit = { url: item.url, snippet: item.excerpt };
  if (item.title !== undefined) hit.title = item.title;
  if (item.publishedAt !== undefined) hit.publishedAt = item.publishedAt;
  const provider = providerOf(item);
  if (provider !== undefined) hit.provider = provider;
  return hit;
}

/** toEvidence 第二参是 Provenance，不是 `{ provenance }`。 */
function evidenceFromHit(hit: SearchHit, query: string, now: Date): Omit<Evidence, "id"> | null {
  return toEvidence(hit, searchProvenance(query, hit.provider), now);
}

export async function runRetrieve(ctx: StageContext, input: RetrieveInput): Promise<RetrieveResult> {
  const maxClaims = input.maxClaims ?? DEFAULT_MAX_CLAIMS;
  const queriesPerClaim = input.queriesPerClaim ?? DEFAULT_QUERIES_PER_CLAIM;
  const { selected, skipped } = selectByLoad(ctx.current.claims, maxClaims);
  const seen = new Set(ctx.current.evidence.map((item) => item.canonicalUrl));
  const addedIds: string[] = [];

  for (const claim of selected) {
    ctx.emit({ type: "stage.started", stage: "retrieve", claimId: claim.id });
    const queries = queriesFor(claim.text, ctx.current.text, queriesPerClaim);
    for (const query of queries) {
      // searchAll(env, query, { providers })：单源失败已 allSettled，这里不再包一层。
      const found = await searchAll({}, query, {
        providers: input.providers,
        signal: ctx.signal,
      });
      for (const item of found) {
        const drafted = evidenceFromHit(asHit(item), query, new Date(ctx.now()));
        if (!drafted || seen.has(drafted.canonicalUrl)) continue;
        seen.add(drafted.canonicalUrl);
        const evidence: Evidence = {
          ...drafted,
          id: nextEvidenceId(ctx),
          tier: tierOf(drafted.host),
        };
        ctx.emit({ type: "evidence.added", evidence });
        addedIds.push(evidence.id);
      }
    }
    ctx.emit({ type: "stage.finished", stage: "retrieve", claimId: claim.id, outcome: "ok" });
  }

  const added = ctx.current.evidence.filter((item) => addedIds.includes(item.id));
  const clusters = originCluster(
    added.map((item) => ({
      id: item.id,
      host: item.host,
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {}),
    })),
  );
  for (const item of added) {
    const clusterId = clusters.get(item.id);
    if (clusterId === undefined) continue;
    ctx.emit({ type: "evidence.updated", id: item.id, clusterId });
  }

  return {
    searched: selected.map((claim) => claim.id),
    skipped: skipped.map((claim) => claim.id),
  };
}
