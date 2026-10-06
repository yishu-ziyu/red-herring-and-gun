/**
 * Pure extraction of the three source lists the benchmark scores separately:
 *  - searchedSources: everything the searches returned (atomSearchBundle)
 *  - citedSources: what the final report cites (report.citationSources)
 *  - evidenceSources: what the UI's InvestigationSnapshotV1 shows with a real role (支持/反驳/相关/待核对)
 * A source's relation is "unknown" whenever the snapshot is missing; it is never defaulted to 相关.
 */
import type { PipelineSource } from "./answerBenchScore.js";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const ROLE_TO_RELATION: Record<string, string> = {
  support: "支持",
  contradict: "反驳",
  "context-only": "相关",
  unassessed: "待核对",
};

export interface ExtractedSources {
  snapshotBuilt: boolean;
  evidenceSources: PipelineSource[];
  citedSources: PipelineSource[];
  searchedSources: PipelineSource[];
}

export function extractSources(report: Rec, atomSearchBundle?: unknown): ExtractedSources {
  const snap = asRec(report.investigation);
  const snapshotBuilt = arr(snap.claims).length > 0 || arr(snap.sources).length > 0 || snap.schemaVersion === 1;

  const byId = new Map<string, Rec>();
  for (const s of arr(snap.sources)) byId.set(str(asRec(s).id), asRec(s));
  const evidenceSources: PipelineSource[] = [];
  const seen = new Set<string>();
  for (const claim of arr(snap.claims)) {
    for (const link of arr(asRec(claim).evidence)) {
      const l = asRec(link);
      const src = byId.get(str(l.sourceId));
      if (!src) continue;
      const relation = ROLE_TO_RELATION[str(l.role)] ?? "unknown";
      const key = `${str(src.url)}|${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quote = str(l.passage) || str(l.finding) || str(src.excerpt);
      evidenceSources.push({ url: str(src.url), title: str(src.title), relation, ...(quote ? { quote } : {}) });
    }
  }

  const citedSources: PipelineSource[] = [];
  const citedSeen = new Set<string>();
  for (const s of arr(report.citationSources)) {
    const r = asRec(s);
    const url = str(r.url).trim();
    if (!url || citedSeen.has(url)) continue;
    citedSeen.add(url);
    // Relation of a bare citation is not known here; the real role lives in the snapshot.
    const role = evidenceSources.find((e) => e.url === url)?.relation ?? "unknown";
    citedSources.push({ url, title: str(r.title), relation: role });
  }

  const bundle = asRec(atomSearchBundle);
  const agg = asRec(bundle.aggregate);
  const rawSearched = arr(agg.sources).length
    ? arr(agg.sources)
    : arr(bundle.forAgent).flatMap((i) => arr(asRec(i).sources));
  const searchedSources: PipelineSource[] = [];
  const searchedSeen = new Set<string>();
  for (const s of rawSearched) {
    const r = asRec(s);
    const url = str(r.url).trim();
    if (!/^https?:\/\//i.test(url) || searchedSeen.has(url)) continue;
    searchedSeen.add(url);
    searchedSources.push({ url, title: str(r.title), relation: "unknown" });
  }

  return { snapshotBuilt, evidenceSources, citedSources, searchedSources };
}
