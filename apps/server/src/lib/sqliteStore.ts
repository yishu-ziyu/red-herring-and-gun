/**
 * sqliteStore — 本地 SQLite 适配层（IMPLEMENTATION_PLAN §5.4）。
 *
 * 单机单进程部署不引入 Redis / 消息队列：一个本地库文件，驱动藏在 repository 接口后面。
 * 用 Node 22 自带的 `node:sqlite`，不装第三方依赖；不可用时调用方回退到旧的 JSON 实现。
 */
import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * 驱动运行时才 require：`node:sqlite` 是 Node 内置模块，前端测试环境（jsdom）
 * 静态解析它会直接报「Cannot bundle Node.js built-in」。放到函数里就绕开了。
 * 同时这也是降级点：拿不到驱动就返回 null，调用方回退到 JSON 存储。
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
let instancePath = "";

export function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), ".data");
}

export function defaultDatabasePath(): string {
  return process.env.RHG_DB_FILE || join(dataDir(), "rhg.sqlite");
}

/**
 * 打开（或复用）库并建表。建表是幂等的：每次启动都跑一遍。
 * 返回 null 表示这个 Node 没有可用的 sqlite，调用方必须回退，不得静默丢数据。
 */
export function openDatabase(filePath: string = defaultDatabasePath()): DatabaseSync | null {
  if (instance && instancePath === filePath) return instance;
  const Driver = loadDriver();
  if (!Driver) {
    console.warn("[sqlite] 这个 Node 没有 node:sqlite，回退到 JSON 存储");
    return null;
  }
  let db: DatabaseSync;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    db = new Driver(filePath);
  } catch (error) {
    console.error("[sqlite] 打不开库，回退到 JSON 存储", error);
    return null;
  }
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  instance = db;
  instancePath = filePath;
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
    // 证据库（契约 docs/evals/2026-09-12-evidence-base.md）：调查 finalize 后沉淀的
    // 命题级核查知识。atomNorm 是规范化命题文本，唯一索引决定「同一命题只一条」；
    // 时间列与 cases / runs 一致用 epoch ms。CREATE TABLE/INDEX IF NOT EXISTS 幂等，
    // 版本号用 INSERT OR IGNORE：崩在中间重跑不会炸、也不会重复建。
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        atomNorm TEXT NOT NULL,
        atomText TEXT NOT NULL,
        verdict TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        sourceRunId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastVerifiedAt INTEGER NOT NULL,
        hitCount INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_atom_norm ON knowledge_entries(atomNorm);
    `);
    db.prepare("INSERT OR IGNORE INTO schema_version (version, appliedAt) VALUES (3, ?)").run(
      new Date().toISOString()
    );
  }
}

/** 测试/维护用：关掉当前实例，下次 openDatabase 重新打开。 */
export function closeDatabase(): void {
  try {
    instance?.close();
  } catch {
    /* 已关闭 */
  }
  instance = null;
  instancePath = "";
}

export function isSqliteAvailable(): boolean {
  const Driver = loadDriver();
  if (!Driver) return false;
  try {
    const db = new Driver(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}
