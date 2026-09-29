/**
 * 当前案件与历史列表的数据形状，以及从落库报告取回快照、按轮次拼线程这些纯函数。
 */
import type { ShellCase } from "../goldenPath/ProductShell";
import type { CaseIntake } from "../lib/caseIntake";
import { displayFollowUpClaim } from "../lib/composeFollowUpClaim";
import {
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "../lib/investigation";
import { appendInvestigationRound, readInvestigationThread, type InvestigationRound, type InvestigationThread } from "../lib/investigationThread";

export type ProductMode = "input" | "investigation";

export type ActiveCase = {
  localId: string;
  claim: string;
  intake: CaseIntake | null;
  /** Completed earlier rounds; the current round remains live until it settles. */
  thread?: InvestigationThread;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  /** 服务端存档 id：只有它存在时才谈得上分享（分享是服务端投影）。 */
  serverCaseId?: string | null;
  /** 历史/旧调查打开：直接渲染落库快照，不发起调查。 */
  restored?: {
    snapshot: InvestigationSnapshotV1;
    report: Record<string, unknown> | null;
    at?: number;
  } | null;
};

export type ServerCaseItem = {
  caseId: string;
  claim: string;
  status?: "done" | "interrupted";
  createdAt?: number;
  threadId?: string;
  threadClaim?: string;
  roundCount?: number;
};

/** 保存状态：独立于结果存在与否显示，不把失败藏在 console。 */
export type SaveStatus = "idle" | "local" | "syncing" | "synced" | "failed";

/** 从落库 finalReport 确定性取回 Snapshot：优先保存的 investigation，旧数据客户端重建（零模型零搜索）。 */
export function snapshotFromReport(report: Record<string, unknown> | null | undefined): InvestigationSnapshotV1 | undefined {
  if (!report || typeof report !== "object") return undefined;
  const embedded = (report as Record<string, unknown>).investigation;
  if (embedded) {
    try {
      return validateInvestigationSnapshot(embedded);
    } catch {
      /* 损坏对象走重建 */
    }
  }
  try {
    return rebuildInvestigationFromReport({ report, claim: typeof report.claim === "string" ? report.claim : "" });
  } catch {
    return undefined;
  }
}

export function toShellCases(items: ServerCaseItem[]): ShellCase[] {
  return items.map((item) => ({
    id: item.caseId,
    claim: item.threadClaim ?? item.claim,
    threadId: item.threadId,
    roundCount: item.roundCount,
    status: item.status === "interrupted" ? "interrupted" : item.status === "done" ? "done" : "running",
    createdAt: item.createdAt,
  }));
}

export function groupThreadCases(items: ShellCase[]): ShellCase[] {
  const latest = new Map<string, ShellCase>();
  for (const item of items) {
    const key = item.threadId ?? item.id;
    const previous = latest.get(key);
    if (!previous || (item.roundCount ?? 0) > (previous.roundCount ?? 0) ||
        ((item.roundCount ?? 0) === (previous.roundCount ?? 0) && (item.createdAt ?? 0) > (previous.createdAt ?? 0))) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function threadForRound(active: ActiveCase, snapshot: InvestigationSnapshotV1): InvestigationThread {
  const thread = active.thread ?? { version: 1 as const, id: active.roundId ?? active.localId, originalClaim: active.claim, rounds: [] };
  if (snapshot.phase !== "complete" && snapshot.phase !== "interrupted") return thread;
  return appendInvestigationRound(thread, {
    id: active.roundId ?? active.localId,
    kind: active.roundKind ?? "initial",
    question: displayFollowUpClaim(active.claim),
    snapshot,
  });
}

export function restoredThreadFields(report: unknown): Pick<ActiveCase, "thread" | "roundId" | "roundKind"> {
  const saved = readInvestigationThread(report);
  if (!saved?.rounds.length) return {};
  const last = saved.rounds[saved.rounds.length - 1];
  return { thread: { ...saved, rounds: saved.rounds.slice(0, -1) }, roundId: last.id, roundKind: last.kind };
}
