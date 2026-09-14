/**
 * followupObservation.ts — 追问轮次的观测记录（契约 docs/evals/2026-09-12-followup-observation.md）。
 *
 * 只回答一个问题：追问这一轮里，有多少次是「判词没变、也没检索到新来源」——
 * 也就是不需要新证据的那种追问。阶段 3 只观测，不据此改管道任何阶段：
 * 追问确认后照样走完整管道，用户无感知。
 *
 * 记录只落计数与判词标签：不写 claim 文本、不写 URL、不写用户名。
 * 来源集合在内存里按 hostname 比较，hostname 本身不进文件。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { asRecord } from "./valueCoerce.js";
import { dataDir } from "./sqliteStore.js";

/** 本轮判词与上一轮的关系。 */
export type VerdictDelta = "same" | "strengthened" | "weakened" | "changed";

/** 管道给出的本轮检索计数（调用方统计，分类器只透传）。 */
export interface FollowUpObservationStats {
  atomsTotal: number;
  atomsSearched: number;
  atomsUnverified: number;
  searchesTotal: number;
}

/** JSONL 每行一个对象，字段与契约逐字一致；ts 由 append 在写入时生成。 */
export interface FollowUpObservation {
  ts: string;
  runId: string;
  caseId: string;
  priorCaseId: string;
  atomsTotal: number;
  atomsSearched: number;
  atomsUnverified: number;
  searchesTotal: number;
  priorSourceCount: number;
  overlapSourceCount: number;
  newSourceCount: number;
  priorVerdict: string;
  verdict: string;
  verdictDelta: VerdictDelta;
  fastPathCandidate: boolean;
}

/** 分类器产物：还没有 ts（写入时才生成）。 */
export type FollowUpObservationDraft = Omit<FollowUpObservation, "ts">;

export const FOLLOW_UP_OBSERVATION_FILE = "followup-observations.jsonl";

/** 判词读不到时的取值；此时 fastPathCandidate 恒为 false。 */
export const UNKNOWN_VERDICT = "unknown";

/**
 * 判词强度阶梯（本模块内的确定性映射）：
 *   false(-1) < unverified(0) < mixed_misleading(1) < true(2)
 * 上移 = strengthened（这一轮更支持原句），下移 = weakened，同档 = same。
 * 任一侧取不到判词、或落到阶梯之外 → changed：枚举只有四档，无法比较时只能落这里，
 * 它只用来把 fastPathCandidate 挡在门外（契约要求「取不到判词时 fastPathCandidate 恒为 false」）。
 */
const VERDICT_STRENGTH: Record<string, number> = {
  false: -1,
  unverified: 0,
  mixed_misleading: 1,
  true: 2,
};

