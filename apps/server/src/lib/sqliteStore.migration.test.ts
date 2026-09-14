/**
 * runs 表迁移验收（契约 docs/evals/2026-09-12-followup-observation.md Change 4）：
 * 新增 priorCaseId / isFollowUp 两列；迁移幂等（重复启动不炸），老行保持 NULL / 0。
 *
 * 3 号迁移（证据库 knowledge_entries，契约 docs/evals/2026-09-12-evidence-base.md）
 * 落地后，这里的版本号断言跟到 [1, 2, 3]：迁移只增不改。
 *
 * 用真库文件跑，不打桩：先手工造一个 v1 时代的库，再用生产迁移打开它。
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "./sqliteStore.js";
import { createRunStore } from "./runStore.js";

const previousDbFile = process.env.RHG_DB_FILE;
let dbPath = "";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "rhg-migrate-"));
  dbPath = join(dir, "rhg.sqlite");
  process.env.DATA_DIR = dir;
  process.env.RHG_DB_FILE = dbPath;
  closeDatabase();
});

afterAll(() => {
  closeDatabase();
  if (previousDbFile === undefined) delete process.env.RHG_DB_FILE;
  else process.env.RHG_DB_FILE = previousDbFile;
});

function columnNames(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: unknown }>).map((row) => String(row.name));
}

function schemaVersionRows(db: DatabaseSync): Array<{ version: number }> {
  return db.prepare("SELECT version FROM schema_version ORDER BY version").all() as Array<{ version: number }>;
}

/** 造一个 v1 时代的库：只有 1 号迁移，runs 表没有追问那两列。 */
function writeLegacyDatabase(path: string, legacyRunId = "legacy-run") {
  const require_ = createRequire(import.meta.url);
  const { DatabaseSync: Driver } = require_("node:sqlite") as {
    DatabaseSync: new (file: string) => DatabaseSync;
  };
  const db = new Driver(path);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL);
    INSERT INTO schema_version (version, appliedAt) VALUES (1, '2026-09-11T00:00:00.000Z');
    CREATE TABLE runs (
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
    CREATE TABLE run_activities (
      runId TEXT NOT NULL REFERENCES runs(runId) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      activityId TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (runId, seq)
    );
  `);
  db.prepare(
    "INSERT INTO runs (runId, caseId, status, createdAt, updatedAt) VALUES (?, ?, 'completed', 1, 1)"
  ).run(legacyRunId, "case-legacy");
  db.close();
}

describe("runs 表追问两列迁移", () => {
  it("新库建好就有两列，新行默认 NULL / 0", () => {
    const db = openDatabase(dbPath)!;
    expect(db).not.toBeNull();
    expect(columnNames(db)).toEqual(expect.arrayContaining(["priorCaseId", "isFollowUp"]));
    expect(schemaVersionRows(db).map((row) => row.version)).toEqual([1, 2, 3]);

    const runs = createRunStore(db);
    const created = runs.create({ runId: "run-new", caseId: "case-new", ownerHash: "owner-a" });
    expect(created.priorCaseId).toBeNull();
    expect(created.isFollowUp).toBe(false);
    const row = db.prepare("SELECT priorCaseId, isFollowUp FROM runs WHERE runId = ?").get("run-new") as {
      priorCaseId: string | null;
      isFollowUp: number;
    };
    expect(row.priorCaseId).toBeNull();
    expect(row.isFollowUp).toBe(0);
  });

  it("老库补列：老行保持 NULL / 0，追问行写得进、读得出", () => {
    writeLegacyDatabase(dbPath);
    const db = openDatabase(dbPath)!;
    expect(schemaVersionRows(db).map((row) => row.version)).toEqual([1, 2, 3]);
    expect(columnNames(db)).toEqual(expect.arrayContaining(["priorCaseId", "isFollowUp"]));

    const runs = createRunStore(db);
    const legacy = runs.get("legacy-run")!;
    expect(legacy.status).toBe("completed");
    expect(legacy.priorCaseId).toBeNull();
    expect(legacy.isFollowUp).toBe(false);

    expect(runs.markFollowUp("legacy-run", "case-prior", 1_760_000_000_000)).toBe(true);
    const after = runs.get("legacy-run")!;
    expect(after.priorCaseId).toBe("case-prior");
    expect(after.isFollowUp).toBe(true);
    // 幂等：同一个值再写一遍无副作用
    expect(runs.markFollowUp("legacy-run", "case-prior")).toBe(true);
    expect(runs.get("legacy-run")!.priorCaseId).toBe("case-prior");
    // run 不存在时不写、返回 false
    expect(runs.markFollowUp("run-missing", "case-prior")).toBe(false);
  });

  it("重复启动不炸：关掉再打开，列还在、版本不重复、老行不动", () => {
    const first = openDatabase(dbPath)!;
    createRunStore(first).create({ runId: "run-a", caseId: "case-a", ownerHash: "owner-a" });
    closeDatabase();

    const second = openDatabase(dbPath)!;
    expect(columnNames(second)).toEqual(expect.arrayContaining(["priorCaseId", "isFollowUp"]));
    expect(schemaVersionRows(second).map((row) => row.version)).toEqual([1, 2, 3]);
    const row = second.prepare("SELECT priorCaseId, isFollowUp FROM runs WHERE runId = ?").get("run-a") as {
      priorCaseId: string | null;
      isFollowUp: number;
    };
    expect(row.priorCaseId).toBeNull();
    expect(row.isFollowUp).toBe(0);
  });

  it("版本号记录缺失：DDL 已跑过但版本行缺，重跑补上、不重复建/加列", () => {
    const db = openDatabase(dbPath)!;
    // 2 号（加列）与 3 号（证据库建表）的 DDL 都已生效，只丢版本行。
    db.exec("DELETE FROM schema_version WHERE version >= 2");
    closeDatabase();

    const reopened = openDatabase(dbPath)!;
    expect(columnNames(reopened)).toEqual(expect.arrayContaining(["priorCaseId", "isFollowUp"]));
    expect(schemaVersionRows(reopened).map((row) => row.version)).toEqual([1, 2, 3]);
    const v2 = reopened
      .prepare("SELECT COUNT(*) AS n FROM schema_version WHERE version = 2")
      .get() as { n: number };
    const v3 = reopened
      .prepare("SELECT COUNT(*) AS n FROM schema_version WHERE version = 3")
      .get() as { n: number };
    expect(v2.n).toBe(1);
    expect(v3.n).toBe(1);
    // 3 号迁移重跑：knowledge_entries 还在，且没有被重复创建
    expect(
      reopened.prepare("SELECT COUNT(*) AS n FROM knowledge_entries").get()
    ).toEqual({ n: 0 });
  });
});
