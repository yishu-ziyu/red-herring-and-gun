/**
 * knowledgeStore — 证据库第一版（把调查过的证据沉淀下来，下次相命题免于重复联网）。
 *
 * 介质：本地 SQLite（`node:sqlite`，见 sqliteStore.ts）的 `knowledge_entries` 表（3 号迁移，
 * 幂等）。没有可用 sqlite 时退化为进程内缓存：知识库是加速层，不是用户数据，
 * 丢了只影响速度（首次会记一条 console.warn，不静默）。
 *
 * 存什么：命题规范化文本（atomNorm，唯一键）+ 命题文本 + 判词 + 该命题当时绑定的
 * 真实来源（URL/标题/摘要/立场）+ 产生它的 runId + 时间 + 命中次数。
 * **不写用户原句全文、不写用户名**：整句等于原句的 atom 一律不进这个层（见
 * `isSameAsUserClaim`），调用方也不许把账号信息传进来。
 *
 * 宪法边界（写死在这里）：
 * - **记忆只加速、不代替核查**：沉淀的是证据与判词，不是结论；注入后判词仍由本轮
 *   fact_checker 重新判定，绑定失败 / 判 unverified 就降级联网补查（evidenceLoop）。
 * - **没证据不出结论**：来源为空或没有真实 http(s) URL 的 atom 不沉淀（注入材料必须能点开）。
 * - **不静默继承**：入口的匹配闸门在 knowledgeMatch.ts（阈值 + 人物/日期/链接冲突判不匹配）。
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, openDatabase } from "./sqliteStore.js";
import {
  classifyKnowledgeMatch,
  normalizeKnowledgeAtom,
  originDateOf,
  KNOWLEDGE_MAX_AGE_DAYS,
  KNOWLEDGE_MATCH_THRESHOLD,
} from "./knowledgeMatch.js";

/** 立场沿用报告的双桶口径：support = 支持该命题，contradict = 反驳该命题。 */
export type KnowledgeStance = "support" | "contradict";

export type KnowledgeEvidenceItem = {
  url: string;
  title: string;
  snippet: string;
  stance: KnowledgeStance;
};

export type KnowledgeEntry = {
  id: string;
  /** 规范化命题文本，唯一索引。 */
  atomNorm: string;
  atomText: string;
  /** true | false | mixed_misleading（见 knowledgeVerdictOf）。 */
  verdict: string;
  evidence: KnowledgeEvidenceItem[];
  sourceRunId: string;
  createdAt: number;
  lastVerifiedAt: number;
  /** 被注入进调查的次数（命中并真的免于本次检索才算）。 */
  hitCount: number;
};

export type KnowledgeEntryDraft = {
  atomText: string;
  verdict: unknown;
  evidence: readonly KnowledgeEvidenceItem[];
  sourceRunId: string;
  /** 测试可注入固定时刻 */
  now?: number;
  id?: string;
};

/** 观测结果：查库三种 + 注入后 + 去重/初稿复用。 */
export type KnowledgeOutcome = "hit" | "miss" | "stale" | "injected" | "downgraded" | "deduped" | "reused_verdict";

export type KnowledgeObservation = {
  ts: string;
  runId: string;
  atomNorm: string;
  outcome: KnowledgeOutcome;
};

export const KNOWLEDGE_OBSERVATION_FILE = "knowledge-observations.jsonl";

export function knowledgeObservationPath(dir: string = dataDir()): string {
  return join(dir, KNOWLEDGE_OBSERVATION_FILE);
}

/**
 * 原子判词 → 表内判词。表里只存三档可注入的判词：
 * partial / exaggerated 是原子口径的「有真有假」，落表统一成 mixed_misleading；
 * unverified / 未知一律返回 null（既不沉淀也不注入）。
 */
export function knowledgeVerdictOf(atomVerdict: unknown): string | null {
  const verdict = String(atomVerdict ?? "").trim().toLowerCase();
  if (verdict === "true") return "true";
  if (verdict === "false") return "false";
  if (verdict === "partial" || verdict === "exaggerated" || verdict === "mixed_misleading") {
    return "mixed_misleading";
  }
  return null;
}

