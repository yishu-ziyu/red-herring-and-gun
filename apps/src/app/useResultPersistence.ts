/**
 * 结果落库：先本机，再（已登录时）服务端；保存状态独立可见，失败给「同步失败，重试」。
 *
 * isCurrent 守卫：落库是异步的，期间用户可能换了案件或换了账户，迟到的结果只改它自己那条，
 * 不改当前界面的保存状态。服务端给了 caseId 之后，本机条目与当前案件一起换成服务端 id。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ShellCase } from "../goldenPath/ProductShell";
import type { useInvestigationRun } from "../goldenPath/useInvestigationRun";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { threadSummary } from "../lib/investigationThread";
import type { KnowledgeBaseEntry } from "../lib/schemas";
import { groupThreadCases, snapshotFromReport, threadForRound, type ActiveCase, type ProductMode, type SaveStatus } from "./caseViews";

export function useResultPersistence(args: {
  mode: ProductMode;
  active: ActiveCase | null;
  run: ReturnType<typeof useInvestigationRun>;
  accountEmailRef: MutableRefObject<string | null>;
  activeIdRef: MutableRefObject<string | null>;
  copy: { historySyncFailed: string };
  setCases: Dispatch<SetStateAction<ShellCase[]>>;
  setActive: Dispatch<SetStateAction<ActiveCase | null>>;
  setHistoryNotice: Dispatch<SetStateAction<string>>;
}) {
  const { mode, active, run, accountEmailRef, activeIdRef, copy, setCases, setActive, setHistoryNotice } = args;
  /** 保存状态：独立于结果存在与否显示，不把失败藏在 console。 */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const persistedRoundRef = useRef<string | null>(null);

  /**
   * 落库一次：先本地，再（已登录时）服务端。
   * 抽成 useCallback 是为了让「同步失败，重试」真的有得点——说得出就必须点得到。
   */
  const persistResult = useCallback(
    async (report: Record<string, unknown>, localId: string, claim: string) => {
      const doneAt = Date.now();
      const ownerEmail = accountEmailRef.current;
      const isCurrent = () => activeIdRef.current === localId && accountEmailRef.current === ownerEmail;
      if (isCurrent()) setSaveStatus("syncing");
      const knowledgeBase = createKnowledgeBase(ownerEmail);
      const existing = await knowledgeBase.getCase(localId).catch(() => null);
      const entry: KnowledgeBaseEntry = {
        id: localId,
        claim,
        rumorType: "深度核查",
        diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
        finalReport: report,
        handoffSteps: [],
        credibilityScore: typeof report.credibilityScore === "number" ? report.credibilityScore : 50,
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
      if (accountEmailRef.current !== ownerEmail) return;
      if (isCurrent()) setSaveStatus("local");
      if (!ownerEmail) return;
      try {
        const res = await fetch("/api/case", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim,
            report,
            credibilityScore: typeof report.credibilityScore === "number" ? report.credibilityScore : 50,
          }),
        });
        if (!res.ok) {
          console.error(`[cases] 服务端存档失败 HTTP ${res.status}`);
          setHistoryNotice(copy.historySyncFailed);
          if (isCurrent()) setSaveStatus("failed");
          return;
        }
        if (accountEmailRef.current !== ownerEmail) return;
        if (isCurrent()) setSaveStatus("synced");
        const data = (await res.json()) as { caseId?: string };
        if (!data.caseId) return;
        const saved = await knowledgeBase.getCase(localId);
        if (saved && saved.id !== data.caseId) {
          await knowledgeBase.saveCase({ ...saved, id: data.caseId });
        }
        setCases((prev) => prev.map((item) => (item.id === localId ? { ...item, id: data.caseId as string } : item)));
        setActive((prev) =>
          prev && prev.localId === localId
            ? { ...prev, localId: data.caseId ?? prev.localId, serverCaseId: data.caseId ?? null }
            : prev
        );
      } catch (error) {
        console.error("[cases] 服务端存档异常", error);
        setHistoryNotice(copy.historySyncFailed);
        if (isCurrent()) setSaveStatus("failed");
      }
    },
    [copy.historySyncFailed]
  );

  /** 重试同步：用当前这份结果再走一遍，不重新调查。 */
  const retrySave = useCallback(() => {
    const report = active?.restored?.report ?? run.state.finalReport;
    if (!report || !active) return;
    const snapshot = snapshotFromReport(report);
    void persistResult(snapshot ? { ...report, investigationThread: threadForRound(active, snapshot) } : report, active.localId, active.claim);
  }, [active, persistResult, run.state.finalReport]);

  // 完成：本地留存 +（已登录）服务端落库。保存失败不挡结果，但必须可见。
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
    const durable = savedSnapshot ? { ...report, investigationThread: threadForRound(active, savedSnapshot) } : report;
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
