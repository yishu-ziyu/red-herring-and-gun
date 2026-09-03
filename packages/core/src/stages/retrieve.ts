import type { Claim, Evidence } from "../casefile/schema.js";
import { originCluster } from "../fetch/originCluster.js";
import { stripMobileOrWww, tierOf } from "../rules/sourceTiers.js";
import {
  buildQueryPortfolio,
  selectPriorityQueries,
} from "../search/evidencePursuit/evidencePursuit.js";
import { searchAll, type SearchProviderFn } from "../search/searchAll.js";
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

function emitClusterUpdates(ctx: StageContext): void {
  const items = ctx.current.evidence;
  const clusters = originCluster(
    items.map((item) => ({
      id: item.id,
      // originCluster 按 host 全等；intake 可能留 www.，检索侧 toEvidence 已折叠。
      host: stripMobileOrWww(item.host),
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {}),
    })),
  );
  const size = new Map<string, number>();
  for (const clusterId of clusters.values()) {
    size.set(clusterId, (size.get(clusterId) ?? 0) + 1);
  }
  for (const item of items) {
    const clusterId = clusters.get(item.id);
    if (clusterId === undefined || (size.get(clusterId) ?? 0) < 2) continue;
    if (item.clusterId === clusterId) continue;
    ctx.emit({ type: "evidence.updated", id: item.id, clusterId });
  }
}

export async function runRetrieve(ctx: StageContext, input: RetrieveInput): Promise<RetrieveResult> {
  const maxClaims = input.maxClaims ?? DEFAULT_MAX_CLAIMS;
  const queriesPerClaim = input.queriesPerClaim ?? DEFAULT_QUERIES_PER_CLAIM;
  const { selected, skipped } = selectByLoad(ctx.current.claims, maxClaims);
  const seen = new Set(ctx.current.evidence.map((item) => item.canonicalUrl));

  for (const claim of selected) {
    ctx.emit({ type: "stage.started", stage: "retrieve", claimId: claim.id });
    const queries = queriesFor(claim.text, ctx.current.text, queriesPerClaim);
    for (const query of queries) {
      const found = await searchAll({}, query, {
        providers: input.providers,
        signal: ctx.signal,
      });
      for (const item of found) {
        if (seen.has(item.canonicalUrl)) continue;
        seen.add(item.canonicalUrl);
        const evidence: Evidence = {
          ...item,
          id: nextEvidenceId(ctx),
          tier: tierOf(item.host),
          retrievedAt: ctx.now(),
        };
        ctx.emit({ type: "evidence.added", evidence });
      }
    }
    ctx.emit({ type: "stage.finished", stage: "retrieve", claimId: claim.id, outcome: "ok" });
  }

  emitClusterUpdates(ctx);

  return {
    searched: selected.map((claim) => claim.id),
    skipped: skipped.map((claim) => claim.id),
  };
}
