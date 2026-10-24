/** Single-process durable runs. Snapshot revisions, event cursors and legacy activity sequences are independent. */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqliteStore.js";
import { isPublicActivity, type InvestigationSnapshotV1, type PublicActivity } from "../../../shared/investigation/index.js";

const RUN_STATUSES = ["accepted", "extracting", "investigating", "judging", "completed", "cancelling", "cancelled", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunKind = "initial" | "follow-up" | "recheck";
const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "interrupted", "cancelled"]);
export function isTerminalStatus(status: RunStatus): boolean { return TERMINAL.has(status); }

export type RunRecord = {
  runId: string;
  caseId: string;
  ownerHash: string | null;
  clientRequestId: string | null;
  inputHash: string | null;
  conversationId: string | null;
  parentRunId: string | null;
  kind: RunKind;
  status: RunStatus;
  revision: number;
  snapshot: InvestigationSnapshotV1 | null;
  lastSeq: number;
  lastEventSeq: number;
  resultId: string | null;
  createdAt: number;
  updatedAt: number;
};
export type StoredRunInput = { claim: string; intake: unknown; memoryRecall?: unknown; priorRound?: unknown };
export type DurableRunEvent = Record<string, unknown> & { runId: string; eventSeq: number; timestamp: number };
export type PublishedRunResult = {
  resultId: string;
  runId: string;
  revision: number;
  kind: "partial" | "final";
  snapshot: InvestigationSnapshotV1;
  report: Record<string, unknown> | null;
  createdAt: number;
};
export type CreateRunInput = {
  runId: string;
  caseId: string;
  ownerHash?: string | null;
  clientRequestId?: string | null;
  inputHash?: string | null;
  conversationId?: string | null;
  parentRunId?: string | null;
  kind?: RunKind;
  input?: StoredRunInput;
  now: number;
};
export type CommitRunInput = {
  events: Record<string, unknown>[];
  status?: RunStatus;
  snapshot?: InvestigationSnapshotV1;
  report?: Record<string, unknown>;
  publication?: "partial" | "final";
};
type RunRow = Omit<RunRecord, "snapshot"> & { snapshot: string | null };
type ResultRow = Omit<PublishedRunResult, "snapshot" | "report"> & { snapshot: string; report: string | null };
function toRecord(row: RunRow): RunRecord {
  let snapshot: InvestigationSnapshotV1 | null = null;
  if (row.snapshot) {
    try { snapshot = JSON.parse(row.snapshot) as InvestigationSnapshotV1; } catch { /* Legacy corrupt snapshots stay unavailable. */ }
  }
  return {
    runId: row.runId, caseId: row.caseId, ownerHash: row.ownerHash,
    clientRequestId: row.clientRequestId, inputHash: row.inputHash,
    conversationId: row.conversationId ?? null, parentRunId: row.parentRunId ?? null,
    kind: row.kind ?? "initial", status: row.status, revision: row.revision,
    snapshot, lastSeq: row.lastSeq, lastEventSeq: row.lastEventSeq ?? 0,
    resultId: row.resultId ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
function toResult(row: ResultRow): PublishedRunResult {
  return { ...row, snapshot: JSON.parse(row.snapshot) as InvestigationSnapshotV1,
    report: row.report ? JSON.parse(row.report) as Record<string, unknown> : null };
}

/** Input and diagnostic payloads are private. Never persist transport credentials. */
function json(value: unknown): string {
  const encoded = JSON.stringify(value, (key, entry: unknown) =>
    /^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|secret|credentials)$/i.test(key)
      ? undefined : entry);
  if (encoded === undefined) throw new Error("Cannot persist undefined JSON");
  return encoded;
}

export type RunStore = ReturnType<typeof createRunStore>;
function createRunStore(db: DatabaseSync) {
  const selectRun = db.prepare("SELECT * FROM runs WHERE runId = ?");
  const read = (runId: string): RunRecord | null => {
    const row = selectRun.get(runId) as RunRow | undefined;
    return row ? toRecord(row) : null;
  };
  function transaction<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try { const value = work(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function appendEvents(run: RunRecord, payloads: Record<string, unknown>[], now: number): DurableRunEvent[] {
    const insert = db.prepare("INSERT INTO run_events (runId, eventSeq, payload, createdAt) VALUES (?, ?, ?, ?)");
    const events = payloads.map((payload, index) => {
      const event = JSON.parse(json({ ...payload, runId: run.runId, eventSeq: run.lastEventSeq + index + 1, timestamp: now })) as DurableRunEvent;
      insert.run(run.runId, event.eventSeq, JSON.stringify(event), now);
      return event;
    });
    if (events.length) db.prepare("UPDATE runs SET lastEventSeq = ?, updatedAt = ? WHERE runId = ?")
      .run(events[events.length - 1]!.eventSeq, now, run.runId);
    return events;
  }
  function commitInside(runId: string, input: CommitRunInput, now: number): { run: RunRecord; events: DurableRunEvent[]; result?: PublishedRunResult } {
    const current = read(runId);
    if (!current) throw new Error(`run not found: ${runId}`);
    if (isTerminalStatus(current.status)) return { run: current, events: [] };
    const status = input.status ?? current.status;
    if (current.status === "cancelling" && (
      !["cancelling", "cancelled", "interrupted"].includes(status) ||
      input.publication === "final" || input.snapshot?.phase === "complete" ||
      input.events.some((event) => event.type === "run_state" &&
        !["cancelling", "cancelled", "interrupted"].includes(String(event.status)))
    )) return { run: current, events: [] };
    const snapshot = input.snapshot ?? current.snapshot;
    const revision = current.revision + (input.snapshot ? 1 : 0);
    let result: PublishedRunResult | undefined;
    if (input.publication) {
      if (!snapshot) throw new Error("Cannot publish a run without a snapshot");
      const last = db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM run_results WHERE runId = ?").get(runId) as { revision: number };
      result = {
        resultId: randomUUID(), runId, revision: last.revision + 1,
        kind: input.publication, snapshot,
        report: input.report ?? null, createdAt: now,
      };
      db.prepare("INSERT INTO run_results (resultId, runId, revision, kind, snapshot, report, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(result.resultId, runId, result.revision, result.kind, json(snapshot), result.report ? json(result.report) : null, now);
      // Return exactly what was persisted, including credential removal.
      result = toResult(db.prepare("SELECT * FROM run_results WHERE resultId = ?").get(result.resultId) as ResultRow);
    }
    db.prepare("UPDATE runs SET status = ?, snapshot = ?, revision = ?, resultId = ?, updatedAt = ? WHERE runId = ?")
      .run(status, snapshot ? json(snapshot) : null, revision, result?.resultId ?? current.resultId, now, runId);
    const payloads = input.events.map((event) => event.type === "complete" && result
      ? { ...event, resultId: result.resultId, resultRevision: result.revision } : event);
    let lastSeq = current.lastSeq;
    const insertActivity = db.prepare("INSERT OR IGNORE INTO run_activities (runId, seq, activityId, payload) VALUES (?, ?, ?, ?)");
    for (const event of payloads) {
      if (event.type !== "investigation_activity") continue;
      if (!isPublicActivity(event.activity)) throw new Error("Invalid durable investigation activity");
      const activity = event.activity;
      insertActivity.run(runId, activity.seq, activity.id, json(activity));
      lastSeq = Math.max(lastSeq, activity.seq);
    }
    if (lastSeq !== current.lastSeq) db.prepare("UPDATE runs SET lastSeq = ? WHERE runId = ?").run(lastSeq, runId);
    const events = appendEvents(current, payloads, now);
    return { run: read(runId)!, events, ...(result ? { result } : {}) };
  }
  return {
    /** Claim before boot recovery. Merely opening a store does not claim execution authority. */
    claimRuntime(): () => void {
      const token = randomUUID();
      const localHost = hostname();
      transaction(() => {
        const owner = db.prepare("SELECT pid, hostname FROM runtime_owner WHERE singleton = 1").get() as
          { pid: number; hostname: string } | undefined;
        if (owner) {
          if (owner.hostname !== localHost) throw new Error("Runtime storage belongs to another host; refusing takeover");
          if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error("Invalid runtime owner PID; refusing takeover");
          // Signal 0 checks existence only. EPERM and unknown errors are not proof of death.
          let dead = false;
          try { process.kill(owner.pid, 0); }
          catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
          if (!dead) throw new Error(`Runtime already owned by a live process (pid=${owner.pid})`);
        }
        db.prepare(`INSERT INTO runtime_owner (singleton, pid, hostname, token, claimedAt)
          VALUES (1, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET
          pid = excluded.pid, hostname = excluded.hostname, token = excluded.token, claimedAt = excluded.claimedAt`)
          .run(process.pid, localHost, token, Date.now());
      });
      let released = false;
      const release = () => {
        if (released) return;
        transaction(() => { db.prepare("DELETE FROM runtime_owner WHERE singleton = 1 AND token = ?").run(token); });
        released = true;
        process.off("exit", onExit);
      };
      const onExit = () => {
        try { release(); }
        catch (error) { console.error("[runtime] Could not release runtime ownership on exit", error); }
      };
      process.once("exit", onExit);
      return release;
    },
    create(input: CreateRunInput): RunRecord {
      return transaction(() => {
        const ownerHash = input.ownerHash ?? null;
        const parent = input.parentRunId ? read(input.parentRunId) : null;
        if (input.parentRunId && (!parent || parent.ownerHash !== ownerHash)) throw new Error("Parent run unavailable for this owner");
        const conversationId = input.conversationId ?? parent?.conversationId ?? randomUUID();
        if (parent?.conversationId && parent.conversationId !== conversationId) throw new Error("Parent run belongs to another conversation");
        const conversation = db.prepare("SELECT ownerHash FROM conversations WHERE conversationId = ?").get(conversationId) as { ownerHash: string | null } | undefined;
        if (conversation && conversation.ownerHash !== ownerHash) throw new Error("Conversation unavailable for this owner");
        if (!conversation) db.prepare("INSERT INTO conversations (conversationId, ownerHash, createdAt) VALUES (?, ?, ?)").run(conversationId, ownerHash, input.now);
        db.prepare(`INSERT INTO runs (runId, caseId, ownerHash, clientRequestId, inputHash, conversationId, parentRunId, kind,
          status, revision, snapshot, activities, lastSeq, lastEventSeq, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 0, NULL, '[]', 0, 0, ?, ?)`)
          .run(input.runId, input.caseId, ownerHash, input.clientRequestId ?? null, input.inputHash ?? null,
            conversationId, input.parentRunId ?? null, input.kind ?? "initial", input.now, input.now);
        if (input.input) db.prepare("INSERT INTO run_inputs (runId, payload) VALUES (?, ?)").run(input.runId, json(input.input));
        appendEvents(read(input.runId)!, [
          { type: "run_started", caseId: input.caseId, conversationId, parentRunId: input.parentRunId ?? null, kind: input.kind ?? "initial", startedAt: input.now },
          { type: "run_state", status: "accepted", revision: 0 },
        ], input.now);
        return read(input.runId)!;
      });
    },
    get: read,
    getInput(runId: string): StoredRunInput | null {
      const row = db.prepare("SELECT payload FROM run_inputs WHERE runId = ?").get(runId) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as StoredRunInput : null;
    },
    findByIdempotencyKey(ownerHash: string | null, clientRequestId: string): RunRecord | null {
      const row = db.prepare("SELECT * FROM runs WHERE ownerHash IS ? AND clientRequestId = ? ORDER BY createdAt ASC LIMIT 1")
        .get(ownerHash, clientRequestId) as RunRow | undefined;
      return row ? toRecord(row) : null;
    },
    commit(runId: string, input: CommitRunInput, now = Date.now()) {
      return transaction(() => commitInside(runId, input, now));
    },
    listEvents(runId: string, afterEventSeq = 0, limit?: number): DurableRunEvent[] {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError("Event page limit must be a positive integer");
      const rows = (limit === undefined
        ? db.prepare("SELECT payload FROM run_events WHERE runId = ? AND eventSeq > ? ORDER BY eventSeq ASC").all(runId, afterEventSeq)
        : db.prepare("SELECT payload FROM run_events WHERE runId = ? AND eventSeq > ? ORDER BY eventSeq ASC LIMIT ?")
          .all(runId, afterEventSeq, Math.min(limit, 1000))) as Array<{ payload: string }>;
      return rows.map((row) => JSON.parse(row.payload) as DurableRunEvent);
    },
    getResult(runId: string, revision?: number): PublishedRunResult | null {
      const row = (revision === undefined
        ? db.prepare("SELECT * FROM run_results WHERE runId = ? ORDER BY revision DESC LIMIT 1").get(runId)
        : db.prepare("SELECT * FROM run_results WHERE runId = ? AND revision = ?").get(runId, revision)) as ResultRow | undefined;
      return row ? toResult(row) : null;
    },
    /**
     * 可复用的已完成调查：只有文字（没有图片、没有链接）、不是追问、本身不是复用来的，
     * 且在 sinceMs 之后发布过最终结果。最新的在前；只取原话，不读快照与报告。
     */
    listReuseCandidates(sinceMs: number, limit = 500): Array<{ runId: string; claim: string }> {
      return db.prepare(`SELECT r.runId AS runId, json_extract(i.payload, '$.claim') AS claim
        FROM runs r JOIN run_inputs i ON i.runId = r.runId
        WHERE r.status = 'completed' AND r.kind IN ('initial', 'recheck')
          AND COALESCE(json_array_length(i.payload, '$.intake.images'), 0) = 0
          AND COALESCE(json_array_length(i.payload, '$.intake.links'), 0) = 0
          AND json_type(r.snapshot, '$.reusedFrom') IS NULL
          AND EXISTS (SELECT 1 FROM run_results rr WHERE rr.runId = r.runId AND rr.kind = 'final' AND rr.createdAt >= ?)
        ORDER BY r.updatedAt DESC, r.runId DESC LIMIT ?`)
        .all(sinceMs, limit)
        .filter((row): row is { runId: string; claim: string } => typeof row.claim === "string");
    },
    listByOwner(ownerHash: string, limit = 50): RunRecord[] {
      const boundedLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 50;
      return (db.prepare("SELECT * FROM runs WHERE ownerHash = ? ORDER BY createdAt DESC, runId DESC LIMIT ?")
        .all(ownerHash, boundedLimit) as RunRow[]).map(toRecord);
    },
    deleteOwned(runId: string, ownerHash: string): boolean {
      return transaction(() => {
        const current = read(runId);
        if (!current || current.ownerHash !== ownerHash || !isTerminalStatus(current.status)) return false;
        db.prepare(`UPDATE shares SET revokedAt = COALESCE(revokedAt, ?), projection = '{}'
          WHERE runId = ? OR resultId IN (SELECT resultId FROM run_results WHERE runId = ?)`)
          .run(Date.now(), runId, runId);
        // All run-private tables have ON DELETE CASCADE; conversation and descendant runs remain intact.
        db.prepare("DELETE FROM runs WHERE runId = ?").run(runId);
        return true;
      });
    },
    setStatus(runId: string, status: RunStatus, now = Date.now()): boolean {
      return transaction(() => {
        const current = read(runId);
        if (!current || isTerminalStatus(current.status)) return false;
        const committed = commitInside(runId, { status, events: [{ type: "run_state", status, revision: current.revision }] }, now);
        return committed.events.length > 0;
      });
    },
    saveSnapshot(runId: string, snapshot: InvestigationSnapshotV1, now = Date.now()): number {
      return transaction(() => commitInside(runId, { snapshot, events: [] }, now).run.revision);
    },
    appendActivities(runId: string, activities: readonly PublicActivity[], now = Date.now()): number {
      return transaction(() => {
        const current = read(runId);
        if (!current) throw new Error(`run not found: ${runId}`);
        if (isTerminalStatus(current.status)) return 0;
        let written = 0;
        let maxSeq = current.lastSeq;
        const insert = db.prepare("INSERT OR IGNORE INTO run_activities (runId, seq, activityId, payload) VALUES (?, ?, ?, ?)");
        for (const activity of activities) {
          if (insert.run(runId, activity.seq, activity.id, json(activity)).changes > 0) written += 1;
          maxSeq = Math.max(maxSeq, activity.seq);
        }
        if (written) db.prepare("UPDATE runs SET lastSeq = ?, updatedAt = ? WHERE runId = ?").run(maxSeq, now, runId);
        return written;
      });
    },
    listActivities(runId: string, afterSeq = 0): PublicActivity[] {
      const rows = db.prepare("SELECT payload FROM run_activities WHERE runId = ? AND seq > ? ORDER BY seq ASC").all(runId, afterSeq) as Array<{ payload: string }>;
      const activities: PublicActivity[] = [];
      for (const row of rows) {
        try { activities.push(JSON.parse(row.payload) as PublicActivity); } catch { /* Preserve legacy corrupt-row behavior. */ }
      }
      return activities;
    },
    markInterruptedOnBoot(now = Date.now()): number {
      return transaction(() => {
        // No attempt from the previous process can still be running. Keep its captured input/output.
        db.prepare(`UPDATE run_attempts SET status = 'failed', finishedAt = ?,
          error = CASE WHEN error IS NULL OR error = '' THEN 'process-restarted'
            ELSE error || char(10) || 'process-restarted' END WHERE status = 'running'`).run(now);
        const rows = db.prepare("SELECT * FROM runs WHERE status NOT IN ('completed', 'interrupted', 'cancelled')").all() as RunRow[];
        for (const row of rows) {
          const current = toRecord(row);
          const snapshot = current.snapshot ? { ...current.snapshot, phase: "interrupted" as const } : undefined;
          commitInside(current.runId, {
            status: "interrupted", ...(snapshot ? { snapshot, publication: "partial" as const } : {}),
            events: [
              ...(snapshot ? [{ type: "investigation_snapshot", investigation: snapshot }] : []),
              { type: "run_state", status: "interrupted", terminal: true, revision: current.revision + (snapshot ? 1 : 0), reason: "process-restarted" },
            ],
          }, now);
        }
        return rows.length;
      });
    },
  };
}

export function openRunStore(): RunStore | null {
  const db = openDatabase();
  return db ? createRunStore(db) : null;
}
