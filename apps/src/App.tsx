/**
 * App — 生产入口（Issue #52）：轻量产品壳 + 同画布 Golden Path。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot";
import { ProductShell } from "./goldenPath/ProductShell";
import { InputStage } from "./goldenPath/InputStage";
import { InvestigationCanvas } from "./goldenPath/InvestigationCanvas";
import { useInvestigationRun, type StartOptions } from "./goldenPath/useInvestigationRun";
import { gpCopyFor } from "./goldenPath/copy";
import { useUiLang } from "./lib/useUiLang";
import { caseIntakeDisplayText, caseIntakeFailedLinks, caseIntakeIsImageOnly, caseIntakePrimaryText, createCaseIntake, type CaseIntake } from "./lib/caseIntake";
import { createKnowledgeBase, normalizeHistoryClaim } from "./lib/knowledgeBase";
import { composeFollowUpClaim, displayFollowUpClaim, previousAnswerText } from "./lib/composeFollowUpClaim";
import { visiblePriorRoundFromSnapshot } from "./lib/priorRoundBrief";
import type { InvestigationThread, InvestigationRound } from "./lib/investigationThread";
import { InvestigationThreadHeader } from "./goldenPath/InvestigationThreadHeader";
import {
  currentRunId,
  restoredThreadFields,
  snapshotFromReport,
  threadForRound,
  type ActiveCase,
  type ProductMode,
} from "./app/caseViews";
import { HISTORY_OPEN_FAILED_NOTICE, publicTransportError, TIMEOUT_PENDING_NOTICE } from "./app/notices";
import { useLocalHistory } from "./app/useLocalHistory";
import { useResultPersistence } from "./app/useResultPersistence";
import { useRunPointer } from "./app/useRunPointer";

function ProductApp() {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [mode, setMode] = useState<ProductMode>("input");
  // 从首页进入调查时回到页顶：首页滚到案例区再点开，结论不能被沿用的滚动位置挤出视口。
  // 只看模式切换；追问、保存后换 caseId 都发生在调查态内部，不跳。
  useLayoutEffect(() => {
    if (mode === "investigation") window.scrollTo(0, 0);
  }, [mode]);
  const [active, setActive] = useState<ActiveCase | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.localId ?? null;
  const [historyNotice, setHistoryNotice] = useState("");
  const [sameClaim, setSameClaim] = useState<{ id: string; claim: string; at?: number; intake: CaseIntake } | null>(null);
  const run = useInvestigationRun();
  const [draftClaim, setDraftClaim] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  // 本机历史（挂载即读一次）。
  const { cases, setCases, historyReady } = useLocalHistory();

  const { resumedRef } = useRunPointer({ historyReady, mode, active, run, copy, setActive, setMode, setHistoryNotice });

  // DEV 固定装置：/?fixture=investigating|judging|complete|conflict|interrupted|mixed|nospan|settling|source-audit|replay
  // 用脚本化快照驱动真实组件树（截图与走查）。生产构建 dead-code eliminated。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const name = new URLSearchParams(window.location.search).get("fixture");
    if (!name) return;
    let cancelled = false;
    void (async () => {
      const { getDevFixture, FIXTURE_CLAIM } = await import("./goldenPath/devFixture");
      if (cancelled) return;
      beginRun({ text: FIXTURE_CLAIM, links: [], images: [], createdAt: Date.now() }, getDevFixture(name as never));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 完成：留存到本机。保存失败不挡结果，但必须可见。
  const { saveStatus, setSaveStatus, retrySave } = useResultPersistence({
    mode,
    active,
    run,
    activeIdRef,
    setCases,
    setHistoryNotice,
  });

  /** 无守卫直接开跑：同句守卫的「重新核查」与普通提交共用。 */
  const beginRun = useCallback(
    (
      intake: CaseIntake,
      fixture?: NonNullable<Parameters<ReturnType<typeof useInvestigationRun>["start"]>[1]>["fixture"],
      // 追问：带上一轮可见材料。首轮不传。
      followUp?: Pick<StartOptions, "priorRound">,
      previousThread?: InvestigationThread,
      roundKind: InvestigationRound["kind"] = "initial",
    ) => {
      resumedRef.current = true;
      setSelectedRoundId(null);
      setSaveStatus("idle");
      setHistoryNotice("");
      setSameClaim(null);
      setDraftClaim("");
      const claim = caseIntakeDisplayText(intake);
      const localId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const thread = previousThread ?? { version: 1 as const, id: localId, originalClaim: claim, rounds: [] };
      setActive({ localId, roundId: localId, roundKind, claim, intake, thread });
      setCases((prev) => [{ id: localId, claim: thread.originalClaim, threadId: thread.id, roundCount: thread.rounds.length + 1, status: "running" as const }, ...prev.filter((item) => item.id !== localId && item.threadId !== thread.id)]);
      setMode("investigation");
      run.start(intake, {
        fixture,
        priorRound: followUp?.priorRound,
      });
    },
    [run]
  );

  const handleStart = useCallback(
    (intake: CaseIntake) => {
      const claim = caseIntakePrimaryText(intake);
      // 同句提醒只在历史已经可靠读到时出现；加载中不截断新提交。
      if (historyReady && !intake.links.length && !intake.images.length) {
        const match = cases.find((item) => item.status === "done" && normalizeHistoryClaim(item.claim) === normalizeHistoryClaim(claim));
        if (match) {
          setSameClaim({ id: match.id, claim: match.claim, at: match.createdAt, intake });
          return;
        }
      }
      beginRun(intake);
    },
    [cases, historyReady, beginRun]
  );

  const handleBackHome = useCallback(() => {
    // 从调查/旧报告返回首页时预填原句，方便改完再查（与旧壳一致）。只交了图片时没有可预填的原句。
    setDraftClaim((prev) => (caseIntakeIsImageOnly(active?.intake) ? "" : active?.thread?.originalClaim ?? active?.claim ?? prev));
    setSelectedRoundId(null);
    run.reset();
    setActive(null);
    setMode("input");
  }, [active?.claim, active?.intake, run]);

  // 只交了图片：读出图里的文字之后，历史标题和轮次标题都换成这段文字（快照里的原文），不显示请求句。
  const imageOnlyText = !active?.restored && caseIntakeIsImageOnly(active?.intake) ? run.state.snapshot?.originalClaim : undefined;
  useEffect(() => {
    if (!active || !imageOnlyText || active.claim === imageOnlyText) return;
    const localId = active.localId;
    setActive((prev) => prev && prev.localId === localId
      ? {
          ...prev,
          claim: imageOnlyText,
          thread: prev.thread && prev.thread.rounds.length === 0 ? { ...prev.thread, originalClaim: imageOnlyText } : prev.thread,
        }
      : prev);
    setCases((prev) => prev.map((item) => (item.id === localId ? { ...item, claim: imageOnlyText } : item)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageOnlyText, active?.localId]);

  const handleRetry = useCallback(() => {
    if (!active) {
      handleBackHome();
      return;
    }
    const snapshot = active.restored?.snapshot ?? run.state.snapshot;
    beginRun(active.intake ?? createCaseIntake(active.claim, []), undefined, undefined,
      snapshot ? threadForRound(active, snapshot, currentRunId(active, run.state.runId)) : active.thread, "recheck");
  }, [active, beginRun, handleBackHome, run.state.snapshot, run.state.runId]);

  const handleSelectCase = useCallback(
    async (id: string) => {
      const item = cases.find((entry) => entry.id === id);
      if (!item) return;
      setSelectedRoundId(null);
      // 本地在跑的那条：直接回到当前画布，不重新请求。
      if (item.status === "running" && active?.localId === id) {
        setMode("investigation");
        return;
      }
      try {
        const entry = await createKnowledgeBase(null).getCase(id);
        const snapshot = entry ? snapshotFromReport(entry.finalReport as Record<string, unknown>) : undefined;
        // 读不到或读不出内容不能点了没反应：提示可见，条目状态不动（Change G）。
        if (!entry || !snapshot) {
          setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
          return;
        }
        run.reset();
        setActive({
          localId: id,
          claim: entry.claim,
          ...restoredThreadFields(entry.finalReport),
          intake: null,
          restored: { snapshot, report: entry.finalReport as Record<string, unknown>, at: entry.timestamp },
        });
        setMode("investigation");
      } catch {
        setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
      }
    },
    [active?.localId, cases, lang, run]
  );

  if (window.location.pathname.startsWith("/s/")) {
    return (
      <main className="gp-share-unavailable" data-gp-share-unavailable>
        <h1>{copy.shareUnavailableTitle}</h1>
        <p>{copy.shareUnavailableBody}</p>
        <a href="/">{copy.backHome}</a>
      </main>
    );
  }

  const snapshot = active?.restored
    ? active.restored.snapshot
    : (() => {
        const s = run.state.snapshot;
        if (!s) return null;
        // 流失败但已有真实数据：按 interrupted 收口（保留数据、可重试）。
        // timeout_pending 后流结束且没有 finalReport：同样收口，不得停在 judging +「还在查」。
        // 连接仍活着时 timeoutPending 提示继续挂着，等晚到的 complete。
        const streamEndedWithoutReport =
          (run.state.connection === "failed" || run.state.connection === "ended") &&
          !run.state.finalReport;
        if (streamEndedWithoutReport && s.phase !== "complete" && s.phase !== "interrupted") {
          return interruptedInvestigationSnapshot(s, s.originalClaim);
        }
        return s;
      })();

  /**
   * 超时提示：只在连接还活着、这次调查还没拿到结果、也不是历史回看时出现。
   * 流已结束且没有报告 → 已按中断收口，不再说「还在查」。
   */
  const showTimeoutPending =
    !active?.restored &&
    run.state.timeoutPending &&
    !run.state.finalReport &&
    (run.state.connection === "live" || run.state.connection === "connecting");
  const showLinkUnreachable =
    mode === "investigation" && Boolean(active?.intake) && caseIntakeFailedLinks(active!.intake).length > 0;

  function handleFollowUp(question: string) {
      if (!active) return;
      const prevAnswer =
        previousAnswerText(
          (active.restored?.report ?? run.state.finalReport) as { conclusion?: string; memo?: string } | null
        ) || snapshot?.conclusion?.directAnswer || "";
      const composed = composeFollowUpClaim({
        originalClaim: active.thread?.originalClaim ?? active.claim,
        previousAnswer: prevAnswer,
        followUp: question,
      });
      beginRun(
        {
          text: composed,
          links: [],
          images: [],
          createdAt: Date.now(),
        },
        undefined,
        { priorRound: visiblePriorRoundFromSnapshot(snapshot) },
        snapshot ? threadForRound(active, snapshot, currentRunId(active, run.state.runId)) : active.thread,
        "follow-up",
      );
  }

  const archivedRound = selectedRoundId ? active?.thread?.rounds.find((round) => round.id === selectedRoundId) : undefined;
  const displaySnapshot = archivedRound?.snapshot ?? snapshot;
  return (
    <>
      <ProductShell
        cases={cases}
        activeCaseId={active?.localId ?? null}
        historyReady={historyReady}
        onNewCase={handleBackHome}
        onSelectCase={(id) => void handleSelectCase(id)}
        viewingInvestigation={mode === "investigation"}
      >
        {showLinkUnreachable ? (
          <p className="gp-global-notice" role="alert">
            {copy.linkUnreachableNotice}
          </p>
        ) : run.state.notice && mode === "investigation" ? (
          <p className="gp-global-notice" role="alert">{run.state.notice}</p>
        ) : historyNotice ? (
          <p className="gp-global-notice" role="alert">{historyNotice}</p>
        ) : null}
        {sameClaim ? (
          <div className="gp-same-claim" role="dialog" aria-label={copy.sameClaimTitle}>
            <p className="gp-same-claim-title">{copy.sameClaimTitle}</p>
            <p className="gp-same-claim-text">{sameClaim.claim}</p>
            <p className="gp-same-claim-time">
              {sameClaim.at ? copy.oldCaseNotice(new Date(sameClaim.at).toLocaleString("zh-CN", { hour12: false })) : copy.oldCaseNotice(copy.unknownTime)}
            </p>
            <div className="gp-same-claim-actions">
              <button
                type="button"
                className="gp-primary-btn"
                onClick={() => {
                  const target = sameClaim;
                  setSameClaim(null);
                  void handleSelectCase(target.id);
                }}
              >
                {copy.sameClaimOpen}
              </button>
              <button
                type="button"
                className="gp-ghost-btn"
                onClick={() => {
                  const target = sameClaim;
                  setSameClaim(null);
                  beginRun(target.intake);
                }}
              >
                {copy.sameClaimRedo}
              </button>
              <button type="button" className="gp-ghost-btn" onClick={() => setSameClaim(null)}>
                {copy.cancel}
              </button>
            </div>
          </div>
        ) : null}
        {mode === "investigation" && active?.thread ? <InvestigationThreadHeader
          thread={active.thread}
          currentQuestion={displayFollowUpClaim(active.claim)}
          selectedRoundId={selectedRoundId}
          onSelect={setSelectedRoundId}
        /> : null}
        {mode === "input" ? (
          <>
            {!historyReady ? <p className="gp-global-notice" role="status">{copy.loadingHistory}</p> : null}
            <InputStage
              onSubmit={handleStart}
              initialClaim={draftClaim}
            />
          </>
        ) : active && displaySnapshot ? (
          <>
            {showTimeoutPending ? (
              <p className="gp-hint" role="status" data-gp-timeout-pending>
                {TIMEOUT_PENDING_NOTICE[lang]}
              </p>
            ) : null}
            <InvestigationCanvas
              key={archivedRound?.id ?? active.roundId ?? active.localId}
              snapshot={displaySnapshot}
              readOnly={Boolean(archivedRound)}
              live={archivedRound || active.restored ? false : run.state.connection === "connecting" || run.state.connection === "live"}
              activities={archivedRound || active.restored ? [] : run.state.activities}
              stop={archivedRound || active.restored ? "idle" : run.state.stop}
              onStop={archivedRound || active.restored || !run.state.runId ? undefined : () => void run.cancel()}
              saveStatus={saveStatus}
              onRetrySave={retrySave}
              restoredAt={active.restored?.at}
              onReverify={handleRetry}
              onBackHome={handleBackHome}
              onFollowUp={archivedRound ? undefined : handleFollowUp}
              linkUnreachable={caseIntakeFailedLinks(active.intake).length > 0}
              images={archivedRound || active.restored ? undefined : active.intake?.images}
              shareRunId={archivedRound ? archivedRound.runId : currentRunId(active, run.state.runId)}
            />
          </>
        ) : showTimeoutPending ? (
          <p className="gp-hint" role="status" data-gp-timeout-pending>
            {TIMEOUT_PENDING_NOTICE[lang]}
          </p>
        ) : (
          <p className="gp-waiting" role="status">
            {run.state.connection === "failed" && !snapshot && !showLinkUnreachable
              ? publicTransportError(run.state.errorMessage, copy.connectionLost)
              : "正在拆解这句话…"}
          </p>
        )}
      </ProductShell>
    </>
  );
}

export default function App() {
  return <ProductApp />;
}
