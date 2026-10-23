/**
 * sqliteStore — 本地 SQLite 适配层。
 *
 * 单机单进程部署不引入 Redis / 消息队列：一个本地库文件，驱动藏在 repository 接口后面。
 * 用 Node 22 自带的 `node:sqlite`，不装第三方依赖；调查与分享要求持久化可用，否则拒绝启动。
 */
import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 驱动运行时才 require：`node:sqlite` 是 Node 内置模块，打包器静态解析它会直接报
 * 「Cannot bundle Node.js built-in」。放到函数里就绕开了。
 * 拿不到驱动返回 null，由调用方明确拒绝不具备持久化能力的请求。
 */
function loadDriver(): (new (path: string) => DatabaseSync) | null {
  try {
    const require_ = createRequire(import.meta.url);
    const mod = require_("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSync };
    return mod.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

let instance: DatabaseSync | null = null;

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), ".data");
}

function defaultDatabasePath(): string {
  return process.env.RHG_DB_FILE || join(dataDir(), "rhg.sqlite");
}

/**
 * 打开（或复用）库并建表。建表是幂等的：每次启动都跑一遍。
 * 返回 null 表示存储不可用；调查与分享调用方必须拒绝启动。
 */
export function openDatabase(): DatabaseSync | null {
  if (instance) return instance;
  const filePath = defaultDatabasePath();
  const Driver = loadDriver();
  if (!Driver) {
    console.warn("[sqlite] 这个 Node 没有 node:sqlite，持久化存储不可用");
    return null;
  }
  let db: DatabaseSync;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    db = new Driver(filePath);
  } catch (error) {
    console.error("[sqlite] 打不开库，持久化存储不可用", error);
    return null;
  }
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  instance = db;
  return db;
}

/** 表结构与迁移版本；只增不改，改结构先加一条新迁移。 */
function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);
  const current = Number(
    (db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version").get() as { v: number } | undefined)?.v ?? 0
  );
  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        caseId TEXT PRIMARY KEY,
        claim TEXT NOT NULL,
        report TEXT NOT NULL,
        claimReview TEXT NOT NULL,
        credibilityScore REAL NOT NULL DEFAULT 0,
        createdAt INTEGER,
        createdAtUnknown INTEGER NOT NULL DEFAULT 0,
        ownerHash TEXT,
        feedback TEXT NOT NULL DEFAULT '[]',
        migratedFrom TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cases_owner_created ON cases(ownerHash, createdAt DESC);

      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        ownerHash TEXT,
        clientRequestId TEXT,
        inputHash TEXT,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        snapshot TEXT,
        activities TEXT NOT NULL DEFAULT '[]',
        lastSeq INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(ownerHash, clientRequestId)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_case ON runs(caseId);

      CREATE TABLE IF NOT EXISTS shares (
        shareId TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        projection TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        revokedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_shares_case ON shares(caseId);

      CREATE TABLE IF NOT EXISTS run_activities (
        runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        activityId TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (runId, seq)
      );
    `);
    db.prepare("INSERT INTO schema_version (version, appliedAt) VALUES (1, ?)").run(new Date().toISOString());
  }
  if (current < 2) {
    // runs 补两列（追问观测）：老库用 ALTER 加，老行保持 NULL / 0。
    // 先查列在不在再改：版本号写入与 ALTER 之间崩过时，重跑不能炸。
    const columns = new Set(
      (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: unknown }>).map((row) => String(row.name))
    );
    if (!columns.has("priorCaseId")) db.exec("ALTER TABLE runs ADD COLUMN priorCaseId TEXT");
    if (!columns.has("isFollowUp")) db.exec("ALTER TABLE runs ADD COLUMN isFollowUp INTEGER NOT NULL DEFAULT 0");
    db.prepare("INSERT OR IGNORE INTO schema_version (version, appliedAt) VALUES (2, ?)").run(
      new Date().toISOString()
    );
  }
  if (current < 3) {
    // 版本 3 曾建 knowledge_entries（证据库）。证据库已停用：新库不再建这张表，
    // 老库里已有的表与数据原样留着、不再读写。版本号照常记 3，下一条迁移从 4 开始。
    db.prepare("INSERT OR IGNORE INTO schema_version (version, appliedAt) VALUES (3, ?)").run(
      new Date().toISOString()
    );
  }
  if (current < 4) {
    // 分享改成按一轮调查（run）建，不再按登录用户的 case 建。老分享行的 runId 保持 NULL。
    const columns = new Set(
      (db.prepare("PRAGMA table_info(shares)").all() as Array<{ name?: unknown }>).map((row) => String(row.name))
    );
    if (!columns.has("runId")) db.exec("ALTER TABLE shares ADD COLUMN runId TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_shares_run ON shares(runId)");
    db.prepare("INSERT OR IGNORE INTO schema_version (version, appliedAt) VALUES (4, ?)").run(
      new Date().toISOString()
    );
  }
  if (current < 5) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((row) => row.name)
      );
      for (const [name, definition] of [
        ["conversationId", "TEXT"],
        ["parentRunId", "TEXT"],
        ["kind", "TEXT NOT NULL DEFAULT 'initial'"],
        ["lastEventSeq", "INTEGER NOT NULL DEFAULT 0"],
        ["resultId", "TEXT"],
      ]) {
        if (!columns.has(name!)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
      }
      const shareColumns = new Set(
        (db.prepare("PRAGMA table_info(shares)").all() as Array<{ name: string }>).map((row) => row.name)
      );
      if (!shareColumns.has("resultId")) db.exec("ALTER TABLE shares ADD COLUMN resultId TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          conversationId TEXT PRIMARY KEY,
          ownerHash TEXT,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_inputs (
          runId TEXT PRIMARY KEY REFERENCES runs(runId) ON DELETE CASCADE,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_events (
          runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
          eventSeq INTEGER NOT NULL,
          payload TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          PRIMARY KEY (runId, eventSeq)
        );
        CREATE TABLE IF NOT EXISTS run_results (
          resultId TEXT PRIMARY KEY,
          runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('partial', 'final')),
          snapshot TEXT NOT NULL,
          report TEXT,
          createdAt INTEGER NOT NULL,
          UNIQUE (runId, revision)
        );
        CREATE TABLE IF NOT EXISTS run_materials (
          materialId TEXT PRIMARY KEY,
          runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
          url TEXT, kind TEXT, content TEXT, contentHash TEXT, metadata TEXT,
          createdAt INTEGER
        );
        CREATE TABLE IF NOT EXISTS run_attempts (
          attemptId TEXT PRIMARY KEY,
          runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
          stage TEXT, provider TEXT, model TEXT, status TEXT,
          input TEXT, output TEXT, error TEXT,
          startedAt INTEGER, finishedAt INTEGER, metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_owner_created ON runs(ownerHash, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversationId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_materials_run ON run_materials(runId);
        CREATE INDEX IF NOT EXISTS idx_attempts_run ON run_attempts(runId);
        CREATE INDEX IF NOT EXISTS idx_shares_result ON shares(resultId);
        UPDATE runs SET kind = 'follow-up' WHERE isFollowUp = 1;
      `);
      db.prepare("INSERT INTO schema_version (version, appliedAt) VALUES (5, ?)").run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  if (current < 6) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS runtime_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        token TEXT NOT NULL,
        claimedAt INTEGER NOT NULL
      )`);
      db.prepare("INSERT INTO schema_version (version, appliedAt) VALUES (6, ?)").run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

}

