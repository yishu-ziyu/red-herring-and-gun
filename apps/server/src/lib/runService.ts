/** Durable run authority: commit before broadcasting; no in-memory persistence fallback. */
import { createHash, randomUUID } from "node:crypto";
import { isTerminalStatus, type RunRecord, type RunStatus, type RunStore, type CreateRunInput, type CommitRunInput } from "./runStore.js";
import { interruptedInvestigationSnapshot } from "../../../shared/interruptedSnapshot.js";
import type { InvestigationSnapshotV1 } from "../../../shared/investigation/index.js";
import { toPublicStreamEvent } from "../http/publicStream.js";
import { createInvestigationEmitter } from "./investigationEmitter.js";
import type { Reservation } from "./quotaLedger.js";
import { createRunRecorder } from "./runRecorder.js";
import { RUN_FINAL_STATUS, type RunEnding, type RunOutcome } from "./run/outcome.js";

type StartRunInput = Omit<CreateRunInput, "runId" | "now"> & { reservation: Reservation };
type StartRunResult = { kind: "created" | "existing"; run: RunRecord } | { kind: "conflict"; existing: RunRecord };
type CancelResult = { kind: "cancelling" | "already-terminal"; run: RunRecord } | { kind: "not-found" };
const CASE_ID_LENGTH = 8;
const RUN_FAILED_MESSAGE = "这次核查没能完成，请稍后重试";

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

/** 没跑完的 run 的最后一帧：保留已真实获得的数据。存量快照通不过校验时只改 phase，不让恢复整体失败。 */
function interruptedSnapshotOf(last: InvestigationSnapshotV1 | undefined, displayClaim: string): InvestigationSnapshotV1 {
  try {
    return interruptedInvestigationSnapshot(last, displayClaim);
  } catch (error) {
    if (!last) throw error;
    console.error("[run] interrupted snapshot failed validation, keeping recorded data", error);
    return { ...last, phase: "interrupted" };
  }
}

