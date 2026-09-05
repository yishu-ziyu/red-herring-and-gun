import { lazy, Suspense, useEffect, useState, useCallback, useRef } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { AppShell, type DeskCase } from "./components/v3/AppShell";
import { Dashboard } from "./components/v3/Dashboard";
import { ResultView } from "./components/v3/phases/ResultView";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import { LoginView } from "./components/v3/auth/LoginView";
import { AccountView } from "./components/v3/auth/AccountView";
import type { AccountProfile } from "./components/v3/auth/accountTypes";
import { accountDisplayName } from "./lib/accountIdentity";
import { caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import type { ModelChoiceMap } from "./lib/agentExpansion";
import { createKnowledgeBase, normalizeHistoryClaim } from "./lib/knowledgeBase";

let missionControlViewPromise: Promise<
  typeof import("./components/v3/phases/MissionControlView")
> | null = null;

function loadMissionControlView() {
  missionControlViewPromise ??= import("./components/v3/phases/MissionControlView");
  return missionControlViewPromise;
}

const MissionControlView = lazy(() =>
  loadMissionControlView().then((module) => ({ default: module.MissionControlView }))
);

type AppPhase = "input" | "executing";

type ServerCaseItem = {
  caseId: string;
  claim: string;
  status?: "done" | "interrupted";
  createdAt?: number;
};

type HistoryCase = DeskCase & { timestamp?: number };

function deskCasesFromServer(items: ServerCaseItem[]): HistoryCase[] {
  return items.map((item) => ({
    id: item.caseId,
    claim: item.claim,
    status: item.status === "interrupted" ? "interrupted" : "done",
    timestamp: item.createdAt,
  }));
}

function AppContent() {
  const [appPhase, setAppPhase] = useState<AppPhase>("input");
  const [renderedPhase, setRenderedPhase] = useState<AppPhase>("input");
  const [phaseClassName, setPhaseClassName] = useState("phase-enter");
  const [activeClaim, setActiveClaim] = useState("");
  const [activeIntake, setActiveIntake] = useState<CaseIntake | null>(null);
  const [activeModelChoice, setActiveModelChoice] = useState<ModelChoiceMap>({});
  const [activeFinalReport, setActiveFinalReport] = useState<Record<string, unknown> | null>(null);
  const [executionNonce, setExecutionNonce] = useState(0);
  const [cases, setCases] = useState<HistoryCase[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | undefined>();
  const [pendingHistory, setPendingHistory] = useState<{ item: HistoryCase; intake: CaseIntake; modelChoice: ModelChoiceMap } | null>(null);
  const scopeVersion = useRef(0);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [restoredReport, setRestoredReport] = useState<Record<string, unknown> | null>(null);
  const persistOnCompleteRef = useRef(true);
  const accountEmailRef = useRef<string | null>(null);
  const { dispatch, setMemoryScope, memoryNotice } = useReasoning();

  const resetWorkspace = useCallback(() => {
    setMemoryScope(undefined);
    dispatch({ type: "RESET" });
    setCases([]);
    setActiveClaim("");
    setActiveIntake(null);
    setActiveFinalReport(null);
    setRestoredReport(null);
    setRestoredAt(undefined);
    setPendingHistory(null);
    setHistoryNotice("");
    setActiveCaseId(null);
    setArtifactOpen(false);
    setAppPhase("input");
    setRenderedPhase("input");
    setExecutionNonce((n) => n + 1);
  }, [dispatch, setMemoryScope]);

  const isModelSettingsPreviewRoute = import.meta.env.DEV && window.location.pathname === "/model-settings-preview";
  const isApiKeySettingsRoute = window.location.pathname === "/settings/api-key";

  useEffect(() => {
    if (appPhase === renderedPhase) return;

    setPhaseClassName("phase-exit");
    const timer = window.setTimeout(() => {
      setRenderedPhase(appPhase);
      setPhaseClassName("phase-enter");
    }, 300);

    return () => window.clearTimeout(timer);
  }, [appPhase, renderedPhase]);

  // 注意：这里刻意不用 AbortSignal——Chrome 会把被中止的在途 fetch 记成
  // net::ERR_ABORTED 控制台错误（StrictMode 双挂载每次必触发）。/me 与 /cases
  // 都是幂等 GET，让它自然完成即可，重复结果幂等。
  const hydrateAccountCases = useCallback(async () => {
    const version = ++scopeVersion.current;
    setHistoryReady(false);
    resetWorkspace();
    setAccount(null);
    accountEmailRef.current = null;
    try {
      const me = await fetch("/api/auth/email/me", { credentials: "include" });
      if (version !== scopeVersion.current) return;
      if (!me.ok) {
        setAccount(null);
        accountEmailRef.current = null;
        return;
      }
      const data = (await me.json()) as Partial<AccountProfile> & { authenticated?: boolean; email?: string };
      if (version !== scopeVersion.current) return;
      if (!data.authenticated || typeof data.email !== "string") {
        setAccount(null);
        accountEmailRef.current = null;
        if (data.authenticated === false) setMemoryScope(null);
        return;
      }
      setAccount({
        email: data.email,
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        name: typeof data.name === "string" ? data.name : accountDisplayName(data.email, data.displayName),
        createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
        loginCount: typeof data.loginCount === "number" ? data.loginCount : 1,
        lastLoginAt: typeof data.lastLoginAt === "number" ? data.lastLoginAt : Date.now(),
      });
      accountEmailRef.current = data.email;
      setMemoryScope(data.email);
      const listRes = await fetch("/api/cases", { credentials: "include" });
      if (!listRes.ok) return;
      const list = (await listRes.json()) as { cases?: ServerCaseItem[] };
      if (version !== scopeVersion.current) return;
      const fromServer = deskCasesFromServer(Array.isArray(list.cases) ? list.cases : []);
      setCases((prev) => {
        const running = prev.filter((item) => item.status === "running");
        const runningIds = new Set(running.map((item) => item.id));
        return [...running, ...fromServer.filter((item) => !runningIds.has(item.id))];
      });
    } catch {
      // 保留已确认的账户作用域；列表故障不降级为匿名。
    } finally {
      if (version === scopeVersion.current) {
        const local = await createKnowledgeBase(accountEmailRef.current).listCases();
        if (version === scopeVersion.current) {
          setCases((prev) => [...local.map((entry): HistoryCase => ({ id: entry.id, claim: entry.claim, status: "done", report: entry.finalReport as Record<string, unknown>, timestamp: entry.timestamp })), ...prev.filter((entry) => !local.some((saved) => saved.id === entry.id))]);
          setHistoryReady(true);
        }
      }
    }
  }, [resetWorkspace, setMemoryScope]);

  useEffect(() => {
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  const handleStartAnalysis = useCallback(
    (intake: CaseIntake, modelChoice: ModelChoiceMap, force = false) => {
      if (!historyReady) return;
      const match = intake.links.length || intake.images.length ? undefined : cases.find((item) => item.status === "done" && normalizeHistoryClaim(item.claim) === normalizeHistoryClaim(caseIntakePrimaryText(intake)));
      if (match && !force) {
        setPendingHistory({ item: match, intake, modelChoice });
        return;
      }
      setPendingHistory(null);
      setHistoryNotice("");
      void loadMissionControlView();
      dispatch({ type: "RESET" });
      persistOnCompleteRef.current = true;
      const claim = caseIntakePrimaryText(intake);
      setActiveClaim(claim);
      setActiveIntake(intake);
      setActiveModelChoice(modelChoice);
      setActiveFinalReport(null);
      setRestoredReport(null);
      setRestoredAt(undefined);
      const id = `case-${Date.now()}`;
      setCases((prev) => [{ id, claim, status: "running" }, ...prev]);
      setActiveCaseId(id);
      setArtifactOpen(false);
      setExecutionNonce((n) => n + 1);
      setAppPhase("executing");
    },
    [dispatch, cases, historyReady]
  );

  const handleCancelExecution = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setActiveIntake(null);
    setActiveModelChoice({});
    setActiveFinalReport(null);
    setRestoredReport(null);
    setActiveCaseId(null);
    setArtifactOpen(false);
    setAppPhase("input");
  }, [dispatch]);

  const handleRetryExecution = useCallback(() => {
    dispatch({ type: "RESET" });
    persistOnCompleteRef.current = true;
    setActiveFinalReport(null);
    setRestoredReport(null);
    setExecutionNonce((n) => n + 1);
  }, [dispatch]);

  const handleExecutionComplete = useCallback((finalReport: Record<string, unknown>) => {
    const version = scopeVersion.current;
    const localId = activeCaseId;
    const shouldPersist = persistOnCompleteRef.current && Boolean(accountEmailRef.current);
    setActiveFinalReport(finalReport);
    const status = finalReport._source === "error-boundary" ? "interrupted" : "done";
    setCases((prev) =>
      prev.map((item) => (item.id === localId ? { ...item, status, report: finalReport, timestamp: item.timestamp ?? Date.now() } : item))
    );
    if (!shouldPersist || !localId) return;
    void (async () => {
      try {
        const res = await fetch("/api/case", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim: activeClaim,
            report: finalReport,
            credibilityScore: typeof finalReport.credibilityScore === "number" ? finalReport.credibilityScore : 50,
          }),
        });
        if (!res.ok) {
          // F2：不挡当前判断，但要留现场——否则登录用户的案例刷新后凭空消失无从排查
          console.error(`[cases] 服务端存档失败 HTTP ${res.status}`);
          if (version === scopeVersion.current) setHistoryNotice("账户历史同步失败，暂时无法跨设备找回。");
          return;
        }
        const data = (await res.json()) as { caseId?: string };
        if (version !== scopeVersion.current) return;
        if (!data.caseId) return;
        const knowledgeBase = createKnowledgeBase(accountEmailRef.current);
        const saved = await knowledgeBase.getCase(localId);
        if (version !== scopeVersion.current) return;
        if (saved) await knowledgeBase.saveCase({ ...saved, id: data.caseId });
        if (version !== scopeVersion.current) return;
        setCases((prev) =>
          prev.map((item) => (item.id === localId ? { ...item, id: data.caseId as string, report: finalReport } : item))
        );
        setActiveCaseId((current) => (current === localId ? data.caseId ?? current : current));
      } catch (error) {
        // 记住失败不挡当前判断（F2：留现场）
        console.error("[cases] 服务端存档异常", error);
        if (version === scopeVersion.current) setHistoryNotice("账户历史同步失败，暂时无法跨设备找回。");
      }
    })();
  }, [activeCaseId, activeClaim]);

  const handleSelectCase = useCallback(
    async (id: string) => {
      const version = scopeVersion.current;
      setActiveCaseId(id);
      const item = cases.find((entry) => entry.id === id);
      if (!item || item.status === "running") return;
      persistOnCompleteRef.current = false;
      let report = item.report ?? null;
      if (!report) {
        try {
          const res = await fetch(`/api/case/${encodeURIComponent(id)}`, { credentials: "include" });
          if (res.ok) {
            const data = (await res.json()) as { report?: Record<string, unknown> };
            if (version !== scopeVersion.current) return;
            report = data.report ?? null;
            if (report) {
              setCases((prev) => prev.map((entry) => (entry.id === id ? { ...entry, report } : entry)));
            }
          }
        } catch {
          return;
        }
      }
      if (!report) return;
      if (version !== scopeVersion.current) return;
      dispatch({ type: "RESET" });
      setActiveClaim(item.claim);
      setActiveIntake(null);
      setActiveFinalReport(report);
      setRestoredReport(report);
      setRestoredAt(item.timestamp);
      setPendingHistory(null);
      setArtifactOpen(true);
      setExecutionNonce((n) => n + 1);
      void loadMissionControlView();
      setAppPhase("executing");
    },
    [cases, dispatch]
  );

  const handleLoginSuccess = useCallback(() => {
    setLoginOpen(false);
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  const handleLogout = useCallback(async () => {
    const version = ++scopeVersion.current;
    const previousCases = cases;
    setHistoryReady(false);
    resetWorkspace();
    try {
      const res = await fetch("/api/auth/email/logout", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("退出请求失败");
    } catch {
      if (version !== scopeVersion.current) return;
      setMemoryScope(accountEmailRef.current);
      setCases(previousCases.map((item) => item.status === "running" ? { ...item, status: "interrupted" } : item));
      setHistoryNotice("退出失败，仍保留当前账户。请重试退出。");
      setHistoryReady(true);
      return;
    }
    if (version !== scopeVersion.current) return;
    setAccount(null);
    accountEmailRef.current = null;
    setMemoryScope(null);
    const local = await createKnowledgeBase(null).listCases();
    if (version !== scopeVersion.current) return;
    setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done", report: entry.finalReport as Record<string, unknown>, timestamp: entry.timestamp })));
    setHistoryReady(true);
    setAccountOpen(false);
    setLoginOpen(false);
  }, [resetWorkspace, cases, setMemoryScope]);

  // 重新核查：回 input 并预填 claim，方便用户改完再发起（不直接 re-executing）
  const handleReverify = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveFinalReport(null);
    setRestoredReport(null);
    setArtifactOpen(false);
    setAppPhase("input");
  }, [dispatch]);

  const handleBackFromResult = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setActiveIntake(null);
    setActiveModelChoice({});
    setActiveFinalReport(null);
    setRestoredReport(null);
    setArtifactOpen(false);
    setAppPhase("input");
  }, [dispatch]);

  if (isModelSettingsPreviewRoute) {
    return <ModelProviderSettingsPreview />;
  }

  if (isApiKeySettingsRoute) {
    return <ApiKeySettings />;
  }

  return (
    <>
    <AppShell
      cases={cases}
      activeCaseId={activeCaseId}
      onNewCase={handleCancelExecution}
      onSelectCase={(id) => {
        void handleSelectCase(id);
      }}
      artifactTitle={activeClaim}
      artifactOpen={artifactOpen}
      onArtifactOpenChange={setArtifactOpen}
      artifact={
        activeFinalReport ? (
          <ResultView
            accountEmail={account?.email ?? null}
            variant="dossier"
            claim={activeClaim}
            finalReport={activeFinalReport}
            onBack={handleBackFromResult}
            onCancel={handleBackFromResult}
            onReverify={handleReverify}
          />
        ) : undefined
      }
      account={account}
      onLoginClick={() => setLoginOpen(true)}
      onAccountClick={() => setAccountOpen(true)}
      onLogout={() => {
        void handleLogout();
      }}
    >
      <div className={`app-phase-shell ${phaseClassName}`}>
        {historyNotice && <p role="alert">{historyNotice}</p>}
        {memoryNotice && <p role="alert">{memoryNotice}</p>}
        {restoredReport && <p role="status">原调查时间：{restoredAt ? new Date(restoredAt).toLocaleString("zh-CN") : "旧记录未保存时间"}。本次未重新核查。<button type="button" onClick={handleReverify}>重新核查</button></p>}
        {pendingHistory && <section aria-label="已有相同原句的调查">
          <p>{pendingHistory.item.claim}</p>
          <p>调查时间：{pendingHistory.item.timestamp ? new Date(pendingHistory.item.timestamp).toLocaleString("zh-CN") : "旧记录未保存时间"}。是否打开旧调查？</p>
          <button type="button" onClick={() => void handleSelectCase(pendingHistory.item.id)}>打开旧调查</button>
          <button type="button" onClick={() => handleStartAnalysis(pendingHistory.intake, pendingHistory.modelChoice, true)}>重新核查</button>
          <button type="button" onClick={() => setPendingHistory(null)}>取消</button>
        </section>}
        {!historyReady && <p role="status">正在读取调查历史…</p>}
        {renderedPhase === "input" ? (
          <fieldset disabled={!historyReady} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Dashboard
            onStartAnalysis={handleStartAnalysis}
            initialClaim={activeClaim}
            accountEmail={account?.email ?? null}
            onNeedLogin={() => setLoginOpen(true)}
          />
          </fieldset>
        ) : (
          <Suspense
            fallback={
              <div
                role="status"
                style={{
                  display: "grid",
                  minHeight: 240,
                  placeItems: "center",
                  color: "#77736b",
                  fontSize: 14,
                }}
              >
                正在打开核查工作台…
              </div>
            }
          >
            <MissionControlView
              key={executionNonce}
              claim={activeClaim}
              intake={activeIntake}
              onCancel={handleCancelExecution}
              onRetry={handleRetryExecution}
              onComplete={handleExecutionComplete}
              modelChoice={activeModelChoice}
              initialFinalReport={restoredReport}
              accountEmail={account?.email ?? null}
              caseId={activeCaseId}
            />
          </Suspense>
        )}
      </div>
    </AppShell>
      {loginOpen && !account ? (
        <div className="app-login-overlay">
          <LoginView onSuccess={handleLoginSuccess} onCancel={() => setLoginOpen(false)} />
        </div>
      ) : null}
      {accountOpen && account ? (
        <div className="app-login-overlay">
          <AccountView
            account={account}
            onClose={() => setAccountOpen(false)}
            onSaved={setAccount}
            onDeleted={() => {
              const version = ++scopeVersion.current;
              setHistoryReady(false);
              resetWorkspace();
              accountEmailRef.current = null;
              setMemoryScope(null);
              setAccount(null);
              setAccountOpen(false);
              void createKnowledgeBase(null).listCases().then((local) => {
                if (version !== scopeVersion.current) return;
                setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done", report: entry.finalReport as Record<string, unknown>, timestamp: entry.timestamp })));
                setHistoryReady(true);
              });
            }}
          />
        </div>
      ) : null}
    </>
  );
}

export default function App() {
  return (
    <ReasoningProvider>
      <AppContent />
    </ReasoningProvider>
  );
}
