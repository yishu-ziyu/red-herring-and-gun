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
  /** 重新打开的历史：当前这一轮在服务端的调查编号（老记录没有）。正在跑的一轮用 run.state.runId。 */
  runId?: string;
  /** 历史/旧调查打开：直接渲染落库快照，不发起调查。 */
  restored?: {
    snapshot: InvestigationSnapshotV1;
    report: Record<string, unknown> | null;
    at?: number;
  } | null;
};

/** 保存状态：独立于结果存在与否显示，不把失败藏在 console。 */
export type SaveStatus = "idle" | "local" | "failed";

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

export function threadForRound(active: ActiveCase, snapshot: InvestigationSnapshotV1, runId?: string | null): InvestigationThread {
  const thread = active.thread ?? { version: 1 as const, id: active.roundId ?? active.localId, originalClaim: active.claim, rounds: [] };
  if (snapshot.phase !== "complete" && snapshot.phase !== "interrupted") return thread;
  return appendInvestigationRound(thread, {
    id: active.roundId ?? active.localId,
    kind: active.roundKind ?? "initial",
    question: displayFollowUpClaim(active.claim),
    snapshot,
    ...(runId ? { runId } : {}),
  });
}

/** 当前这一轮的服务端调查编号：重新打开的历史读存下的，正在跑的读 run。 */
export function currentRunId(active: ActiveCase | null, liveRunId: string | null): string | undefined {
  if (!active) return undefined;
  return active.restored ? active.runId : liveRunId ?? undefined;
}

export function restoredThreadFields(report: unknown): Pick<ActiveCase, "thread" | "roundId" | "roundKind" | "runId"> {
  const saved = readInvestigationThread(report);
  if (!saved?.rounds.length) return {};
  const last = saved.rounds[saved.rounds.length - 1];
  return { thread: { ...saved, rounds: saved.rounds.slice(0, -1) }, roundId: last.id, roundKind: last.kind, runId: last.runId };
}
