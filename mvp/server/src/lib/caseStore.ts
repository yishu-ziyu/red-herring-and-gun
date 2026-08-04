/**
 * caseStore.ts — Plan Item 2 · 报告 URL 永久路由 /r/:caseId
 *
 * 进程内 case 存储（in-memory LRU Map）。
 * 不依赖外部 DB：黑客松 MVP 阶段足够。
 * 后续可平滑迁移到 SQLite / Redis / Postgres。
 *
 * 路由规则：
 *   - caseId = 8 字符 base36 hash（claim + timestamp + 16 字节随机）
 *   - 保存时同时存：claim / report / claimReview / createdAt
 *   - LRU 上限 1000 条（超出时按 createdAt 淘汰最旧）
 */

import type { FinalReport } from "./schemas";
import type { ClaimReviewJsonLd } from "./claimReview";

export interface CaseEntry {
  caseId: string;
  claim: string;
  report: FinalReport;
  claimReview: ClaimReviewJsonLd;
  credibilityScore: number;
  createdAt: number;
}

const LRU_LIMIT = 1000;
const CASE_ID_LENGTH = 8;

const store = new Map<string, CaseEntry>();

function evictOldest(): void {
  if (store.size <= LRU_LIMIT) return;
  // Map 保持插入顺序；最早的 entry 是第一个
  const firstKey = store.keys().next().value;
  if (firstKey) store.delete(firstKey);
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
  // 8 字符 base36（正数 + 取余保证范围）
  const positive = (h >>> 0).toString(36).padStart(CASE_ID_LENGTH, "0").slice(0, CASE_ID_LENGTH);
  return positive;
}

/**
 * 存入 case（含 LRU 淘汰）
 */
export function putCase(entry: Omit<CaseEntry, "caseId" | "createdAt"> & { caseId?: string }): CaseEntry {
  const caseId = entry.caseId ?? generateCaseId(entry.claim);
  const full: CaseEntry = { ...entry, caseId, createdAt: Date.now() };
  store.set(caseId, full);
  evictOldest();
  return full;
}

/**
 * 读取 case
 */
export function getCase(caseId: string): CaseEntry | null {
  return store.get(caseId) ?? null;
}

/**
 * 列出 case（按 createdAt 降序，最多 max 条）
 */
export function listCases(max: number = 50): CaseEntry[] {
  return Array.from(store.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
}

/**
 * 测试 / 维护用：清空
 */
export function clearCases(): void {
  store.clear();
}

/**
 * 统计
 */
export function caseCount(): number {
  return store.size;
}