export function followUpObservationPath(dir: string = dataDir()): string {
  return join(dir, FOLLOW_UP_OBSERVATION_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 判词只认报告结论标签字段 `verdictType`（生产报告的唯一判定标签）。
 * 取不到（缺字段 / 空串 / 非字符串）记 unknown，不猜、不回退到别的字段。
 */
function verdictOf(report: unknown): string {
  if (!isRecord(report)) return UNKNOWN_VERDICT;
  const raw = asRecord(report).verdictType;
  const label = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return label || UNKNOWN_VERDICT;
}

/** 只认 http(s) 的可解析 URL；返回规范化 hostname（小写、去 www.）。 */
function hostnameOf(url: unknown): string | null {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return host || null;
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => asRecord(item)) : [];
}

/**
 * 该轮报告的引用条目里能解析出 hostname 的集合（去重后按 host 计）。
 * 取法与 reportReviewer 的 collectReportSources 同源：逐条判定的支持/反驳来源，
 * 加上全局结论的引用来源 citationSources。同一条来源在多个容器里重复出现只算一次。
 *
 * 注意：这里刻意只取「引用条目」——报告里其他材料字段（相关检索的背景材料等）
 * 不是报告引用，不计入，否则会把「检索到过」当成「引用过」。
 */
export function sourceHostsOf(report: unknown): Set<string> {
  const hosts = new Set<string>();
  if (!isRecord(report)) return hosts;
  const rec = asRecord(report);
  for (const verdict of recordsOf(rec.subclaimVerdicts)) {
    for (const bucket of [verdict.supportingSources, verdict.contradictingSources]) {
      for (const source of recordsOf(bucket)) {
        const host = hostnameOf(source.url);
        if (host) hosts.add(host);
      }
    }
  }
  for (const source of recordsOf(rec.citationSources)) {
    const host = hostnameOf(source.url);
    if (host) hosts.add(host);
  }
  return hosts;
}

/** 判词关系：确定性、无状态，同输入同输出。 */
export function verdictDeltaOf(priorVerdict: string, verdict: string): VerdictDelta {
  if (priorVerdict === UNKNOWN_VERDICT || verdict === UNKNOWN_VERDICT) return "changed";
  if (priorVerdict === verdict) return "same";
  const before = VERDICT_STRENGTH[priorVerdict];
  const after = VERDICT_STRENGTH[verdict];
  if (before === undefined || after === undefined) return "changed";
  if (after > before) return "strengthened";
  if (after < before) return "weakened";
  return "changed";
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 分类器：把上一轮报告与本轮报告压成一条观测记录。
 *
 * 返回 null 的两种情形（都不写记录、都不阻断 run）：
 *   1. 上一轮或本轮不是可读的 report 对象（含「上一轮报告缺失」）；
 *   2. 两轮判词都取不到、且两轮引用来源都是空集——什么都读不出来，写下来只是噪音。
 * 只读得出「判词 unknown 但有来源」这类半截信息时照写：契约要求取不到判词记 unknown。
 *
 * 运行身份（runId / caseId / priorCaseId）不在分类输入里（契约的入参只有三样），
 * 由调用方传进来；append 会挡住身份缺失的调用，不允许写出无法归属的记录。
 */
export function buildFollowUpObservation(input: {
  priorReport: unknown;
  report: unknown;
  stats: FollowUpObservationStats;
  runId?: string;
  caseId?: string;
  priorCaseId?: string;
}): FollowUpObservationDraft | null {
  if (!isRecord(input.priorReport) || !isRecord(input.report)) return null;

  const priorVerdict = verdictOf(input.priorReport);
  const verdict = verdictOf(input.report);
  const priorHosts = sourceHostsOf(input.priorReport);
  const hosts = sourceHostsOf(input.report);
  if (priorVerdict === UNKNOWN_VERDICT && verdict === UNKNOWN_VERDICT && priorHosts.size === 0 && hosts.size === 0) {
    return null;
  }

  let overlapSourceCount = 0;
  for (const host of hosts) {
    if (priorHosts.has(host)) overlapSourceCount += 1;
  }
  const newSourceCount = hosts.size - overlapSourceCount;
  const verdictDelta = verdictDeltaOf(priorVerdict, verdict);

  return {
    runId: input.runId ?? "",
    caseId: input.caseId ?? "",
    priorCaseId: input.priorCaseId ?? "",
    atomsTotal: countOf(input.stats?.atomsTotal),
    atomsSearched: countOf(input.stats?.atomsSearched),
    atomsUnverified: countOf(input.stats?.atomsUnverified),
    searchesTotal: countOf(input.stats?.searchesTotal),
    priorSourceCount: priorHosts.size,
    overlapSourceCount,
    newSourceCount,
    priorVerdict,
    verdict,
    verdictDelta,
    fastPathCandidate: newSourceCount === 0 && verdictDelta === "same",
  };
}

/**
 * 追加一行到 $DATA_DIR/followup-observations.jsonl（DATA_DIR 约定见 sqliteStore.dataDir）。
 * ts 缺省写当前时刻；写入会补目录，库还没建过也能写。
 *
 * 身份字段缺一即抛：宁可调用方在日志里看见一条明确失败，也不写出一条对不上号的记录。
 */
export function appendFollowUpObservation(rec: FollowUpObservationDraft & { ts?: string }): void {
  const identity = [rec?.runId, rec?.caseId, rec?.priorCaseId];
  if (identity.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error("追问观测记录缺少运行身份（runId / caseId / priorCaseId）");
  }
  const ts = typeof rec.ts === "string" && rec.ts.trim() ? rec.ts.trim() : new Date().toISOString();
  const line: FollowUpObservation = {
    ts,
    runId: rec.runId,
    caseId: rec.caseId,
    priorCaseId: rec.priorCaseId,
    atomsTotal: countOf(rec.atomsTotal),
    atomsSearched: countOf(rec.atomsSearched),
    atomsUnverified: countOf(rec.atomsUnverified),
    searchesTotal: countOf(rec.searchesTotal),
    priorSourceCount: countOf(rec.priorSourceCount),
    overlapSourceCount: countOf(rec.overlapSourceCount),
    newSourceCount: countOf(rec.newSourceCount),
    priorVerdict: String(rec.priorVerdict ?? UNKNOWN_VERDICT),
    verdict: String(rec.verdict ?? UNKNOWN_VERDICT),
    verdictDelta: rec.verdictDelta,
    fastPathCandidate: rec.fastPathCandidate === true,
  };
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(followUpObservationPath(dir), `${JSON.stringify(line)}\n`, "utf8");
}
