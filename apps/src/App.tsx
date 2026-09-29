/**
 * App — 生产入口（Issue #52）：轻量产品壳 + 同画布 Golden Path。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReasoningProvider } from "./store/reasoningStore";
import { validateInvestigationSnapshot, type InvestigationSnapshotV1 } from "./lib/investigation";
import { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot";
import { ProductShell } from "./goldenPath/ProductShell";
import { InputStage } from "./goldenPath/InputStage";
import { InvestigationCanvas } from "./goldenPath/InvestigationCanvas";
import { useInvestigationRun, type StartOptions } from "./goldenPath/useInvestigationRun";
import { gpCopyFor } from "./goldenPath/copy";
import { useUiLang } from "./lib/useUiLang";
import { LoginView } from "./components/v3/auth/LoginView";
import { AccountView } from "./components/v3/auth/AccountView";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import { caseIntakeFailedLinks, caseIntakePrimaryText, createCaseIntake, type CaseIntake } from "./lib/caseIntake";
import { homeCaseSnapshot, type HomeCaseId } from "./goldenPath/homeCases";
import { createKnowledgeBase, normalizeHistoryClaim } from "./lib/knowledgeBase";
import { composeFollowUpClaim, displayFollowUpClaim, previousAnswerText } from "./lib/composeFollowUpClaim";
import { visiblePriorRoundFromSnapshot } from "./lib/priorRoundBrief";
import type { InvestigationThread, InvestigationRound } from "./lib/investigationThread";
import { InvestigationThreadHeader } from "./goldenPath/InvestigationThreadHeader";
import {
  restoredThreadFields,
  snapshotFromReport,
  threadForRound,
  type ActiveCase,
  type ProductMode,
} from "./app/caseViews";
import { HISTORY_OPEN_FAILED_NOTICE, publicTransportError, TIMEOUT_PENDING_NOTICE } from "./app/notices";
import { writeRunPointer } from "./app/runPointer";
import { useAccountSession } from "./app/useAccountSession";
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sameClaim, setSameClaim] = useState<{ id: string; claim: string; at?: number; intake: CaseIntake } | null>(null);
  const run = useInvestigationRun();
  const [draftClaim, setDraftClaim] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ question: string; runId: string } | null>(null);

  const isModelSettingsPreviewRoute = import.meta.env.DEV && window.location.pathname === "/model-settings-preview";
  const isApiKeySettingsRoute = window.location.pathname === "/settings/api-key";

  // 账户与历史水合（挂载即跑一次；登录成功后再跑）。
  const { account, setAccount, accountEmailRef, scopeVersion, cases, setCases, historyReady, hydrateAccountCases } = useAccountSession();

  const { resumedRef } = useRunPointer({ historyReady, mode, active, run, accountEmailRef, copy, setActive, setMode, setHistoryNotice });

  // DEV 固定装置：/?fixture=investigating|judging|complete|conflict|interrupted|image-found|image-missing|mixed|nospan|settling|source-audit|replay
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

  // 完成：本地留存 +（已登录）服务端落库。保存失败不挡结果，但必须可见。
  const { saveStatus, setSaveStatus, retrySave } = useResultPersistence({
    mode,
    active,
    run,
    accountEmailRef,
    activeIdRef,
    copy,
    setCases,
    setActive,
    setHistoryNotice,
  });

  /** 无守卫直接开跑：同句守卫的「重新核查」与普通提交共用。 */
  const beginRun = useCallback(
    (
      intake: CaseIntake,
      fixture?: NonNullable<Parameters<ReturnType<typeof useInvestigationRun>["start"]>[1]>["fixture"],
      // 追问：登录带 caseId；访客带上一轮可见材料。首轮不传。
      followUp?: Pick<StartOptions, "priorCaseId" | "priorRound">,
      previousThread?: InvestigationThread,
      roundKind: InvestigationRound["kind"] = "initial",
    ) => {
      resumedRef.current = true;
      setSelectedRoundId(null);
      setPendingFocus(null);
      setSaveStatus("idle");
      setHistoryNotice("");
      setSameClaim(null);
      setDraftClaim("");
      const claim = caseIntakePrimaryText(intake);
      const localId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const thread = previousThread ?? { version: 1 as const, id: localId, originalClaim: claim, rounds: [] };
      setActive({ localId, roundId: localId, roundKind, claim, intake, thread });
      setCases((prev) => [{ id: localId, claim: thread.originalClaim, threadId: thread.id, roundCount: thread.rounds.length + 1, status: "running" as const }, ...prev.filter((item) => item.id !== localId && item.threadId !== thread.id)]);
      setMode("investigation");
      run.start(intake, {
        accountEmail: accountEmailRef.current,
        fixture,
        priorCaseId: followUp?.priorCaseId,
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

  const handleViewHomeCase = useCallback(
    (id: HomeCaseId) => {
      const opened = homeCaseSnapshot(id);
      if (!opened) return;
      run.reset();
      setSelectedRoundId(null);
      setSameClaim(null);
      setActive({
        localId: `home-${id}`,
        claim: opened.claim,
        intake: createCaseIntake(opened.claim, []),
        restored: { snapshot: opened.snapshot, report: null, at: opened.investigatedAt },
      });
      setMode("investigation");
    },
    [run]
  );

  const handleRecheckHomeCase = useCallback(
    (claim: string) => {
      beginRun(createCaseIntake(claim, []));
    },
    [beginRun]
  );

  const handleBackHome = useCallback(() => {
    // 从调查/旧报告返回首页时预填原句，方便改完再查（与旧壳一致）。
    setDraftClaim((prev) => active?.thread?.originalClaim ?? active?.claim ?? prev);
    setSelectedRoundId(null);
    setPendingFocus(null);
    run.reset();
    setActive(null);
    setMode("input");
  }, [active?.claim, run]);

  const handleRetry = useCallback(() => {
    if (!active) {
      handleBackHome();
      return;
    }
    const snapshot = active.restored?.snapshot ?? run.state.snapshot;
    beginRun(active.intake ?? createCaseIntake(active.claim, []), undefined, undefined,
      snapshot ? threadForRound(active, snapshot) : active.thread, "recheck");
  }, [active, beginRun, handleBackHome, run.state.snapshot]);

  const handleSelectCase = useCallback(
    async (id: string) => {
      const item = cases.find((entry) => entry.id === id);
      if (!item) return;
      setSelectedRoundId(null);
      setPendingFocus(null);
      // 本地在跑的那条：直接回到当前画布，不重新请求。
      if (item.status === "running" && active?.localId === id) {
        setMode("investigation");
        return;
      }
      const version = scopeVersion.current;
      // 1) 本地 KB 优先（匿名留存 / 登录后镜像）：零网络、零模型。
      try {
        const entry = await createKnowledgeBase(accountEmailRef.current).getCase(id);
        if (version !== scopeVersion.current) return;
        if (entry) {
          const snapshot = snapshotFromReport(entry.finalReport as Record<string, unknown>);
          if (snapshot) {
            run.reset();
            setActive({
              localId: id,
              claim: entry.claim,
              ...restoredThreadFields(entry.finalReport),
              intake: null,
              restored: { snapshot, report: entry.finalReport as Record<string, unknown>, at: entry.timestamp },
            });
            setMode("investigation");
            return;
          }
        }
      } catch {
        /* 本地未命中走服务端 */
      }
      // 2) 服务端旧调查（/api/case/:id 自带确定性重建的 investigation）。
      try {
        const res = await fetch(`/api/case/${encodeURIComponent(id)}`, { credentials: "include" });
        if (version !== scopeVersion.current) return;
        // 404/报错不能点了没反应：提示可见，条目状态不动（Change G）。
        if (!res.ok) {
          setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
          return;
        }
        const data = (await res.json()) as {
          claim?: string;
          report?: Record<string, unknown>;
          investigation?: InvestigationSnapshotV1;
          createdAt?: number;
        };
        let snapshot = data.investigation
          ? (() => {
              try {
                return validateInvestigationSnapshot(data.investigation);
              } catch {
                return undefined;
              }
            })()
          : snapshotFromReport(data.report);
        if (!snapshot) {
          // 无快照且重建失败：不伪造，保持原列表；但读不出内容同样是打开失败，要说出来。
          setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
          return;
        }
        run.reset();
        setActive({
          localId: id,
          claim: data.claim ?? item.claim,
          ...restoredThreadFields(data.report),
          intake: null,
          // 从服务端读回来的记录：分享的对象就是它。
          serverCaseId: id,
          restored: { snapshot, report: data.report ?? null, at: data.createdAt ?? item.createdAt },
        });
        setMode("investigation");
      } catch {
        // 网络中断/响应不可解析：同上，给反应而不是静默吞掉。
        setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
        return;
      }
    },
    [active?.localId, cases, lang, run]
  );

  const handleLogout = useCallback(async () => {
    const version = ++scopeVersion.current;
    try {
      const res = await fetch("/api/auth/email/logout", { method: "POST", credentials: "include" });
      if (!res.ok) {
        setHistoryNotice("退出失败，仍保留当前账户。请重试退出。");
        return;
      }
    } catch {
      setHistoryNotice("退出失败，仍保留当前账户。请重试退出。");
      return;
    }
    if (version !== scopeVersion.current) return;
    setAccount(null);
    accountEmailRef.current = null;
    run.reset();
    setActive(null);
    setSelectedRoundId(null);
    setPendingFocus(null);
    setMode("input");
    writeRunPointer(null);
    const local = await createKnowledgeBase(null).listCases();
    if (version !== scopeVersion.current) return;
    setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done" as const, createdAt: entry.timestamp, report: entry.finalReport as Record<string, unknown> })));
    setAccountOpen(false);
    setLoginOpen(false);
  }, []);

  const loginOverlay = loginOpen && !account ? (
    <div className="app-login-overlay">
      <LoginView
        onSuccess={() => {
          setLoginOpen(false);
          void hydrateAccountCases();
        }}
        onCancel={() => setLoginOpen(false)}
      />
    </div>
  ) : null;

  const accountOverlay = accountOpen && account ? (
    <div className="app-login-overlay">
      <AccountView
        account={account}
        onClose={() => setAccountOpen(false)}
        onSaved={setAccount}
        onDeleted={() => {
          setAccount(null);
          accountEmailRef.current = null;
          setAccountOpen(false);
          void createKnowledgeBase(null).listCases().then((local) => {
            setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done" as const, createdAt: entry.timestamp })));
          });
        }}
      />
    </div>
  ) : null;

  useEffect(() => {
    if (!pendingFocus || pendingFocus.runId !== run.state.runId) return;
    if (!["cancelled", "completed", "interrupted"].includes(run.state.serverStatus ?? "")) return;
    setPendingFocus(null);
    handleFollowUp(pendingFocus.question);
    // A focus change waits for the server terminal state, never just the POST acknowledgement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, run.state.runId, run.state.serverStatus]);

  if (isModelSettingsPreviewRoute) {
    return <ModelProviderSettingsPreview />;
  }
  if (isApiKeySettingsRoute) {
    return <ApiKeySettings />;
  }
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
        active.serverCaseId
          ? { priorCaseId: active.serverCaseId }
          : { priorRound: visiblePriorRoundFromSnapshot(snapshot) },
        snapshot ? threadForRound(active, snapshot) : active.thread,
        "follow-up",
      );
  }

  const archivedRound = selectedRoundId ? active?.thread?.rounds.find((round) => round.id === selectedRoundId) : undefined;
  const displaySnapshot = archivedRound?.snapshot ?? snapshot;
  const adjustFocus = (question: string) => {
    if (active?.restored || snapshot?.phase === "complete" || run.state.connection === "ended" || run.state.connection === "failed") {
      handleFollowUp(question);
      return;
    }
    if (!run.state.runId || pendingFocus) return;
    setPendingFocus({ question, runId: run.state.runId });
    void run.cancel().then((result) => {
      if (!result.ok) {
        setPendingFocus(null);
        setHistoryNotice("停止请求未送达，尚未开始按新重点核查。");
      }
    });
  };

  return (
    <>
      <ProductShell
        cases={cases}
        activeCaseId={active?.localId ?? null}
        historyReady={historyReady}
        onNewCase={handleBackHome}
        onSelectCase={(id) => void handleSelectCase(id)}
        account={account}
        onLoginClick={() => setLoginOpen(true)}
        onAccountClick={() => setAccountOpen(true)}
        onLogout={() => void handleLogout()}
        viewingInvestigation={mode === "investigation"}
      >
        {showLinkUnreachable ? (
          <p className="gp-global-notice" role="alert">
            {copy.linkUnreachableNotice}
          </p>
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
              accountEmail={account?.email ?? null}
              onNeedLogin={() => setLoginOpen(true)}
              onViewHomeCase={handleViewHomeCase}
              onRecheckHomeCase={handleRecheckHomeCase}
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
              onAdjustFocus={archivedRound ? undefined : adjustFocus}
              adjustingFocus={Boolean(pendingFocus)}
              live={archivedRound || active.restored ? false : run.state.connection === "connecting" || run.state.connection === "live"}
              activities={archivedRound || active.restored ? [] : run.state.activities}
              stop={archivedRound || active.restored ? "idle" : run.state.stop}
              onStop={archivedRound || active.restored || !run.state.runId ? undefined : () => void run.cancel()}
              saveStatus={saveStatus}
              onRetrySave={retrySave}
              shareCaseId={archivedRound ? null : active.serverCaseId ?? null}
              finalReport={archivedRound ? null : active.restored ? active.restored.report : run.state.finalReport}
              restoredAt={active.restored?.at}
              onReverify={handleRetry}
              onBackHome={handleBackHome}
              onFollowUp={archivedRound ? undefined : handleFollowUp}
              linkUnreachable={caseIntakeFailedLinks(active.intake).length > 0}
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
      {loginOverlay}
      {accountOverlay}
    </>
  );
}

export default function App() {
  return (
    <ReasoningProvider>
      <ProductApp />
    </ReasoningProvider>
  );
}
