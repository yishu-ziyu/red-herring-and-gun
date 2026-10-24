/**
 * 调查历史：只在这个浏览器里（localStorage），挂载时读一次。
 * 落库报告的隐藏字段（investigation、investigationThread、_source……）和「历史里最后一轮当作当前轮」
 * 的拆分都收在这里，界面只见 ShellCase 与 ActiveCase。
 */
import { useCallback, useEffect, useState } from "react";
import type { ShellCase } from "../goldenPath/ProductShell";
import type { CaseIntake } from "../lib/caseIntake";
import { caseIntakeDisplayText } from "../lib/caseIntake";
import { createKnowledgeBase, type KnowledgeBaseEntry } from "../lib/knowledgeBase";
import { displayFollowUpClaim, previousAnswerText } from "../../shared/followUp";
import {
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "../../shared/investigation";
import {
  appendInvestigationRound,
  newInvestigationThread,
  readInvestigationThread,
  splitCurrentRound,
  threadSummary,
  type InvestigationRound,
  type InvestigationThread,
} from "../../shared/investigationThread";

export type ActiveCase = {
  localId: string;
  claim: string;
  intake: CaseIntake | null;
  /** Completed earlier rounds; the current round remains live until it settles. */
  thread?: InvestigationThread;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  /** 这一轮在服务端的调查编号（老记录没有）。 */
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
function snapshotFromReport(report: Record<string, unknown> | null | undefined): InvestigationSnapshotV1 | undefined {
  if (!report || typeof report !== "object") return undefined;
  const embedded = report.investigation;
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

/** 开一轮新调查对应的案件：追问和重新核查沿用前面的线程，首轮新开一条。 */
export function newActiveCase(
  intake: CaseIntake,
  roundKind: InvestigationRound["kind"],
  previousThread?: InvestigationThread
): ActiveCase & { thread: InvestigationThread } {
  const claim = caseIntakeDisplayText(intake);
  const localId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const thread = previousThread ?? newInvestigationThread(localId, claim);
  return { localId, roundId: localId, roundKind, claim, intake, thread };
}

/** 把这一轮并进线程，得到追问、重新核查或落库要带的线程。没有定论的快照不进线程。 */
export function threadWithRound(active: ActiveCase, snapshot: InvestigationSnapshotV1): InvestigationThread {
  const thread = active.thread ?? newInvestigationThread(active.roundId ?? active.localId, active.claim);
  if (snapshot.phase !== "complete" && snapshot.phase !== "interrupted") return thread;
  return appendInvestigationRound(thread, {
    id: active.roundId ?? active.localId,
    kind: active.roundKind ?? "initial",
    question: displayFollowUpClaim(active.claim),
    snapshot,
    ...(active.runId ? { runId: active.runId } : {}),
  });
}

/** 上一轮的回答文字（追问要带）：报告里的 conclusion，其次 memo。 */
export function reportAnswerText(report: Record<string, unknown> | null): string {
  return previousAnswerText(report as { conclusion?: string; memo?: string } | null);
}

/** 流断了没等到报告时，用快照合成一份：中断的标 error-boundary，完整的标 restored-snapshot。 */
function reportFromSnapshot(snapshot: InvestigationSnapshotV1): Record<string, unknown> {
  return {
    _source: snapshot.phase === "interrupted" ? "error-boundary" : "restored-snapshot",
    conclusion: snapshot.conclusion?.directAnswer ?? "",
    investigation: snapshot,
    ...(snapshot.checkedAt ? { checkedAt: snapshot.checkedAt } : {}),
  };
}

function runningShellCase(active: ActiveCase & { thread: InvestigationThread }): ShellCase {
  const { thread } = active;
  return { id: active.localId, claim: thread.originalClaim, threadId: thread.id, roundCount: thread.rounds.length + 1, status: "running" };
}

function savedShellCase(id: string, claim: string, report: Record<string, unknown>, createdAt: number): ShellCase {
  const summary = threadSummary(report);
  return {
    id,
    claim: summary.threadClaim ?? claim,
    ...summary,
    status: report._source === "error-boundary" ? "interrupted" : "done",
    createdAt,
  };
}

function groupThreadCases(items: ShellCase[]): ShellCase[] {
  const latest = new Map<string, ShellCase>();
  for (const item of items) {
    const key = item.threadId ?? item.id;
    const previous = latest.get(key);
    if (!previous || (item.roundCount ?? 0) > (previous.roundCount ?? 0) ||
        ((item.roundCount ?? 0) === (previous.roundCount ?? 0) && (item.createdAt ?? 0) > (previous.createdAt ?? 0))) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function useCaseHistory() {
  const [cases, setCases] = useState<ShellCase[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const local = await createKnowledgeBase().listCases();
        if (cancelled) return;
        setCases((prev) => {
          const saved = local.map((entry) => savedShellCase(entry.id, entry.claim, entry.finalReport, entry.timestamp));
          const ids = new Set(saved.map((item) => item.id));
          return groupThreadCases([...saved, ...prev.filter((item) => !ids.has(item.id))]);
        });
      } catch {
        /* 本机历史读不出来：列表留空，不挡新调查 */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 新的一轮开始：列表里同一条线程只留这一轮，标「调查中」。 */
  const markRunning = useCallback((active: ActiveCase & { thread: InvestigationThread }) => {
    const running = runningShellCase(active);
    setCases((prev) => [running, ...prev.filter((item) => item.id !== running.id && item.threadId !== running.threadId)]);
  }, []);

  /** 只交了图片：读出图里的文字之后，历史标题换成这段文字。 */
  const retitle = useCallback((localId: string, claim: string) => {
    setCases((prev) => prev.map((item) => (item.id === localId ? { ...item, claim } : item)));
  }, []);

  /** 读不到或读不出内容返回 null，调用方负责说出来。 */
  const open = useCallback(async (id: string): Promise<ActiveCase | null> => {
    try {
      const entry = await createKnowledgeBase().getCase(id);
      const snapshot = entry ? snapshotFromReport(entry.finalReport) : undefined;
      if (!entry || !snapshot) return null;
      const saved = readInvestigationThread(entry.finalReport);
      const split = saved && splitCurrentRound(saved);
      return {
        localId: id,
        claim: entry.claim,
        ...(split ? { thread: split.earlier, roundId: split.current.id, roundKind: split.current.kind, runId: split.current.runId } : {}),
        intake: null,
        restored: { snapshot, report: entry.finalReport, at: entry.timestamp },
      };
    } catch {
      return null;
    }
  }, []);

  /**
   * 留存一轮的定论（本机）。列表先更新，写入失败不挡结果，由返回值让界面说出来。
   * report 为 null：流断了没等到服务端报告，用快照合成。
   */
  const saveRound = useCallback(
    async (active: ActiveCase, snapshot: InvestigationSnapshotV1, report: Record<string, unknown> | null): Promise<SaveStatus> => {
      const doneAt = Date.now();
      const durable = { ...(report ?? reportFromSnapshot(snapshot)), investigationThread: threadWithRound(active, snapshot) };
      setCases((prev) => groupThreadCases([
        savedShellCase(active.localId, active.claim, durable, doneAt),
        ...prev.filter((item) => item.id !== active.localId),
      ]));
      const knowledgeBase = createKnowledgeBase();
      const existing = await knowledgeBase.getCase(active.localId).catch(() => null);
      const entry: KnowledgeBaseEntry = {
        id: active.localId,
        claim: active.claim,
        finalReport: durable,
        handoffSteps: [],
        timestamp: existing?.timestamp ?? doneAt,
        tags: ["golden-path"],
      };
      try {
        await knowledgeBase.saveCase(entry);
        return "local";
      } catch (error) {
        console.error("[cases] 案例写入本地知识库失败", error);
        return "failed";
      }
    },
    []
  );

  return { cases, ready, markRunning, retitle, open, saveRound };
}
