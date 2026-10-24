/** Durable run authority: commit before broadcasting; no in-memory persistence fallback. */
import { createHash, randomUUID } from "node:crypto";
import { isTerminalStatus, type RunRecord, type RunStatus, type RunStore, type CreateRunInput, type CommitRunInput } from "./runStore.js";
import { interruptedInvestigationSnapshot } from "../../../shared/interruptedSnapshot.js";
import { toPublicStreamEvent } from "../http/publicStream.js";

type StartRunInput = Omit<CreateRunInput, "runId" | "now">;
type StartRunResult = { kind: "created" | "existing"; run: RunRecord } | { kind: "conflict"; existing: RunRecord };
type CancelResult = { kind: "cancelling" | "already-terminal"; run: RunRecord } | { kind: "not-found" };
const CASE_ID_LENGTH = 8;

/**
 * 生成 caseId：基于 claim + timestamp + 随机数。
 * 8 字符 base36。
 */
export function generateCaseId(seed: string): string {
  const input = `${seed}|${Date.now()}|${Math.random().toString(36).slice(2)}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).padStart(CASE_ID_LENGTH, "0").slice(0, CASE_ID_LENGTH);
}

export function hashRunInput(claim: string, extras: Record<string, unknown> = {}): string {
  return createHash("sha256").update(`${claim}\u0000${JSON.stringify(extras)}`).digest("hex").slice(0, 32);
}


export type RunService = ReturnType<typeof createRunService>;
export function createRunService(options: { store: RunStore | null }) {
  if (!options.store) throw new Error("Persistent run storage required");
  const store = options.store;
  const active = new Map<string, AbortController>();
  const subscribers = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  function commit(runId: string, input: CommitRunInput) {
    const current = store.get(runId);
    if (current?.status === "cancelling" && input.status && !["cancelling", "cancelled", "interrupted"].includes(input.status)) {
      return { run: current, events: [] };
    }
    const result = store.commit(runId, { ...input, events: input.events.map(toPublicStreamEvent) });
    if (isTerminalStatus(result.run.status)) active.delete(runId);
    for (const event of result.events) {
      for (const listener of [...(subscribers.get(runId) ?? [])]) {
        try { listener(event); } catch { subscribers.get(runId)?.delete(listener); }
      }
    }
    return result;
  }
  return {
    signalFor: (runId: string) => active.get(runId)?.signal,
    findExisting: store.findByIdempotencyKey,
    start(input: StartRunInput): StartRunResult {
      const existingResult = (run: RunRecord): StartRunResult => input.inputHash === run.inputHash
        ? { kind: "existing", run } : { kind: "conflict", existing: run };
      const existing = input.clientRequestId ? store.findByIdempotencyKey(input.ownerHash ?? null, input.clientRequestId) : null;
      if (existing) return existingResult(existing);
      const runId = randomUUID();
      try {
        const run = store.create({ ...input, runId, now: Date.now() });
        active.set(runId, new AbortController());
        return { kind: "created", run };
      } catch (error) {
        const raced = input.clientRequestId ? store.findByIdempotencyKey(input.ownerHash ?? null, input.clientRequestId) : null;
        if (raced) return existingResult(raced);
        throw error;
      }
    },
    commit,
    advance(runId: string, status: RunStatus): boolean {
      const current = store.get(runId);
      if (!current || isTerminalStatus(current.status) || current.status === status) return false;
      return commit(runId, { status, events: [{ type: "run_state", status, terminal: isTerminalStatus(status) }] }).events.length > 0;
    },
    cancel(runId: string): CancelResult {
      const current = store.get(runId);
      if (!current) return { kind: "not-found" };
      if (isTerminalStatus(current.status)) return { kind: "already-terminal", run: current };
      const result = commit(runId, { status: "cancelling", events: [{ type: "run_state", status: "cancelling", terminal: false }] });
      active.get(runId)?.abort(new Error("cancelled-by-user"));
      return { kind: "cancelling", run: result.run };
    },
    /** Execution failure uses the same durable partial-result contract as ordinary interruption. */
    finish(runId: string, status: "interrupted" | "cancelled"): void {
      const current = store.get(runId);
      if (!current || isTerminalStatus(current.status)) return;
      const resolved = current.status === "cancelling" ? "cancelled" : status;
      const snapshot = interruptedInvestigationSnapshot(current.snapshot ?? undefined, store.getInput(runId)?.claim ?? "");
      if (resolved === "cancelled") snapshot.interruptionReason = "cancelled";
      const controller = active.get(runId);
      commit(runId, {
        status: resolved, snapshot, publication: "partial",
        events: [
          { type: "investigation_snapshot", investigation: snapshot },
          ...(resolved === "interrupted" ? [{ type: "error", message: "这次核查没能完成，请稍后重试" }] : []),
          { type: "run_state", status: resolved, terminal: true, reason: "execution-ended" },
        ],
      });
      controller?.abort(new Error("execution-ended"));
    },
    get: store.get,
    getInput: store.getInput,
    getResult: store.getResult,
    listByOwner: store.listByOwner,
    listReuseCandidates: store.listReuseCandidates,
    deleteOwned: store.deleteOwned,
    replayEvents: store.listEvents,
    replayActivities: store.listActivities,
    markInterruptedOnBoot: store.markInterruptedOnBoot,
    publish(runId: string, event: Record<string, unknown>): void { commit(runId, { events: [event] }); },
    subscribe(runId: string, listener: (event: Record<string, unknown>) => void): () => void {
      const listeners = subscribers.get(runId) ?? new Set();
      listeners.add(listener);
      subscribers.set(runId, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(runId); };
    },
  };
}
