/**
 * caseStore.ts — 调查结果存档（Plan Item 2 · 报告 URL `/r/:caseId`）。
 *
 * 介质：本地 SQLite（`node:sqlite`，见 sqliteStore.ts）。原来的 Map + cases.json
 * 落盘在首次启动时一次性导入并留备份，之后只读。
 *
 * 为什么换：JSON 快照要求把整张表塞进一个文件，所以必须靠 LRU（1000 条）截断，
 * 超出即静默丢弃用户记录。交接包明确禁止这种丢法（IMPLEMENTATION_PLAN §5.4），
 * 而 SQLite 没有这个理由，故本版不再按条数淘汰。保留期限是产品决策，另议。
 *
 * 路由规则不变：
 *   - caseId = 8 字符 base36 hash
 *   - 存 claim / report / claimReview / credibilityScore / createdAt / ownerHash
 */
import type { FinalReport } from "./schemas.js";
import type { ClaimReviewJsonLd } from "./claimReview.js";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, openDatabase } from "./sqliteStore.js";
import type { DatabaseSync } from "node:sqlite";

export interface CaseFeedback {
  reason: string;
  createdAt: number;
}

export interface CaseEntry {
  caseId: string;
  claim: string;
  report: FinalReport;
  claimReview: ClaimReviewJsonLd;
  credibilityScore: number;
  createdAt: number;
  /** 旧记录没存时间：createdAt 保持 0，不拿当前时间冒充原调查时间。 */
  createdAtUnknown?: boolean;
  /** 邮箱账号 hash；未登录写入的 case 没有归属，不会出现在任何人的列表里。 */
  ownerHash?: string;
  /** 用户纠错反馈：结论有异议时由 report 页提交；供审计与后续 golden 采集。 */
  feedback?: CaseFeedback[];
}

const CASE_ID_LENGTH = 8;
const SNAPSHOT_FILE = "cases.json";

type CaseRow = {
  caseId: string;
  claim: string;
  report: string;
  claimReview: string;
  credibilityScore: number;
  createdAt: number | null;
  createdAtUnknown: number;
  ownerHash: string | null;
  feedback: string;
};

function rowToEntry(row: CaseRow): CaseEntry {
  let feedback: CaseFeedback[] = [];
  try {
    const parsed = JSON.parse(row.feedback) as CaseFeedback[];
    if (Array.isArray(parsed)) feedback = parsed;
  } catch {
    feedback = [];
  }
  return {
    caseId: row.caseId,
    claim: row.claim,
    report: JSON.parse(row.report) as FinalReport,
    claimReview: JSON.parse(row.claimReview) as ClaimReviewJsonLd,
    credibilityScore: row.credibilityScore,
    createdAt: row.createdAt ?? 0,
    ...(row.createdAtUnknown ? { createdAtUnknown: true } : {}),
    ...(row.ownerHash ? { ownerHash: row.ownerHash } : {}),
    ...(feedback.length > 0 ? { feedback } : {}),
  };
}

// 没有可用 sqlite 时的降级：与旧实现一致的进程内 Map（不落盘，重启即丢）。
const memory = new Map<string, CaseEntry>();
let db: DatabaseSync | null | undefined;
let usingMemory = false;

function database(): DatabaseSync | null {
  if (db === undefined) {
    db = openDatabase();
    usingMemory = db === null;
    if (db) importLegacyCases(db);
  }
  return db;
}

function isUsingMemory(): boolean {
  database();
  return usingMemory;
}

/**
 * 首次启动把旧的 cases.json 导入 SQLite：先备份原件，再逐条插入。
 * 幂等：cases 表非空时直接返回。导入不按条数截断。
 */
export function importLegacyCases(databaseInstance: DatabaseSync): { imported: number; skipped: boolean; backupPath?: string } {
  const existing = databaseInstance.prepare("SELECT COUNT(*) AS n FROM cases").get() as { n: number } | undefined;
  if ((existing?.n ?? 0) > 0) return { imported: 0, skipped: true };

  const source = join(dataDir(), SNAPSHOT_FILE);
  if (!existsSync(source)) return { imported: 0, skipped: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    console.error("[caseStore] 旧 cases.json 解析失败，未导入", error);
    return { imported: 0, skipped: false };
  }
  if (!Array.isArray(parsed)) return { imported: 0, skipped: false };

  const backupPath = `${source}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    copyFileSync(source, backupPath);
  } catch (error) {
    console.error("[caseStore] 备份旧 cases.json 失败，为安全起见不导入", error);
    return { imported: 0, skipped: false };
  }

  const insert = databaseInstance.prepare(
    `INSERT OR REPLACE INTO cases
     (caseId, claim, report, claimReview, credibilityScore, createdAt, createdAtUnknown, ownerHash, feedback, migratedFrom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let imported = 0;
  for (const raw of parsed as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.caseId !== "string" || !raw.caseId) continue;
    const hasCreatedAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt);
    insert.run(
      raw.caseId,
      typeof raw.claim === "string" ? raw.claim : "",
      JSON.stringify(raw.report ?? {}),
      JSON.stringify(raw.claimReview ?? {}),
      typeof raw.credibilityScore === "number" ? raw.credibilityScore : 0,
      hasCreatedAt ? (raw.createdAt as number) : null,
      hasCreatedAt ? 0 : 1,
      typeof raw.ownerHash === "string" ? raw.ownerHash : null,
      JSON.stringify(Array.isArray(raw.feedback) ? raw.feedback : []),
      SNAPSHOT_FILE
    );
    imported += 1;
  }
  console.log(`[caseStore] 已从 ${SNAPSHOT_FILE} 导入 ${imported} 条，备份 ${backupPath}`);
  return { imported, skipped: false, backupPath };
}

