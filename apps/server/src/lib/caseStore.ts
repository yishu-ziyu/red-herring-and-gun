/**
 * caseStore.ts — Plan Item 2 · 报告 URL 永久路由 /r/:caseId
 *
 * 进程内 case 存储（LRU Map）+ 防抖 JSON 快照落盘（DATA_DIR/cases.json）。
 * 不依赖外部 DB：黑客松 MVP 阶段足够；重启/重部署不再丢「永久」报告链接。
 * 后续可平滑迁移到 SQLite / Redis / Postgres。
 *
 * 路由规则：
 *   - caseId = 8 字符 base36 hash（claim + timestamp + 16 字节随机）
 *   - 保存时同时存：claim / report / claimReview / createdAt
 *   - LRU 上限 1000 条（超出时按 createdAt 淘汰最旧）
 */

import type { FinalReport } from "./schemas.js";
import type { ClaimReviewJsonLd } from "./claimReview.js";
import { loadSnapshot, saveSnapshotDebounced } from "./jsonSnapshot.js";

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
  /** 邮箱账号 hash；未登录写入的 case 没有归属，不会出现在任何人的列表里。 */
  ownerHash?: string;
  /** 用户纠错反馈：结论有异议时由 report 页提交；供审计与后续 golden 采集。 */
  feedback?: CaseFeedback[];
}

const LRU_LIMIT = 1000;
const CASE_ID_LENGTH = 8;

const store = new Map<string, CaseEntry>();

const SNAPSHOT_FILE = "cases.json";

// 启动恢复：按 createdAt 升序插回，LRU 顺序与真实创建时间一致
const restored = loadSnapshot<CaseEntry[]>(SNAPSHOT_FILE);
if (Array.isArray(restored)) {
  for (const entry of restored
    .filter((e) => e && typeof e.caseId === "string" && typeof e.createdAt === "number")
    .sort((a, b) => a.createdAt - b.createdAt)) {
    store.set(entry.caseId, entry);
  }
}

function persist(): void {
  saveSnapshotDebounced(SNAPSHOT_FILE, [...store.values()]);
}

function evictOldest(): void {
  // 按 createdAt 淘汰最旧（插入顺序在重启后不再可信）
  while (store.size > LRU_LIMIT) {
    let oldestKey: string | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of store) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
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
  persist();
  return full;
}

/**
 * 读取 case
 */
export function getCase(caseId: string): CaseEntry | null {
  return store.get(caseId) ?? null;
}

/**
 * 列出 case（按 createdAt 降序，最多 max 条）。
 * 传入 ownerHash 时只返回该账号的 case。
 */
export function listCases(max: number = 50, ownerHash?: string): CaseEntry[] {
  const items = ownerHash
    ? Array.from(store.values()).filter((entry) => entry.ownerHash === ownerHash)
    : Array.from(store.values());
  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
}

/**
 * 测试 / 维护用：清空
 */
export function clearCases(): void {
  store.clear();
  persist();
}

const MAX_FEEDBACK_PER_CASE = 20;

/**
 * 追加用户纠错反馈。case 不存在返回 false；每 case 上限 20 条防刷。
 */
export function appendCaseFeedback(caseId: string, reason: string): { ok: boolean; error?: string } {
  const entry = store.get(caseId);
  if (!entry) return { ok: false, error: "case not found" };
  const feedback = Array.isArray(entry.feedback) ? entry.feedback : [];
  if (feedback.length >= MAX_FEEDBACK_PER_CASE) return { ok: false, error: "too many feedback" };
  entry.feedback = [...feedback, { reason: reason.slice(0, 2000), createdAt: Date.now() }];
  persist();
  return { ok: true };
}

/**
 * 统计
 */
export function caseCount(): number {
  return store.size;
}