/**
 * sourceReputationRegistry.ts — Plan P1-4 · 来源历史信誉（第 5 维）
 *
 * 借鉴 Logically.ai 的 B2G 信誉评分思路；仅作为**展示信号**展示，
 * **不进入** computeCredibilityScore 公式（plan §4 冻结项）。
 *
 * 数据模型：
 *   - 持久化：用户本地 ~/.gun/sourceReputation.json（避免服务端隐私争议）
 *   - LRU：只保留最近 1000 条域名记录
 *   - outcome ∈ "positive" | "mixed" | "negative"，可累计
 *   - 评分规则：基于最近 outcome 分布 → "unrated" | "positive" | "mixed" | "negative"
 *   - 未知域名默认 "unrated"（**禁止** 默认 45 冒充历史记录）
 *
 * 测试闸门：
 *   - 未知源必须返回 unrated
 *   - round-trip 持久化（写 → 读 一致）
 *   - LRU 淘汰正确
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ReputationOutcome = "positive" | "mixed" | "negative";
export type ReputationLabel = "unrated" | "positive" | "mixed" | "negative";

export interface ReputationEntry {
  hostname: string;
  positive: number;
  mixed: number;
  negative: number;
  lastUpdated: number;
}

export interface ReputationSnapshot {
  version: 1;
  entries: ReputationEntry[];
}

const STORE_VERSION = 1;
const DEFAULT_LRU_LIMIT = 1000;
const STORE_FILENAME = "sourceReputation.json";

function storePath(): string {
  return path.join(os.homedir(), ".gun", STORE_FILENAME);
}

function emptySnapshot(): ReputationSnapshot {
  return { version: STORE_VERSION, entries: [] };
}

/** 读取本地存储；文件不存在/解析失败返回空快照。 */
export function loadReputationStore(options: { storePathOverride?: string } = {}): ReputationSnapshot {
  const p = options.storePathOverride ?? storePath();
  if (!fs.existsSync(p)) return emptySnapshot();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as ReputationSnapshot;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.entries)) {
      return emptySnapshot();
    }
    return parsed;
  } catch {
    return emptySnapshot();
  }
}

/** 写入本地存储；调用方负责错误处理。 */
export function saveReputationStore(snapshot: ReputationSnapshot): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(snapshot, null, 2), "utf8");
}

/** hostname 标准化：去 www. / 小写 */
function normalizeHostname(hostname: string): string {
  return (hostname ?? "").toLowerCase().replace(/^www\./, "").trim();
}

function toLabel(entry: ReputationEntry | null): ReputationLabel {
  if (!entry) return "unrated";
  const total = entry.positive + entry.mixed + entry.negative;
  if (total === 0) return "unrated";
  // 阈值：≥60% 正向 + ≥3 条记录 → positive
  if (entry.positive / total >= 0.6 && entry.positive >= 3) return "positive";
  if (entry.negative / total >= 0.5 && entry.negative >= 2) return "negative";
  return "mixed";
}

function evictOldest(entries: ReputationEntry[], limit: number): ReputationEntry[] {
  if (entries.length <= limit) return entries;
  // 防御：同毫秒内多次写入 lastUpdated 相同 → 用 entries 数组顺序（先入者先淘汰）作为 tiebreaker
  const indexed = entries.map((e, idx) => ({ e, idx }));
  const sorted = indexed.sort((a, b) => {
    if (b.e.lastUpdated !== a.e.lastUpdated) return b.e.lastUpdated - a.e.lastUpdated;
    return b.idx - a.idx; // 旧的（先入）idx 较小 → 淘汰
  });
  return sorted.slice(0, limit).map(({ e }) => e);
}

export interface RecordOutcomeOptions {
  /** 覆盖存储路径（测试用） */
  storePathOverride?: string;
  /** LRU 上限 */
  lruLimit?: number;
}

export function recordOutcome(
  hostname: string,
  outcome: ReputationOutcome,
  options: RecordOutcomeOptions = {},
): ReputationSnapshot {
  const norm = normalizeHostname(hostname);
  if (!norm) return loadReputationStore();

  const limit = options.lruLimit ?? DEFAULT_LRU_LIMIT;
  const snapshot = loadReputationStore({ storePathOverride: options.storePathOverride });
  const idx = snapshot.entries.findIndex((e) => e.hostname === norm);
  const now = Date.now();

  let entry: ReputationEntry;
  if (idx >= 0) {
    entry = { ...snapshot.entries[idx] };
    if (outcome === "positive") entry.positive += 1;
    else if (outcome === "mixed") entry.mixed += 1;
    else entry.negative += 1;
    entry.lastUpdated = now;
    snapshot.entries.splice(idx, 1, entry);
  } else {
    entry = {
      hostname: norm,
      positive: outcome === "positive" ? 1 : 0,
      mixed: outcome === "mixed" ? 1 : 0,
      negative: outcome === "negative" ? 1 : 0,
      lastUpdated: now,
    };
    snapshot.entries.push(entry);
  }

  snapshot.entries = evictOldest(snapshot.entries, limit);

  const targetPath = options.storePathOverride ?? storePath();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

export interface GetReputationOptions {
  storePathOverride?: string;
}

export function getReputationScore(
  hostname: string,
  options: GetReputationOptions = {},
): { label: ReputationLabel; entry: ReputationEntry | null } {
  const norm = normalizeHostname(hostname);
  if (!norm) return { label: "unrated", entry: null };
  const snapshot = options.storePathOverride
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(options.storePathOverride!, "utf8")) as ReputationSnapshot;
        } catch {
          return emptySnapshot();
        }
      })()
    : loadReputationStore();
  const entry = snapshot.entries.find((e) => e.hostname === norm) ?? null;
  return { label: toLabel(entry), entry };
}

/** 单元测试 / 演示态：使用临时路径不污染用户目录 */
export function resetReputationStore(options: { storePathOverride?: string }): void {
  const p = options.storePathOverride ?? storePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}