import { useEffect, useState, useCallback, useRef } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { AppShell, type DeskCase } from "./components/v3/AppShell";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { ResultView } from "./components/v3/phases/ResultView";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import { LoginView } from "./components/v3/auth/LoginView";
import { AccountView } from "./components/v3/auth/AccountView";
import type { AccountProfile } from "./components/v3/auth/accountTypes";
import { accountDisplayName } from "./lib/accountIdentity";
import { caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import type { ModelChoiceMap } from "./lib/agentExpansion";

type AppPhase = "input" | "executing";

type ServerCaseItem = {
  caseId: string;
  claim: string;
  status?: "done" | "interrupted";
};

function deskCasesFromServer(items: ServerCaseItem[]): DeskCase[] {
  return items.map((item) => ({
    id: item.caseId,
    claim: item.claim,
    status: item.status === "interrupted" ? "interrupted" : "done",
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
  const [cases, setCases] = useState<DeskCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [restoredReport, setRestoredReport] = useState<Record<string, unknown> | null>(null);
  const persistOnCompleteRef = useRef(true);
  const accountEmailRef = useRef<string | null>(null);
  const { dispatch } = useReasoning();
  accountEmailRef.current = account?.email ?? null;

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
    try {
      const me = await fetch("/api/auth/email/me", { credentials: "include" });
      if (!me.ok) {
        setAccount(null);
        return;
      }
      const data = (await me.json()) as Partial<AccountProfile> & { authenticated?: boolean; email?: string };
      if (!data.authenticated || typeof data.email !== "string") {
        setAccount(null);
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
      const listRes = await fetch("/api/cases", { credentials: "include" });
      if (!listRes.ok) return;
      const list = (await listRes.json()) as { cases?: ServerCaseItem[] };
      const fromServer = deskCasesFromServer(Array.isArray(list.cases) ? list.cases : []);
      setCases((prev) => {
        const running = prev.filter((item) => item.status === "running");
        const runningIds = new Set(running.map((item) => item.id));
        return [...running, ...fromServer.filter((item) => !runningIds.has(item.id))];
      });
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  const handleStartAnalysis = useCallback(
    (intake: CaseIntake, modelChoice: ModelChoiceMap) => {
      dispatch({ type: "RESET" });
      persistOnCompleteRef.current = true;
      const claim = caseIntakePrimaryText(intake);
      setActiveClaim(claim);
      setActiveIntake(intake);
      setActiveModelChoice(modelChoice);
      setActiveFinalReport(null);
      setRestoredReport(null);
      const id = `case-${Date.now()}`;
      setCases((prev) => [{ id, claim, status: "running" }, ...prev]);
      setActiveCaseId(id);
      setArtifactOpen(false);
      setExecutionNonce((n) => n + 1);
      setAppPhase("executing");
    },
    [dispatch]
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
    const localId = activeCaseId;
    const shouldPersist = persistOnCompleteRef.current && Boolean(accountEmailRef.current);
    setActiveFinalReport(finalReport);
    const status = finalReport._source === "error-boundary" ? "interrupted" : "done";
    setCases((prev) =>
      prev.map((item) => (item.id === localId ? { ...item, status, report: finalReport } : item))
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
          return;
        }
        const data = (await res.json()) as { caseId?: string };
        if (!data.caseId) return;
        setCases((prev) =>
          prev.map((item) => (item.id === localId ? { ...item, id: data.caseId as string, report: finalReport } : item))
        );
        setActiveCaseId((current) => (current === localId ? data.caseId ?? current : current));
      } catch (error) {
        // 记住失败不挡当前判断（F2：留现场）
        console.error("[cases] 服务端存档异常", error);
      }
    })();
  }, [activeCaseId, activeClaim]);

  const handleSelectCase = useCallback(
    async (id: string) => {
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
      dispatch({ type: "RESET" });
      setActiveClaim(item.claim);
      setActiveIntake(null);
      setActiveFinalReport(report);
      setRestoredReport(report);
      setArtifactOpen(true);
      setExecutionNonce((n) => n + 1);
      setAppPhase("executing");
    },
    [cases, dispatch]
  );

  const handleLoginSuccess = useCallback(() => {
    setLoginOpen(false);
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/email/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setAccount(null);
    setAccountOpen(false);
    setLoginOpen(false);
  }, []);

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
        {renderedPhase === "input" ? (
          <Dashboard
            onStartAnalysis={handleStartAnalysis}
            initialClaim={activeClaim}
            accountEmail={account?.email ?? null}
            onNeedLogin={() => setLoginOpen(true)}
          />
        ) : (
          <MissionControlView
            key={executionNonce}
            claim={activeClaim}
            intake={activeIntake}
            onCancel={handleCancelExecution}
            onRetry={handleRetryExecution}
            onComplete={handleExecutionComplete}
            modelChoice={activeModelChoice}
            initialFinalReport={restoredReport}
          />
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
              setAccount(null);
              setAccountOpen(false);
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