export type RunService = ReturnType<typeof createRunService>;
export function createRunService(options: { store: RunStore | null }) {
  if (!options.store) throw new Error("Persistent run storage required");
  const store = options.store;
  const active = new Map<string, AbortController>();
  const reservations = new Map<string, Reservation>();
  const endingOutcomes = new Map<string, RunOutcome>();
  const emitters = new Map<string, ReturnType<typeof createInvestigationEmitter>>();
  const subscribers = new Map<string, Set<(event: Record<string, unknown>) => void>>();

  function commit(runId: string, input: CommitRunInput) {
    const result = store.commit(runId, { ...input, events: input.events.map(toPublicStreamEvent) });
    if (isTerminalStatus(result.run.status)) ended(runId);
    for (const event of result.events) {
      for (const listener of [...(subscribers.get(runId) ?? [])]) {
        try { listener(event); } catch { subscribers.get(runId)?.delete(listener); }
      }
    }
    return result;
  }

  /** The only place a run's quota is settled: when it actually ends, by the outcome it ended with. */
  function ended(runId: string) {
    const reservation = reservations.get(runId);
    const outcome = endingOutcomes.get(runId);
    if (reservation && !outcome) console.error(`[quota] run 没有结局就结束了，按服务端失败退还 runId=${runId}`);
    reservation?.settle(outcome ?? "server-error");
    reservations.delete(runId);
    emitters.delete(runId);
    const controller = active.get(runId);
    active.delete(runId);
    controller?.abort(new Error("execution-ended"));
  }

  function publish(runId: string, event: Record<string, unknown>): void { commit(runId, { events: [event] }); }

  function emitterFor(runId: string) {
    let emitter = emitters.get(runId);
    if (!emitter) {
      emitter = createInvestigationEmitter({ runId, send: event => publish(runId, event) });
      emitters.set(runId, emitter);
    }
    return emitter;
  }

  return {
    signalFor: (runId: string) => active.get(runId)?.signal,
    findExisting: store.findByIdempotencyKey,
    /** A created run owns the reservation; any other result returns it. */
    start({ reservation, ...input }: StartRunInput): StartRunResult {
      const existingResult = (run: RunRecord): StartRunResult => {
        reservation.release();
        return input.inputHash === run.inputHash ? { kind: "existing", run } : { kind: "conflict", existing: run };
      };
      const existing = input.clientRequestId ? store.findByIdempotencyKey(input.ownerHash ?? null, input.clientRequestId) : null;
      if (existing) return existingResult(existing);
      const runId = randomUUID();
      try {
        const run = store.create({ ...input, runId, now: Date.now() });
        active.set(runId, new AbortController());
        reservations.set(runId, reservation);
        return { kind: "created", run };
      } catch (error) {
        const raced = input.clientRequestId ? store.findByIdempotencyKey(input.ownerHash ?? null, input.clientRequestId) : null;
        if (raced) return existingResult(raced);
        reservation.release();
        throw error;
      }
    },
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
    /** In-progress snapshots only; a run's last snapshot is published by settle. */
    emitSnapshot(runId: string, snapshot: InvestigationSnapshotV1): void {
      if (!active.has(runId) || snapshot.phase === "complete" || snapshot.phase === "interrupted") return;
      const status = snapshot.phase === "judging" ? "judging" : "investigating";
      commit(runId, { snapshot, status, events: emitterFor(runId).snapshotEvents(snapshot) });
    },
    emitSearchStarted(runId: string, atom: string): void {
      if (active.has(runId)) emitterFor(runId).emitSearchStarted(atom);
    },
    /**
     * End a run: publish its last snapshot and result, then the terminal state; the quota settles by outcome as it ends.
     * A final result whose evidence is not in this run's saved materials throws before anything is written;
     * the caller ends the run as a failure instead.
     */
    settle(runId: string, ending: RunEnding): void {
      const current = store.get(runId);
      if (!current || isTerminalStatus(current.status)) return;
      const outcome = current.status === "cancelling" ? "cancelled" : ending.outcome;
      const status = RUN_FINAL_STATUS[outcome];
      let snapshot: InvestigationSnapshotV1 | undefined;
      if (status === "completed") {
        snapshot = ending.snapshot;
        if (!snapshot) throw new Error("Final result has no recorded investigation");
        createRunRecorder(runId).validateSnapshot(snapshot, { requireEvidenceMaterials: true });
      } else if (!ending.failure) {
        snapshot = interruptedSnapshotOf(ending.snapshot ?? current.snapshot ?? undefined, ending.displayClaim);
        if (status === "cancelled") snapshot = { ...snapshot, interruptionReason: "cancelled" };
      }
      const report = ending.report;
      if (report && snapshot) report.investigation = snapshot;
      const error = ending.failure
        ? { type: "error", ...ending.failure }
        : !report && status === "interrupted" ? { type: "error", message: RUN_FAILED_MESSAGE } : null;
      endingOutcomes.set(runId, outcome);
      try {
        commit(runId, {
          status,
          ...(snapshot ? { snapshot, publication: status === "completed" ? "final" as const : "partial" as const } : {}),
          ...(report ? { report } : {}),
          events: [
            ...(snapshot ? emitterFor(runId).snapshotEvents(snapshot) : []),
            ...(error ? [error] : []),
            ...(report ? [{ type: "complete", claim: ending.displayClaim, steps: [], finalReport: report }] : []),
            { type: "run_state", status, terminal: true },
          ],
        });
      } finally {
        endingOutcomes.delete(runId);
      }
    },
    get: store.get,
    getInput: store.getInput,
    getResult: store.getResult,
    listByOwner: store.listByOwner,
    listReuseCandidates: store.listReuseCandidates,
    deleteOwned: store.deleteOwned,
    replayEvents: store.listEvents,
    replayActivities: store.listActivities,
    markInterruptedOnBoot: () => store.markInterruptedOnBoot((run) =>
      run.snapshot ? interruptedSnapshotOf(run.snapshot, run.snapshot.originalClaim) : undefined),
    publish,
    subscribe(runId: string, listener: (event: Record<string, unknown>) => void): () => void {
      const listeners = subscribers.get(runId) ?? new Set();
      listeners.add(listener);
      subscribers.set(runId, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(runId); };
    },
  };
}