/** 注入材料：已核日期 + 当时绑定的真实来源（stance 保留，方向仍由本轮判）。 */
export type KnowledgeInjection = {
  originDate: string;
  evidence: KnowledgeEvidenceItem[];
  /** 上次沉淀的判词，供本轮判定拍当可复核初稿。 */
  priorVerdict: string;
};

/** 管网线用的记忆端口（runCasePipeline / atomSearch 只依赖这个形状）。 */
export type KnowledgeMemory = {
  /** 逐 atom 联网前查库；命中且新鲜返回注入材料，否则 null（查库结果照记 hit/miss/stale）。 */
  lookup: (atom: string) => KnowledgeInjection | null;
  /** 注入真的发生 → 记 injected 并把该条目 hitCount +1。 */
  markInjected: (atom: string, originDate: string) => void;
  /** 注入过的 atom 若最终判 unverified/证据不足 → 记 downgraded（补查由证据循环完成）。 */
  conclude: (verdicts: unknown) => void;
  /** 收尾沉淀：可核查且判词非 unverified 的 atom → upsert。 */
  settle: (input: { claim: string; verdicts: unknown }) => void;
};

// ── SQLite / 进程内缓存 ────────────────────────────────────────────────────

type KnowledgeRow = {
  id: string;
  atomNorm: string;
  atomText: string;
  verdict: string;
  evidence: string;
  sourceRunId: string;
  createdAt: number;
  lastVerifiedAt: number;
  hitCount: number;
};

/** 没有 sqlite 时的降级：进程内 Map（键 = atomNorm），不落盘。 */
const memory = new Map<string, KnowledgeEntry>();
let db: DatabaseSync | null | undefined;
let warnedNoSqlite = false;

function database(): DatabaseSync | null {
  if (db === undefined) {
    db = openDatabase();
    if (!db && !warnedNoSqlite) {
      warnedNoSqlite = true;
      console.warn("[knowledgeStore] 没有可用 sqlite，知识库退化为进程内缓存（重启即丢，不影响本次调查）");
    }
  }
  return db;
}

function isHttpUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

/** 证据清洗：只留真实 http(s) URL，去重，长度收敛；stance 不认识按 support。 */
function sanitizeEvidence(items: readonly KnowledgeEvidenceItem[]): KnowledgeEvidenceItem[] {
  const out: KnowledgeEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(items) ? items : []) {
    const url = String(item?.url ?? "").trim();
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: String(item?.title ?? "").trim().slice(0, 200),
      snippet: String(item?.snippet ?? "").trim().slice(0, 320),
      stance: item?.stance === "contradict" ? "contradict" : "support",
    });
  }
  return out.slice(0, 24);
}

function parseEvidence(raw: unknown): KnowledgeEvidenceItem[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return sanitizeEvidence(Array.isArray(parsed) ? (parsed as KnowledgeEvidenceItem[]) : []);
  } catch {
    return [];
  }
}

function rowToEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    atomNorm: row.atomNorm,
    atomText: row.atomText,
    verdict: row.verdict,
    evidence: parseEvidence(row.evidence),
    sourceRunId: row.sourceRunId,
    createdAt: row.createdAt,
    lastVerifiedAt: row.lastVerifiedAt,
    hitCount: row.hitCount ?? 0,
  };
}

/**
 * 沉淀一条（同 atomNorm 冲突时只更新 verdict / evidence / lastVerifiedAt，
 * 保留首次沉淀的 id / createdAt / sourceRunId / hitCount——契约逐字）。
 * 判词不可沉淀或没有真实来源时返回 null：没证据不出结论，也不写空壳。
 */
