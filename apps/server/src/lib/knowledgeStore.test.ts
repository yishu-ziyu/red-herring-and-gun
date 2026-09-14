/**
 * knowledgeStore（Part 1 · 数据层）：迁移幂等、upsert、隐私、观测、记忆端口。
 * 契约 docs/evals/2026-09-12-evidence-base.md。
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "./sqliteStore.js";
import { normalizeKnowledgeAtom } from "./knowledgeMatch.js";
import {
  appendKnowledgeObservation,
  clearKnowledgeEntries,
  createKnowledgeMemory,
  knowledgeObservationPath,
  knowledgeVerdictOf,
  listKnowledgeEntries,
  upsertKnowledgeEntry,
  __resetKnowledgeStoreForTests,
  type KnowledgeObservation,
} from "./knowledgeStore.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-13T00:00:00.000Z");

const ATOM = "隔夜菜的亚硝酸盐含量会超标";
const EVIDENCE = [
  { url: "https://news.example/nitrite", title: "冷藏与亚硝酸盐", snippet: "24 小时内远低于限值", stance: "support" as const },
];
const USER_CLAIM = "隔夜菜亚硝酸盐超标，吃了会中毒。";

let dir = "";
const previousDbFile = process.env.RHG_DB_FILE;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhg-knowledge-"));
  process.env.DATA_DIR = dir;
  process.env.RHG_DB_FILE = join(dir, "rhg.sqlite");
  closeDatabase();
  __resetKnowledgeStoreForTests();
});

afterEach(() => {
  closeDatabase();
  __resetKnowledgeStoreForTests();
  rmSync(dir, { recursive: true, force: true });
  if (previousDbFile === undefined) delete process.env.RHG_DB_FILE;
  else process.env.RHG_DB_FILE = previousDbFile;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

function schemaVersions(db: DatabaseSync): number[] {
  return (db.prepare("SELECT version FROM schema_version ORDER BY version").all() as Array<{ version: number }>).map(
    (row) => row.version
  );
}

function rawDb(path: string): DatabaseSync {
  const require_ = createRequire(import.meta.url);
  const { DatabaseSync: Driver } = require_("node:sqlite") as {
    DatabaseSync: new (file: string) => DatabaseSync;
  };
  return new Driver(path);
}

describe("knowledge_entries 迁移", () => {
  it("新库建表 + 唯一索引；版本号 1/2/3 各一条", () => {
    const db = openDatabase(process.env.RHG_DB_FILE!)!;
    expect(schemaVersions(db)).toEqual([1, 2, 3]);
    const columns = (db.prepare("PRAGMA table_info(knowledge_entries)").all() as Array<{ name?: unknown }>).map(
      (row) => String(row.name)
    );
    expect(columns).toEqual([
      "id",
      "atomNorm",
      "atomText",
      "verdict",
      "evidence",
      "sourceRunId",
      "createdAt",
      "lastVerifiedAt",
      "hitCount",
    ]);
    const indexes = (db.prepare("PRAGMA index_list(knowledge_entries)").all() as Array<{ name?: unknown; unique?: unknown }>);
    expect(indexes.some((row) => row.unique === 1)).toBe(true);
  });

  it("迁移幂等：关掉再打开不炸、不重复、已存条目还在", () => {
    const first = openDatabase(process.env.RHG_DB_FILE!)!;
    upsertKnowledgeEntry({ atomText: ATOM, verdict: "false", evidence: EVIDENCE, sourceRunId: "run-1", now: NOW });
    closeDatabase();
    __resetKnowledgeStoreForTests();

    const second = openDatabase(process.env.RHG_DB_FILE!)!;
    expect(schemaVersions(second)).toEqual([1, 2, 3]);
    expect(listKnowledgeEntries()).toHaveLength(1);

    // 再关再开一次（模拟第三次启动）仍不重复
    closeDatabase();
    __resetKnowledgeStoreForTests();
    const third = openDatabase(process.env.RHG_DB_FILE!)!;
    expect(schemaVersions(third)).toEqual([1, 2, 3]);
    expect(third.prepare("SELECT COUNT(*) AS n FROM knowledge_entries").get()).toEqual({ n: 1 });
  });

  it("崩在建表与版本号之间：表在版本缺（或表没建成）→ 重跑补上、不重复", () => {
    const db = openDatabase(process.env.RHG_DB_FILE!)!;
    db.exec("DROP TABLE knowledge_entries");
    db.exec("DELETE FROM schema_version WHERE version = 3");
    closeDatabase();
    __resetKnowledgeStoreForTests();

    const reopened = openDatabase(process.env.RHG_DB_FILE!)!;
    expect(schemaVersions(reopened)).toEqual([1, 2, 3]);
    expect(listKnowledgeEntries()).toEqual([]);
  });

  it("老库（只有 1 号迁移的 runs 表）打开后补出 2 号与 3 号迁移", () => {
    const legacy = rawDb(process.env.RHG_DB_FILE!);
    legacy.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL);
      INSERT INTO schema_version (version, appliedAt) VALUES (1, '2026-09-11T00:00:00.000Z');
      CREATE TABLE runs (runId TEXT PRIMARY KEY);
    `);
    legacy.close();

    const db = openDatabase(process.env.RHG_DB_FILE!)!;
    expect(schemaVersions(db)).toEqual([1, 2, 3]);
    expect(listKnowledgeEntries()).toEqual([]);
  });
});

describe("upsertKnowledgeEntry", () => {
  it("同 atomNorm 冲突只更新 verdict / evidence / lastVerifiedAt，保留首次沉淀的身份", () => {
    const first = upsertKnowledgeEntry({
      atomText: `${ATOM}。`,
      verdict: "true",
      evidence: EVIDENCE,
      sourceRunId: "run-1",
      now: NOW,
      id: "fixed-id",
    })!;
    expect(first.id).toBe("fixed-id");
    expect(first.atomNorm).toBe(normalizeKnowledgeAtom(ATOM));
    expect(first.createdAt).toBe(NOW);

    const second = upsertKnowledgeEntry({
      atomText: ATOM,
      verdict: "false",
      evidence: [
        { url: "https://gov.example/notice", title: "通报", snippet: "超标说法不成立", stance: "contradict" },
      ],
      sourceRunId: "run-2",
      now: NOW + 5 * DAY,
    })!;
    expect(second.id).toBe("fixed-id");
    expect(second.createdAt).toBe(NOW);
    expect(second.sourceRunId).toBe("run-1");
    expect(second.verdict).toBe("false");
    expect(second.lastVerifiedAt).toBe(NOW + 5 * DAY);
    expect(second.evidence.map((item) => item.url)).toEqual(["https://gov.example/notice"]);

    const rows = listKnowledgeEntries();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("false");
  });

  it("判词 unverified / 未知不沉淀；partial / exaggerated 存成 mixed_misleading", () => {
    expect(knowledgeVerdictOf("unverified")).toBeNull();
    expect(knowledgeVerdictOf("")).toBeNull();
    expect(knowledgeVerdictOf("partial")).toBe("mixed_misleading");
    expect(knowledgeVerdictOf("exaggerated")).toBe("mixed_misleading");
    expect(knowledgeVerdictOf("mixed_misleading")).toBe("mixed_misleading");

    expect(upsertKnowledgeEntry({ atomText: ATOM, verdict: "unverified", evidence: EVIDENCE, sourceRunId: "r" })).toBeNull();
    const partial = upsertKnowledgeEntry({
      atomText: ATOM,
      verdict: "partial",
      evidence: EVIDENCE,
      sourceRunId: "r",
    })!;
    expect(partial.verdict).toBe("mixed_misleading");
  });

  it("没有真实 http(s) 来源不沉淀（没证据不出结论）", () => {
    expect(
      upsertKnowledgeEntry({ atomText: ATOM, verdict: "true", evidence: [], sourceRunId: "r" })
    ).toBeNull();
    expect(
      upsertKnowledgeEntry({
        atomText: ATOM,
        verdict: "true",
        evidence: [{ url: "not-a-url", title: "t", snippet: "s", stance: "support" }],
        sourceRunId: "r",
      })
    ).toBeNull();
  });

  it("空命题不沉淀", () => {
    expect(upsertKnowledgeEntry({ atomText: "   。", verdict: "true", evidence: EVIDENCE, sourceRunId: "r" })).toBeNull();
  });
});

describe("隐私：不写用户原句全文、不写用户名", () => {
  it("整句等于原句的 atom 不进表、不进观测", () => {
    const observations: KnowledgeObservation[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => observations.push(rec),
    });
    // 单 atom 兜底路径：atom 就是原句
    expect(memory.lookup(USER_CLAIM)).toBeNull();
    memory.settle({
      claim: USER_CLAIM,
      verdicts: [{ claimAtom: USER_CLAIM, verdict: "true", supportingSources: EVIDENCE }],
    });
    expect(listKnowledgeEntries()).toEqual([]);
    expect(observations).toEqual([]);
  });

  it("表内与 JSONL 只有命题级文本，没有原句全文、没有用户名/账号", () => {
    const memory = createKnowledgeMemory({ runId: "run-1", claim: USER_CLAIM, now: () => NOW });
    memory.settle({
      claim: USER_CLAIM,
      verdicts: [{ claimAtom: ATOM, verdict: "true", supportingSources: [{ ...EVIDENCE[0], url: "https://news.example/a" }] }],
    });
    // 一次未命中也会落一行观测（JSONL 也要过隐私抽查）
    expect(memory.lookup("电动车失窃后被送往国外")).toBeNull();

    const db = openDatabase(process.env.RHG_DB_FILE!)!;
    const dump = JSON.stringify(db.prepare("SELECT * FROM knowledge_entries").all());
    expect(dump).toContain(ATOM);
    expect(dump).not.toContain(USER_CLAIM);
    expect(dump).not.toMatch(/ownerHash|email|account|weibo\.com\/u\//i);

    const jsonl = readFileSync(knowledgeObservationPath(dir), "utf8");
    expect(jsonl).toContain("电动车失窃后被送往国外");
    expect(jsonl).not.toContain(USER_CLAIM);
    expect(jsonl).not.toMatch(/ownerHash|email|account|weibo\.com\/u\//i);
  });
});

describe("观测（knowledge-observations.jsonl）", () => {
  it("每行的 outcome 与 atomNorm 逐字落盘，不写原句", () => {
    appendKnowledgeObservation({ runId: "run-9", atomNorm: ATOM, outcome: "hit", ts: "2026-09-13T00:00:00.000Z" });
    const lines = readFileSync(knowledgeObservationPath(dir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      ts: "2026-09-13T00:00:00.000Z",
      runId: "run-9",
      atomNorm: normalizeKnowledgeAtom(ATOM),
      outcome: "hit",
    });
  });

  it("runId / atomNorm 缺一不写（宁可明确失败也不写对不上号的记录）", () => {
    expect(() => appendKnowledgeObservation({ runId: "", atomNorm: ATOM, outcome: "hit" })).toThrow();
    expect(() => appendKnowledgeObservation({ runId: "run-1", atomNorm: " ", outcome: "hit" })).toThrow();
  });
});

describe("createKnowledgeMemory（记忆端口）", () => {
  function seed(over: { verdict?: string; lastVerifiedAt?: number } = {}) {
    return upsertKnowledgeEntry({
      atomText: ATOM,
      verdict: over.verdict ?? "false",
      evidence: EVIDENCE,
      sourceRunId: "run-seed",
      now: over.lastVerifiedAt ?? NOW - DAY,
    })!;
  }

  it("命中：lookup 给出注入材料与已核日期，markInjected 记 injected 并 hitCount+1", () => {
    const seeded = seed();
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    const injection = memory.lookup(ATOM);
    expect(injection?.originDate).toBe("2026-09-12");
    expect(injection?.priorVerdict).toBe("false");
    expect(injection?.evidence.map((e) => e.url)).toEqual(["https://news.example/nitrite"]);
    memory.markInjected(ATOM, injection!.originDate);
    expect(outcomes).toEqual(["hit", "injected", "reused_verdict"]);
    expect(listKnowledgeEntries()[0]!.hitCount).toBe(1);
    expect(listKnowledgeEntries()[0]!.id).toBe(seeded.id);
  });

  it("超龄：记 stale，不注入", () => {
    seed({ lastVerifiedAt: NOW - 40 * DAY });
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    expect(memory.lookup(ATOM)).toBeNull();
    expect(outcomes).toEqual(["stale"]);
  });

  it("判词 unverified：记 miss，不注入", () => {
    const db = openDatabase(process.env.RHG_DB_FILE!)!;
    // 直接写一行 unverified（生产 upsert 不会写，这里是读侧闸门的兜底验证）
    db.prepare(
      `INSERT INTO knowledge_entries (id, atomNorm, atomText, verdict, evidence, sourceRunId, createdAt, lastVerifiedAt, hitCount)
       VALUES (?, ?, ?, 'unverified', ?, 'run-x', ?, ?, 0)`
    ).run("raw-1", normalizeKnowledgeAtom(ATOM), ATOM, JSON.stringify(EVIDENCE), NOW - DAY, NOW - DAY);

    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    expect(memory.lookup(ATOM)).toBeNull();
    expect(outcomes).toEqual(["miss"]);
  });

  it("不命中：记 miss，零变化", () => {
    seed();
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    expect(memory.lookup("电动车失窃后被送往国外")).toBeNull();
    expect(outcomes).toEqual(["miss"]);
  });

  it("注入后最终判 unverified → conclude 记 downgraded", () => {
    seed();
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    const injection = memory.lookup(ATOM)!;
    memory.markInjected(ATOM, injection.originDate);
    memory.conclude([
      { claimAtom: ATOM, verdict: "unverified" },
      { claimAtom: "另一条命题", verdict: "true" },
    ]);
    expect(outcomes).toEqual(["hit", "injected", "reused_verdict", "downgraded"]);
  });

  it("注入后判词站得住 → 不记 downgraded", () => {
    seed();
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    const injection = memory.lookup(ATOM)!;
    memory.markInjected(ATOM, injection.originDate);
    memory.conclude([{ claimAtom: ATOM, verdict: "false" }]);
    expect(outcomes).toEqual(["hit", "injected", "reused_verdict"]);
  });

  it("注入过的近似命题不再沉淀成新行，观测记 deduped", () => {
    seed();
    const outcomes: string[] = [];
    const memory = createKnowledgeMemory({
      runId: "run-2",
      claim: "隔夜菜里的亚硝酸盐是否超标？",
      now: () => NOW,
      observe: (rec) => outcomes.push(rec.outcome),
    });
    const variant = "隔夜菜里的亚硝酸盐含量超过了标准";
    const injection = memory.lookup(variant);
    expect(injection?.priorVerdict).toBe("false");
    memory.markInjected(variant, injection!.originDate);
    memory.settle({
      claim: "隔夜菜里的亚硝酸盐是否超标？",
      verdicts: [
        {
          claimAtom: variant,
          verdict: "false",
          supportingSources: [{ url: "https://news.example/nitrite", title: "冷藏与亚硝酸盐", snippet: "24 小时内远低于限值" }],
        },
      ],
    });
    expect(listKnowledgeEntries()).toHaveLength(1);
    expect(listKnowledgeEntries()[0]!.atomText).toBe(ATOM);
    expect(outcomes).toContain("deduped");
    expect(outcomes).toContain("reused_verdict");
  });

  it("settle：可核查且判词非 unverified 的 atom 沉淀；下一条近似命题可命中", () => {
    const memory = createKnowledgeMemory({ runId: "run-1", claim: USER_CLAIM, now: () => NOW });
    memory.settle({
      claim: USER_CLAIM,
      verdicts: [
        {
          claimAtom: ATOM,
          verdict: "false",
          supportingSources: [{ url: "https://gov.example/a", title: "通报", snippet: "辟谣" }],
          contradictingSources: [{ url: "https://news.example/b", title: "报道", snippet: "不成立" }],
        },
        { claimAtom: "吃了隔夜菜会导致中毒", verdict: "unverified", supportingSources: [{ url: "https://x.example/c" }] },
        { claimAtom: "没有来源的命题", verdict: "true" },
      ],
    });
    const rows = listKnowledgeEntries();
    expect(rows.map((row) => row.atomText)).toEqual([ATOM]);
    expect(rows[0]!.evidence.map((item) => item.stance)).toEqual(["support", "contradict"]);
    expect(rows[0]!.sourceRunId).toBe("run-1");

    // 下一轮：换一种说法（同义改写）也能命中，且拿到已核日期与原来源
    const next = createKnowledgeMemory({ runId: "run-2", claim: "隔夜菜里的亚硝酸盐是否超标？", now: () => NOW });
    const injection = next.lookup("隔夜菜里的亚硝酸盐含量超过了标准");
    expect(injection).not.toBeNull();
    expect(injection!.evidence.map((e) => e.url).sort()).toEqual(["https://gov.example/a", "https://news.example/b"]);
    expect(injection!.originDate).toBe("2026-09-13");
  });

  it("settle 的 claim 与建端口时不同（视觉改写后）也按 settle 传入的 claim 判隐私", () => {
    const memory = createKnowledgeMemory({ runId: "run-1", claim: "旧原句", now: () => NOW });
    memory.settle({
      claim: ATOM,
      verdicts: [{ claimAtom: `${ATOM}。`, verdict: "true", supportingSources: [{ url: "https://a.example/x" }] }],
    });
    expect(listKnowledgeEntries()).toEqual([]);
  });

  it("观测写不进去也不抛（记忆层不许影响调查）", () => {
    const memory = createKnowledgeMemory({
      runId: "run-1",
      claim: USER_CLAIM,
      now: () => NOW,
      observe: () => {
        throw new Error("disk full");
      },
    });
    expect(() => memory.lookup("电动车失窃后被送往国外")).not.toThrow();
  });

  it("clearKnowledgeEntries 清空（测试/维护用）", () => {
    seed();
    expect(listKnowledgeEntries()).toHaveLength(1);
    clearKnowledgeEntries();
    expect(listKnowledgeEntries()).toEqual([]);
  });
});
