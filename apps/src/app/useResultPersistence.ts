/**
 * 结果落库：只存本机（localStorage）；保存状态独立可见，失败给「保存失败，重试」。
 *
 * isCurrent 守卫：落库是异步的，期间用户可能换了案件，迟到的结果只改它自己那条，
 * 不改当前界面的保存状态。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ShellCase } from "../goldenPath/ProductShell";
import type { useInvestigationRun } from "../goldenPath/useInvestigationRun";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { threadSummary } from "../lib/investigationThread";
import type { KnowledgeBaseEntry } from "../lib/schemas";
import { currentRunId, groupThreadCases, snapshotFromReport, threadForRound, type ActiveCase, type ProductMode, type SaveStatus } from "./caseViews";

export function useResultPersistence(args: {
  mode: ProductMode;
  active: ActiveCase | null;
  run: ReturnType<typeof useInvestigationRun>;
  activeIdRef: MutableRefObject<string | null>;
  setCases: Dispatch<SetStateAction<ShellCase[]>>;
  setHistoryNotice: Dispatch<SetStateAction<string>>;
}) {
  const { mode, active, run, activeIdRef, setCases, setHistoryNotice } = args;
  /** 保存状态：独立于结果存在与否显示，不把失败藏在 console。 */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const persistedRoundRef = useRef<string | null>(null);

  /**
   * 落库一次（本机）。
   * 抽成 useCallback 是为了让「保存失败，重试」真的有得点——说得出就必须点得到。
   */
  const persistResult = useCallback(
    async (report: Record<string, unknown>, localId: string, claim: string) => {
      const doneAt = Date.now();
      const isCurrent = () => activeIdRef.current === localId;
      const knowledgeBase = createKnowledgeBase(null);
      const existing = await knowledgeBase.getCase(localId).catch(() => null);
      const entry: KnowledgeBaseEntry = {
        id: localId,
        claim,
        rumorType: "深度核查",
        diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
        finalReport: report,
        handoffSteps: [],
        timestamp: existing?.timestamp ?? doneAt,
        tags: ["golden-path"],
      };
      try {
        await knowledgeBase.saveCase(entry);
      } catch (error) {
        console.error("[cases] 案例写入本地知识库失败", error);
        setHistoryNotice("调查自动保存失败，刷新后可能无法找回。请先保留当前报告。");
        if (isCurrent()) setSaveStatus("failed");
        return;
      }
      if (isCurrent()) setSaveStatus("local");
    },
    []
  );

  /** 重试保存：用当前这份结果再走一遍，不重新调查。 */
  const retrySave = useCallback(() => {
    const report = active?.restored?.report ?? run.state.finalReport;
    if (!report || !active) return;
    const snapshot = snapshotFromReport(report);
    void persistResult(snapshot ? { ...report, investigationThread: threadForRound(active, snapshot, currentRunId(active, run.state.runId)) } : report, active.localId, active.claim);
  }, [active, persistResult, run.state.finalReport, run.state.runId]);

  // 完成：留存到本机。保存失败不挡结果，但必须可见。
  useEffect(() => {
    if (mode !== "investigation" || !active || active.restored) return;
    const terminalConnection = run.state.connection === "ended" || run.state.connection === "failed";
    const interrupted = run.state.snapshot?.phase === "interrupted" && terminalConnection;
    const restoredCompletion = run.state.snapshot?.phase === "complete" && terminalConnection;
    const report = run.state.finalReport ?? (interrupted || restoredCompletion ? {
      _source: interrupted ? "error-boundary" : "restored-snapshot",
      conclusion: run.state.snapshot?.conclusion?.directAnswer ?? "",
      investigation: run.state.snapshot,
      ...(run.state.snapshot?.checkedAt ? { checkedAt: run.state.snapshot.checkedAt } : {}),
    } : null);
    if (!report) return;
    const persistedKey = `${active.roundId ?? active.localId}:${run.state.finalReport || restoredCompletion ? "report" : "interrupted"}`;
    if (persistedRoundRef.current === persistedKey) return;
    persistedRoundRef.current = persistedKey;
    const doneAt = Date.now();
    const localId = active.localId;
    const claim = active.claim;
    const savedSnapshot = snapshotFromReport(report);
    const durable = savedSnapshot ? { ...report, investigationThread: threadForRound(active, savedSnapshot, run.state.runId) } : report;
    const summary = threadSummary(durable);
    setCases((prev) => groupThreadCases([
      { id: localId, claim: summary.threadClaim ?? claim, ...summary, report: durable, status: report._source === "error-boundary" ? ("interrupted" as const) : ("done" as const), createdAt: doneAt },
      ...prev.filter((item) => item.id !== localId),
    ]));
    void persistResult(durable, localId, claim);
    // 只在 finalReport 首次出现时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.state.finalReport, run.state.snapshot, run.state.connection, active, mode, persistResult]);

  return { saveStatus, setSaveStatus, retrySave };
}
