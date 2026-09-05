import type { Case, Evidence } from "@rhg/core/casefile";
import { SEARCH_DONE, SEARCH_FAIL, SEARCH_LABEL, SEARCH_PARTIAL, SEARCH_RUNNING, SEARCH_WAIT } from "./copy.js";

const LABELS: Record<string, string> = {
  any_search: "AnySearch",
  searxng_search: "SearXNG",
  "360_search": "360 智搜",
  metaso_search: "秘塔",
  tavily_search: "Tavily",
  exa_search: "Exa",
  bocha_search: "博查",
  brave_search: "Brave",
  jina_search: "Jina",
  minimax_search: "MiniMax Token Plan",
  stepfun_search: "阶跃 Step Plan",
};

export type RadarStatus = "pending" | "running" | "completed" | "partial" | "failed";

export type RadarProvider = {
  id: string;
  label: string;
  status: RadarStatus;
  resultCount: number;
};

export type RadarStats = {
  rawResultCount: number;
  uniqueSourceCount: number;
};

export type RadarModel = {
  providers: RadarProvider[];
  stats?: RadarStats;
  phase: "idle" | "started" | "progress" | "completed";
};

const STATUS_WORD: Record<RadarStatus, string> = {
  pending: SEARCH_WAIT,
  running: SEARCH_RUNNING,
  completed: SEARCH_DONE,
  partial: SEARCH_PARTIAL,
  failed: SEARCH_FAIL,
};

export function radarStatusWord(status: RadarStatus): string {
  return STATUS_WORD[status];
}

export function providerLabel(id: string | undefined): string {
  if (!id) return SEARCH_LABEL;
  return LABELS[id] ?? SEARCH_LABEL;
}

export function stageOpen(current: Case, name: string): boolean {
  for (let i = current.stages.length - 1; i >= 0; i -= 1) {
    const row = current.stages[i];
    if (row?.stage !== name) continue;
    return !row.finishedAt;
  }
  return false;
}

function searchEvidence(current: Case): Evidence[] {
  return current.evidence.filter((item) => item.provenance.kind === "search");
}

function providerIdOf(item: Evidence): string {
  const raw = item.provenance.kind === "search" ? item.provenance.provider : undefined;
  if (raw && LABELS[raw]) return raw;
  return "search";
}

export function radarFromCase(current: Case, running: boolean): RadarModel {
  const rows = searchEvidence(current);
  const retrieving = stageOpen(current, "retrieve");
  const grouped = new Map<string, Evidence[]>();
  for (const item of rows) {
    const id = providerIdOf(item);
    const list = grouped.get(id);
    if (list) list.push(item);
    else grouped.set(id, [item]);
  }

  const providers: RadarProvider[] = [...grouped.entries()].map(([id, items]) => ({
    id,
    label: providerLabel(id),
    status: retrieving ? "running" : "completed",
    resultCount: items.length,
  }));

  if (retrieving && providers.length === 0) {
    providers.push({ id: "search", label: SEARCH_LABEL, status: "running", resultCount: 0 });
  }

  if (providers.length === 0) {
    return { providers, phase: "idle" };
  }

  const uniqueSourceCount = new Set(rows.map((item) => item.canonicalUrl || item.url)).size;
  const phase = retrieving ? (rows.length > 0 ? "progress" : "started") : "completed";
  const stats = !retrieving && uniqueSourceCount > 0 ? { rawResultCount: rows.length, uniqueSourceCount } : undefined;

  if (!running && !retrieving && rows.length === 0) {
    return { providers: [], phase: "idle" };
  }

  return { providers, stats, phase };
}

export function providerDetail(row: RadarProvider): string {
  if (row.status === "completed" || row.status === "partial") {
    return row.resultCount > 0 ? `${radarStatusWord(row.status)} · ${row.resultCount} 条` : radarStatusWord(row.status);
  }
  return radarStatusWord(row.status);
}