export function upsertKnowledgeEntry(draft: KnowledgeEntryDraft): KnowledgeEntry | null {
  const atomText = String(draft?.atomText ?? "").trim();
  const atomNorm = normalizeKnowledgeAtom(atomText);
  const verdict = knowledgeVerdictOf(draft?.verdict);
  const evidence = sanitizeEvidence(draft?.evidence ?? []);
  if (!atomNorm || !verdict || evidence.length === 0) return null;
  const now = draft.now ?? Date.now();
  const instance = database();
  if (!instance) {
    const existing = memory.get(atomNorm);
    const entry: KnowledgeEntry = existing
      ? { ...existing, verdict, evidence, lastVerifiedAt: now }
      : {
          id: draft.id ?? randomUUID(),
          atomNorm,
          atomText,
          verdict,
          evidence,
          sourceRunId: draft.sourceRunId,
          createdAt: now,
          lastVerifiedAt: now,
          hitCount: 0,
        };
    memory.set(atomNorm, entry);
    return entry;
  }
  const existingRow = instance
    .prepare("SELECT * FROM knowledge_entries WHERE atomNorm = ?")
    .get(atomNorm) as KnowledgeRow | undefined;
  if (existingRow) {
    instance
      .prepare("UPDATE knowledge_entries SET verdict = ?, evidence = ?, lastVerifiedAt = ? WHERE atomNorm = ?")
      .run(verdict, JSON.stringify(evidence), now, atomNorm);
    return rowToEntry({ ...existingRow, verdict, evidence: JSON.stringify(evidence), lastVerifiedAt: now });
  }
  const entry: KnowledgeEntry = {
    id: draft.id ?? randomUUID(),
    atomNorm,
    atomText,
    verdict,
    evidence,
    sourceRunId: draft.sourceRunId,
    createdAt: now,
    lastVerifiedAt: now,
    hitCount: 0,
  };
  instance
    .prepare(
      `INSERT INTO knowledge_entries
       (id, atomNorm, atomText, verdict, evidence, sourceRunId, createdAt, lastVerifiedAt, hitCount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      entry.id,
      entry.atomNorm,
      entry.atomText,
      entry.verdict,
      JSON.stringify(entry.evidence),
      entry.sourceRunId,
      entry.createdAt,
      entry.lastVerifiedAt
    );
  return entry;
}

/** 列出条目（默认最近 500 条，便于按新鲜度兜住扫描量）。 */
export function listKnowledgeEntries(options?: { limit?: number }): KnowledgeEntry[] {
  const limit = Math.max(1, options?.limit ?? 500);
  const instance = database();
  if (!instance) {
    return [...memory.values()]
      .sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt)
      .slice(0, limit);
  }
  const rows = instance
    .prepare("SELECT * FROM knowledge_entries ORDER BY lastVerifiedAt DESC, rowid DESC LIMIT ?")
    .all(limit) as KnowledgeRow[];
  return rows.map(rowToEntry);
}

/** 命中并注入后计数 +1（只在进程内/库内自增，不参与任何判定）。 */
export function bumpKnowledgeHitCount(id: string): void {
  const instance = database();
  if (!instance) {
    for (const entry of memory.values()) {
      if (entry.id === id) {
        memory.set(entry.atomNorm, { ...entry, hitCount: entry.hitCount + 1 });
        return;
      }
    }
    return;
  }
  instance.prepare("UPDATE knowledge_entries SET hitCount = hitCount + 1 WHERE id = ?").run(id);
}

/** 追加一行观测到 $DATA_DIR/knowledge-observations.jsonl（缺目录会补）。 */
export function appendKnowledgeObservation(rec: {
  runId: string;
  atomNorm: string;
  outcome: KnowledgeOutcome;
  ts?: string;
}): void {
  const runId = String(rec?.runId ?? "").trim();
  const atomNorm = normalizeKnowledgeAtom(rec?.atomNorm ?? "");
  if (!runId || !atomNorm) {
    throw new Error("知识库观测记录缺少 runId 或 atomNorm");
  }
  const ts = typeof rec.ts === "string" && rec.ts.trim() ? rec.ts.trim() : new Date().toISOString();
  const line: KnowledgeObservation = { ts, runId, atomNorm, outcome: rec.outcome };
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(knowledgeObservationPath(dir), `${JSON.stringify(line)}\n`, "utf8");
}

/** 测试 / 维护用：清空进程内缓存并放下 sqlite 句柄（下次重新打开）。 */
export function __resetKnowledgeStoreForTests(): void {
  memory.clear();
  db = undefined;
  warnedNoSqlite = false;
}

export function clearKnowledgeEntries(): void {
  const instance = database();
  if (!instance) {
    memory.clear();
    return;
  }
  instance.exec("DELETE FROM knowledge_entries");
}

// ── 记忆端口 ───────────────────────────────────────────────────────────────

/**
 * 每个 atom 的上限放宽到该值以上都会先做字符串相似度，成本可控；
 * 单次 run 内只读一次表（调查是很短的一段时间，库不会在中间变），
 * 沉淀后失效，下一次 run 重新读。
 */
const ENTRY_SCAN_LIMIT = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 该 atom 是否就是用户原句（规范化后相等）：是的话整个记忆层不参与（隐私）。 */
function isSameAsUserClaim(atom: string, claimNorm: string): boolean {
  const atomNorm = normalizeKnowledgeAtom(atom);
  return Boolean(atomNorm) && atomNorm === claimNorm;
}

/** 从判决列表里取该 atom 的最终判词（找不到返回 null）。 */
function verdictsByAtom(verdicts: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of Array.isArray(verdicts) ? verdicts : []) {
    const rec = asRecord(item);
    if (!rec) continue;
    const atom = normalizeKnowledgeAtom(String(rec.claimAtom ?? ""));
    if (!atom || map.has(atom)) continue;
    map.set(atom, rec);
  }
  return map;
}

/** 该判词绑定的来源 → 沉淀用证据（双桶立场 + 只留真实 http(s) URL）。 */
function evidenceOfVerdict(verdict: Record<string, unknown>): KnowledgeEvidenceItem[] {
  const collect = (raw: unknown, stance: KnowledgeStance): KnowledgeEvidenceItem[] => {
    const out: KnowledgeEvidenceItem[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const rec = asRecord(item);
      if (!rec) continue;
      const url = String(rec.url ?? "").trim();
      if (!isHttpUrl(url)) continue;
      out.push({
        url,
        title: String(rec.title ?? "").trim().slice(0, 200),
        snippet: String(rec.snippet ?? rec.excerpt ?? "").trim().slice(0, 320),
        stance,
      });
    }
    return out;
  };
  return [...collect(verdict.supportingSources, "support"), ...collect(verdict.contradictingSources, "contradict")];
}

/**
 * 建一份本次调查用的记忆端口。
 *
 * @param claim 用户原句（规范化后与 atom 相等时整个记忆层不参与——不写原句、也不拿原句
 *   当知识条目，见文件头隐私规则）。
 */
export function createKnowledgeMemory(options: {
  runId: string;
  claim: string;
  now?: () => number;
  /** 观测写入器（默认 JSONL）；测试可注入内存收集。 */
  observe?: (rec: KnowledgeObservation) => void;
  threshold?: number;
  maxAgeDays?: number;
}): KnowledgeMemory {
  const runId = String(options.runId ?? "").trim();
  const now = options.now ?? (() => Date.now());
  const claimNorm = normalizeKnowledgeAtom(options.claim ?? "");
  const threshold = options.threshold ?? KNOWLEDGE_MATCH_THRESHOLD;
  const maxAgeDays = options.maxAgeDays ?? KNOWLEDGE_MAX_AGE_DAYS;

  /** 注入过的 atomNorm → 已核日期（结论阶段据此记 downgraded）。 */
  const injected = new Map<string, string>();
  /** 命中 atom 所匹配到的条目 id（markInjected 时给那条 +1，不是规范化相等的另一条）。 */
  const matchedEntryId = new Map<string, string>();
  /** 命中 atom 所匹配到的条目判词（注入时记 reused_verdict）。 */
  const matchedPriorVerdict = new Map<string, string>();
  let cachedEntries: KnowledgeEntry[] | null = null;

  const entries = (): KnowledgeEntry[] => {
    if (cachedEntries) return cachedEntries;
    try {
      cachedEntries = listKnowledgeEntries({ limit: ENTRY_SCAN_LIMIT });
    } catch (error) {
      console.error(`[knowledge] 读知识库失败 runId=${runId}`, error);
      cachedEntries = [];
    }
    return cachedEntries;
  };

  /**
   * 观测一行。记忆层的任何失败都不许影响调查：写不进去只记服务端日志。
   */
  const observe = (atomNorm: string, outcome: KnowledgeOutcome): void => {
    if (!runId || !atomNorm) return;
    const rec: KnowledgeObservation = { ts: new Date(now()).toISOString(), runId, atomNorm, outcome };
    try {
      if (options.observe) options.observe(rec);
      else appendKnowledgeObservation(rec);
    } catch (error) {
      console.error(`[knowledge-observation] 观测未写入 runId=${runId}`, error);
    }
  };

  return {
    lookup(atom) {
      if (!runId) return null;
      if (isSameAsUserClaim(atom, claimNorm)) return null;
      const atomNorm = normalizeKnowledgeAtom(atom);
      const classification = classifyKnowledgeMatch({
        atom,
        entries: entries(),
        now: now(),
        threshold,
        maxAgeDays,
      });
      if (classification.kind === "none") {
        observe(atomNorm, "miss");
        return null;
      }
      if (classification.kind === "stale") {
        observe(atomNorm, "stale");
        return null;
      }
      if (classification.kind === "unusable") {
        // 判词不可注入（含 unverified）或条目没有可注入的真实 URL：按未命中处理。
        observe(atomNorm, "miss");
        return null;
      }
      const originDate = originDateOf(classification.entry.lastVerifiedAt);
      if (!originDate) {
        observe(atomNorm, "miss");
        return null;
      }
      matchedEntryId.set(atomNorm, classification.entry.id);
      matchedPriorVerdict.set(atomNorm, classification.entry.verdict);
      observe(atomNorm, "hit");
      return {
        originDate,
        evidence: classification.entry.evidence.map((item) => ({ ...item })),
        priorVerdict: classification.entry.verdict,
      };
    },

    markInjected(atom, originDate) {
      const atomNorm = normalizeKnowledgeAtom(atom);
      if (!atomNorm) return;
      injected.set(atomNorm, String(originDate ?? ""));
      observe(atomNorm, "injected");
      if (matchedPriorVerdict.get(atomNorm)) observe(atomNorm, "reused_verdict");
      const entryId = matchedEntryId.get(atomNorm);
      if (!entryId) return;
      try {
        bumpKnowledgeHitCount(entryId);
      } catch (error) {
        console.error(`[knowledge] hitCount 自增失败 runId=${runId}`, error);
      }
    },

    conclude(verdicts) {
      if (injected.size === 0) return;
      const byAtom = verdictsByAtom(verdicts);
      for (const atomNorm of injected.keys()) {
        const verdict = byAtom.get(atomNorm);
        const finalVerdict = String(verdict?.verdict ?? "").trim().toLowerCase();
        // 判词不可沉淀（unverified / 未知）= 这次注入没能支撑结论 → 已由证据循环补查，
        // 这里只记一笔「降级」，不在这里改判词。
        if (knowledgeVerdictOf(finalVerdict) === null) observe(atomNorm, "downgraded");
      }
    },

    settle({ claim, verdicts }) {
      if (!runId) return;
      const settleClaimNorm = normalizeKnowledgeAtom(claim ?? "") || claimNorm;
      const byAtom = verdictsByAtom(verdicts);
      const at = now();
      let changed = false;
      for (const [atomNorm, verdict] of byAtom) {
        // 隐私：整句等于原句的 atom 不进这个层（原句全文不落表、不落 JSONL）。
        if (atomNorm && atomNorm === settleClaimNorm) continue;
        if (injected.has(atomNorm)) {
          observe(atomNorm, "deduped");
          continue;
        }
        const evidence = evidenceOfVerdict(verdict);
        if (evidence.length === 0) continue;
        try {
          const entry = upsertKnowledgeEntry({
            atomText: String(verdict.claimAtom ?? "").trim(),
            verdict: verdict.verdict,
            evidence,
            sourceRunId: runId,
            now: at,
          });
          if (entry) changed = true;
        } catch (error) {
          console.error(`[knowledge] 沉淀失败 runId=${runId}`, error);
        }
      }
      if (changed) cachedEntries = null;
    },
  };
}