/**
 * 生成稳定 caseId：基于 claim + timestamp + 16 字节随机数。
 * 8 字符 base36。
 */
export function generateCaseId(seed: string, now: number = Date.now()): string {
  const input = `${seed}|${now}|${Math.random().toString(36).slice(2)}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  const positive = (h >>> 0).toString(36).padStart(CASE_ID_LENGTH, "0").slice(0, CASE_ID_LENGTH);
  return positive;
}

/** 存入 case（同 caseId 覆盖；createdAt 取写入时刻，与旧实现一致）。 */
export function putCase(entry: Omit<CaseEntry, "caseId" | "createdAt"> & { caseId?: string }): CaseEntry {
  const caseId = entry.caseId ?? generateCaseId(entry.claim);
  const full: CaseEntry = { ...entry, caseId, createdAt: Date.now() };
  const databaseInstance = database();
  if (!databaseInstance) {
    memory.set(caseId, full);
    return full;
  }
  databaseInstance
    .prepare(
      `INSERT OR REPLACE INTO cases
       (caseId, claim, report, claimReview, credibilityScore, createdAt, createdAtUnknown, ownerHash, feedback, migratedFrom)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`
    )
    .run(
      caseId,
      full.claim,
      JSON.stringify(full.report),
      JSON.stringify(full.claimReview),
      full.credibilityScore,
      full.createdAt,
      full.ownerHash ?? null,
      JSON.stringify(full.feedback ?? [])
    );
  return full;
}

export function getCase(caseId: string): CaseEntry | null {
  const databaseInstance = database();
  if (!databaseInstance) return memory.get(caseId) ?? null;
  const row = databaseInstance.prepare("SELECT * FROM cases WHERE caseId = ?").get(caseId) as CaseRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** 列出 case（按 createdAt 降序，最多 max 条）。传 ownerHash 只返回该账号的。 */
export function listCases(max: number = 50, ownerHash?: string): CaseEntry[] {
  const databaseInstance = database();
  if (!databaseInstance) {
    const items = ownerHash
      ? Array.from(memory.values()).filter((entry) => entry.ownerHash === ownerHash)
      : Array.from(memory.values());
    return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
  }
  const rows = (
    ownerHash
      ? databaseInstance
          .prepare("SELECT * FROM cases WHERE ownerHash = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?")
          .all(ownerHash, max)
      : databaseInstance.prepare("SELECT * FROM cases ORDER BY createdAt DESC, rowid DESC LIMIT ?").all(max)
  ) as CaseRow[];
  return rows.map(rowToEntry);
}

/** 测试 / 维护用：清空。 */
export function clearCases(): void {
  const databaseInstance = database();
  if (!databaseInstance) {
    memory.clear();
    return;
  }
  databaseInstance.exec("DELETE FROM cases");
}

const MAX_FEEDBACK_PER_CASE = 20;

/** 追加用户纠错反馈。case 不存在返回 false；每 case 上限 20 条防刷。 */
export function appendCaseFeedback(caseId: string, reason: string): { ok: boolean; error?: string } {
  const entry = getCase(caseId);
  if (!entry) return { ok: false, error: "case not found" };
  const feedback = entry.feedback ?? [];
  if (feedback.length >= MAX_FEEDBACK_PER_CASE) return { ok: false, error: "too many feedback" };
  const next: CaseFeedback[] = [...feedback, { reason: reason.slice(0, 2000), createdAt: Date.now() }];
  const databaseInstance = database();
  if (!databaseInstance) {
    memory.set(caseId, { ...entry, feedback: next });
    return { ok: true };
  }
  databaseInstance.prepare("UPDATE cases SET feedback = ? WHERE caseId = ?").run(JSON.stringify(next), caseId);
  return { ok: true };
}

export function caseCount(): number {
  const databaseInstance = database();
  if (!databaseInstance) return memory.size;
  const row = databaseInstance.prepare("SELECT COUNT(*) AS n FROM cases").get() as { n: number } | undefined;
  return row?.n ?? 0;
}

/** 测试用：强制重新打开介质（模拟进程重启）。 */
export function __resetStoreForTests(): void {
  db = undefined;
  memory.clear();
  usingMemory = false;
}

export { isUsingMemory };
