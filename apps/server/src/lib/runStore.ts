/**
 * runStore — 运行记录、活动与分享令牌的持久化（IMPLEMENTATION_PLAN §5.4）。
 *
 * 与 caseStore 分开：caseStore 管「查到过什么」，这里管「一次调查跑到哪了」。
 * 存储介质由 sqliteStore 提供；没有可用 sqlite 时本模块不可用，调用方回退到进程内状态。
 *
 * 不变量：
 *   - runs 行必须先存在，才允许写活动（外键不是可选装饰）。
 *   - 同一 runId 的 activities 是追加序列，seq 单调；重复 seq 视为重放，不覆盖。
 *   - 终态不可逆：completed / interrupted / cancelled 之后不再接受状态推进。
 */
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqliteStore.js";
import type { InvestigationSnapshotV1, PublicActivity } from "./investigation/index.js";

export const RUN_STATUSES = [
  "accepted",
  "extracting",
  "investigating",
  "judging",
  "completed",
  "cancelling",
  "cancelled",
  "interrupted",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "interrupted", "cancelled"]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export type RunRecord = {
  runId: string;
  caseId: string;
  ownerHash: string | null;
  clientRequestId: string | null;
  inputHash: string | null;
  status: RunStatus;
  revision: number;
  snapshot: InvestigationSnapshotV1 | null;
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
};

type RunRow = {
  runId: string;
  caseId: string;
  ownerHash: string | null;
  clientRequestId: string | null;
  inputHash: string | null;
  status: string;
  revision: number;
  snapshot: string | null;
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
};

function toRecord(row: RunRow): RunRecord {
  let snapshot: InvestigationSnapshotV1 | null = null;
  if (row.snapshot) {
    try {
      snapshot = JSON.parse(row.snapshot) as InvestigationSnapshotV1;
    } catch {
      snapshot = null;
    }
  }
  return {
    runId: row.runId,
    caseId: row.caseId,
    ownerHash: row.ownerHash,
    clientRequestId: row.clientRequestId,
    inputHash: row.inputHash,
    status: row.status as RunStatus,
    revision: row.revision,
    snapshot,
    lastSeq: row.lastSeq,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CreateRunInput = {
  runId: string;
  caseId: string;
  ownerHash?: string | null;
  clientRequestId?: string | null;
  inputHash?: string | null;
  status?: RunStatus;
  now?: number;
};

export type RunStore = ReturnType<typeof createRunStore>;

export function createRunStore(db: DatabaseSync) {
  const insertRun = db.prepare(
    `INSERT INTO runs (runId, caseId, ownerHash, clientRequestId, inputHash, status, revision, snapshot, activities, lastSeq, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '[]', 0, ?, ?)`
  );
  const selectRun = db.prepare("SELECT * FROM runs WHERE runId = ?");
  const selectByIdempotency = db.prepare(
    "SELECT * FROM runs WHERE ownerHash IS ? AND clientRequestId = ? ORDER BY createdAt ASC LIMIT 1"
  );
  const selectActivities = db.prepare("SELECT payload FROM run_activities WHERE runId = ? ORDER BY seq ASC");
  const insertActivity = db.prepare(
    "INSERT OR IGNORE INTO run_activities (runId, seq, activityId, payload) VALUES (?, ?, ?, ?)"
  );

  return {
    /** 建 run；`ownerHash + clientRequestId` 重复时抛 UNIQUE 约束错，由调用方判冲突。 */
    create(input: CreateRunInput): RunRecord {
      const now = input.now ?? Date.now();
      insertRun.run(
        input.runId,
        input.caseId,
        input.ownerHash ?? null,
        input.clientRequestId ?? null,
        input.inputHash ?? null,
        input.status ?? "accepted",
        now,
        now
      );
      return toRecord(selectRun.get(input.runId) as RunRow);
    },

    get(runId: string): RunRecord | null {
      const row = selectRun.get(runId) as RunRow | undefined;
      return row ? toRecord(row) : null;
    },

    /** 幂等查找：同一身份 + 同一 clientRequestId 的既有 run。 */
    findByIdempotencyKey(ownerHash: string | null, clientRequestId: string): RunRecord | null {
      const row = selectByIdempotency.get(ownerHash, clientRequestId) as RunRow | undefined;
      return row ? toRecord(row) : null;
    },

    /** 终态不可逆：已经是终态就不再改状态，返回是否真的改了。 */
    setStatus(runId: string, status: RunStatus, now = Date.now()): boolean {
      const current = this.get(runId);
      if (!current || isTerminalStatus(current.status)) return false;
      db.prepare("UPDATE runs SET status = ?, updatedAt = ? WHERE runId = ?").run(status, now, runId);
      return true;
    },

    /** 落快照并推进 revision；活动引用的是这次 revision。 */
    saveSnapshot(runId: string, snapshot: InvestigationSnapshotV1, now = Date.now()): number {
      const row = selectRun.get(runId) as RunRow | undefined;
      if (!row) throw new Error(`run not found: ${runId}`);
      const revision = row.revision + 1;
      db.prepare("UPDATE runs SET snapshot = ?, revision = ?, updatedAt = ? WHERE runId = ?").run(
        JSON.stringify(snapshot),
        revision,
        now,
        runId
      );
      return revision;
    },

    /** 追加活动；重复 seq 不覆盖（重放安全）。返回真正写入的条数。 */
    appendActivities(runId: string, activities: readonly PublicActivity[], now = Date.now()): number {
      const row = selectRun.get(runId) as RunRow | undefined;
      if (!row) throw new Error(`run not found: ${runId}`);
      let written = 0;
      let maxSeq = row.lastSeq;
      for (const activity of activities) {
        const result = insertActivity.run(runId, activity.seq, activity.id, JSON.stringify(activity));
        if (result.changes > 0) written += 1;
        maxSeq = Math.max(maxSeq, activity.seq);
      }
      if (written > 0) {
        db.prepare("UPDATE runs SET lastSeq = ?, updatedAt = ? WHERE runId = ?").run(maxSeq, now, runId);
      }
      return written;
    },

    listActivities(runId: string, afterSeq = 0): PublicActivity[] {
      const rows = selectActivities.all(runId) as Array<{ payload: string }>;
      const out: PublicActivity[] = [];
      for (const row of rows) {
        try {
          const activity = JSON.parse(row.payload) as PublicActivity;
          if (activity.seq > afterSeq) out.push(activity);
        } catch {
          /* 坏行跳过，不让一条坏数据毁掉整段重放 */
        }
      }
      return out;
    },

    /** 进程重启：把没跑完的 run 标成 interrupted，中间快照保留。 */
    markInterruptedOnBoot(now = Date.now()): number {
      const result = db
        .prepare(
          `UPDATE runs SET status = 'interrupted', updatedAt = ?
           WHERE status NOT IN ('completed', 'interrupted', 'cancelled')`
        )
        .run(now);
      return Number(result.changes ?? 0);
    },

    /** 按 caseId 找最近一次 run（刷新恢复用）。 */
    latestForCase(caseId: string): RunRecord | null {
      const row = db
        .prepare("SELECT * FROM runs WHERE caseId = ? ORDER BY createdAt DESC LIMIT 1")
        .get(caseId) as RunRow | undefined;
      return row ? toRecord(row) : null;
    },
  };
}

/** 打开默认库并返回 runStore；没有可用 sqlite 时返回 null（调用方回退）。 */
export function openRunStore(): RunStore | null {
  const db = openDatabase();
  if (!db) return null;
  return createRunStore(db);
}
