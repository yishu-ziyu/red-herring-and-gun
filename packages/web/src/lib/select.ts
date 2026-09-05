import type { Case, Evidence, Pivot } from '@rhg/core/casefile';
import { gainLine, IMAGE_ORIGIN, STATUS } from "./copy.js";

type Cite = Case["cites"][number];

export type CitePart = { type: "text"; value: string } | { type: "cite"; n: number };

export type EvidenceCluster = {
  id: string;
  items: Evidence[];
};

const TIER_RANK: Record<string, number> = { A: 3, B: 2, C: 1, unknown: 0 };

const STAGE_STATUS: Record<string, string> = {
  intake: STATUS.decomposing,
  qualify: STATUS.decomposing,
  decompose: STATUS.decomposing,
  retrieve: STATUS.retrieving,
  assess: STATUS.assessing,
  judge: STATUS.assessing,
  investigate: STATUS.investigating,
  crossExam: STATUS.examining,
  compose: STATUS.composing,
  finalize: STATUS.composing,
};

const CITE_MARK = /\[(\d+)\]/g;

export function summaryLine(current: Case | null, running: boolean, aborted = false, openingText?: string): string {
  if (!current) return openingText?.trim() || STATUS.decomposing;
  if (current.report?.conclusion) return firstSentence(current.report.conclusion).head;
  const lastAssistant = current.messages.filter((message) => message.role === "assistant").at(-1)?.text;
  if (lastAssistant?.trim()) return firstSentence(lastAssistant).head;
  return latestStatus(current, running, aborted);
}

export function latestStatus(current: Case, running: boolean, aborted = false): string {
  const lastTurn = current.turns.at(-1);
  if (aborted || lastTurn?.reason === "aborted") return STATUS.aborted;
  if (!running && lastTurn?.finishedAt) return STATUS.done;
  const recent = current.stages.at(-1)?.stage;
  if (recent && STAGE_STATUS[recent]) return STAGE_STATUS[recent];
  return running ? STATUS.decomposing : STATUS.done;
}

export function clusterGroups(evidence: Evidence[], cites: Cite[]): EvidenceCluster[] {
  const buckets = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = item.clusterId ?? `solo:${item.id}`;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  const incoming = new Map<string, number>();
  for (const edge of cites) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const groups: EvidenceCluster[] = [];
  for (const [id, items] of buckets) {
    const root = pickRoot(items, incoming);
    groups.push({ id, items: [root, ...items.filter((row) => row.id !== root.id)] });
  }
  return groups;
}

function pickRoot(items: Evidence[], incoming: Map<string, number>): Evidence {
  const maxCite = Math.max(0, ...items.map((item) => incoming.get(item.id) ?? 0));
  const pool = maxCite > 0 ? items.filter((item) => (incoming.get(item.id) ?? 0) === maxCite) : items;
  return [...pool].sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0) || a.id.localeCompare(b.id))[0]!;
}

export function openFrontier(current: Case, limit = 6): Pivot[] {
  return current.frontier
    .filter((pivot) => !current.consumedPivotIds.includes(pivot.id))
    .slice()
    .sort((a, b) => b.expectedValue - a.expectedValue || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function parseCiteMarks(text: string, valid: ReadonlySet<number>): CitePart[] {
  const parts: CitePart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITE_MARK)) {
    const n = Number(match[1]);
    const start = match.index ?? 0;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    if (valid.has(n)) parts.push({ type: "cite", n });
    else parts.push({ type: "text", value: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  const merged: CitePart[] = [];
  for (const part of parts) {
    const prev = merged.at(-1);
    if (part.type === "text" && prev?.type === "text") prev.value += part.value;
    else merged.push(part);
  }
  return merged;
}

export function citationNumbers(current: Case): Set<number> {
  return new Set((current.report?.citations ?? []).map((row) => row.n));
}

export function firstSentence(text: string): { head: string; tail: string } {
  const match = /^(.+?[。！？.!?])([\s\S]*)$/u.exec(text.trim());
  if (!match?.[1]) return { head: text, tail: "" };
  return { head: match[1], tail: match[2] ?? "" };
}

export function pivotLabel(pivot: Pivot): string {
  if (pivot.kind === "image") return IMAGE_ORIGIN;
  if (pivot.kind === "entity" || pivot.kind === "doc_number" || pivot.kind === "date" || pivot.kind === "query") {
    return pivot.value;
  }
  try {
    const url = new URL(pivot.value);
    const path = url.pathname === "/" ? "" : url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}…` : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return pivot.value;
  }
}

export function graphElements(current: Case): { nodeIds: string[]; edges: Cite[] } | null {
  if (current.cites.length === 0) return null;
  const cited = new Set((current.report?.citations ?? []).map((row) => row.evidenceId));
  const nodeIds = new Set<string>();
  if (cited.size === 0) {
    for (const edge of current.cites) {
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  } else {
    for (const id of cited) nodeIds.add(id);
    for (const edge of current.cites) {
      if (cited.has(edge.from)) nodeIds.add(edge.to);
      if (cited.has(edge.to)) nodeIds.add(edge.from);
    }
  }
  const edges = current.cites.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return { nodeIds: [...nodeIds], edges };
}

export function quoteForEvidence(current: Case, evidenceId: string): string | undefined {
  return current.stances.find((row) => row.evidenceId === evidenceId && row.quote)?.quote;
}

export function stancesForEvidence(current: Case, evidenceId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of current.stances) {
    if (row.evidenceId !== evidenceId || seen.has(row.stance)) continue;
    seen.add(row.stance);
    out.push(row.stance);
  }
  return out;
}

export function evidenceById(current: Case, id: string): Evidence | undefined {
  return current.evidence.find((row) => row.id === id);
}

export function citationEvidence(current: Case, n: number): Evidence | undefined {
  const row = current.report?.citations.find((item) => item.n === n);
  return row ? evidenceById(current, row.evidenceId) : undefined;
}

export function tallyText(tally: { sup: number; ref: number; par: number } | undefined): string {
  if (!tally) return "";
  return `＋${tally.sup} －${tally.ref} ±${tally.par}`;
}

export function timelineCounts(current: Case): { chase: number; exam: number } {
  let chase = 0;
  let exam = 0;
  for (const step of current.investigatorSteps) {
    if (step.role === "main") chase += 1;
    else exam += 1;
  }
  return { chase, exam };
}

export function gainText(gain: number): string | null {
  if (!gain) return null;
  return gainLine(gain);
}

export function latestStopReason(current: Case): string | undefined {
  return current.investigatorStops.at(-1)?.reason;
}

export function overallTone(verdictType: string | undefined): "true" | "false" | "unclear" {
  if (verdictType === "true") return "true";
  if (verdictType === "false") return "false";
  return "unclear";
}

export function userMessageIndex(messages: Case["messages"], id: string): number {
  let n = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.id === id) return n;
    n += 1;
  }
  return 0;
}
