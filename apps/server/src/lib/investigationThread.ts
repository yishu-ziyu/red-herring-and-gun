import { isInvestigationSnapshot, type InvestigationSnapshotV1 } from "./investigation/schema.js";

export type InvestigationRound = {
  id: string;
  question: string;
  kind: "initial" | "follow-up" | "recheck";
  snapshot: InvestigationSnapshotV1;
};

/** Each round keeps its original public snapshot, never a recursively nested report. */
export type InvestigationThread = {
  version: 1;
  id: string;
  originalClaim: string;
  rounds: InvestigationRound[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function readInvestigationThread(report: unknown): InvestigationThread | undefined {
  const data = record(record(report)?.investigationThread);
  if (!data || data.version !== 1 || typeof data.id !== "string" || !data.id ||
      typeof data.originalClaim !== "string" || !Array.isArray(data.rounds)) return undefined;
  const rounds: InvestigationRound[] = [];
  const ids = new Set<string>();
  for (const raw of data.rounds) {
    const round = record(raw);
    if (!round || typeof round.id !== "string" || !round.id || ids.has(round.id) ||
        typeof round.question !== "string" ||
        !["initial", "follow-up", "recheck"].includes(String(round.kind)) ||
        !isInvestigationSnapshot(round.snapshot) ||
        !["complete", "interrupted"].includes(round.snapshot.phase)) return undefined;
    ids.add(round.id);
    rounds.push({ id: round.id, question: round.question, kind: round.kind as InvestigationRound["kind"], snapshot: round.snapshot });
  }
  return { version: 1, id: data.id, originalClaim: data.originalClaim, rounds };
}

export function appendInvestigationRound(thread: InvestigationThread, round: InvestigationRound): InvestigationThread {
  // A retry of persistence may attach a server ID, but must not rewrite a completed round.
  if (thread.rounds.some((existing) => existing.id === round.id)) return thread;
  if (!isInvestigationSnapshot(round.snapshot) || !["complete", "interrupted"].includes(round.snapshot.phase)) {
    throw new Error("Only settled investigation snapshots can be archived.");
  }
  const archived = { ...round, snapshot: JSON.parse(JSON.stringify(round.snapshot)) as InvestigationSnapshotV1 };
  return { ...thread, rounds: [...thread.rounds, archived] };
}

export function threadSummary(report: unknown): { threadId?: string; threadClaim?: string; roundCount?: number } {
  const thread = readInvestigationThread(report);
  return thread ? { threadId: thread.id, threadClaim: thread.originalClaim, roundCount: thread.rounds.length } : {};
}
