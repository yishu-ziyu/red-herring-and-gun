import { useEffect, useState, useCallback, useRef } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { AppShell, type DeskCase } from "./components/v3/AppShell";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { ResultView } from "./components/v3/phases/ResultView";
import { EvidenceMatrixDemoPage } from "./components/v3/EvidenceMatrixDemoPage";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import { MissionShellPreview } from "./components/v3/phases/mission/MissionShellPreview";
import { LoginView } from "./components/v3/auth/LoginView";
import { AccountView } from "./components/v3/auth/AccountView";
import type { AccountProfile } from "./components/v3/auth/accountTypes";
import { accountDisplayName } from "./lib/accountIdentity";
import { caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import type { ModelChoiceMap } from "./components/v3/ModelPicker";

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

  // Demo route
  const isDemoRoute = window.location.pathname === "/demo";
  const isModelSettingsPreviewRoute = import.meta.env.DEV && window.location.pathname === "/model-settings-preview";
  const isApiKeySettingsRoute = window.location.pathname === "/settings/api-key";
  // Phase 0/1 shell preview (fixture-driven ThoughtChain-like process UI)
  const isShellPreviewRoute =
    window.location.pathname === "/shell-preview" ||
    new URLSearchParams(window.location.search).get("shellPreview") === "1";
  // DEV: formal result page with numbered citations (no full pipeline needed)
  const isResultPreviewRoute =
    import.meta.env.DEV &&
    (window.location.pathname === "/result-preview" ||
      new URLSearchParams(window.location.search).get("resultPreview") === "1");

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
    setArtifactOpen(true);
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
        if (!res.ok) return;
        const data = (await res.json()) as { caseId?: string };
        if (!data.caseId) return;
        setCases((prev) =>
          prev.map((item) => (item.id === localId ? { ...item, id: data.caseId as string, report: finalReport } : item))
        );
        setActiveCaseId((current) => (current === localId ? data.caseId ?? current : current));
      } catch {
        // 记住失败不挡当前判断
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

  if (isDemoRoute) {
    return <EvidenceMatrixDemoPage />;
  }

  if (isShellPreviewRoute) {
    return <MissionShellPreview />;
  }

  if (isResultPreviewRoute) {
    return (
      <ResultView
        claim="Transformers 随数据与算力扩展良好，但注意力机制对序列长度是二次复杂度。"
        finalReport={{
          verdictType: "mixed_misleading",
          faceVerdict: "只能信一部分",
          credibilityLabel: "部分可信",
          credibilityScore: 72,
          conclusion:
            "只能信一部分。这句话同时断言扩展规律和注意力复杂度。公开文献分别支撑这两点[1][2]。不能推出所有长文本任务都会失败。",
          recommendation: "只能信一部分。",
          claimItems: [
            {
              text: "Transformers 随数据与算力扩展良好",
              verifiable: true,
              type: "fact",
              verdict: {
                claimAtom: "Transformers 随数据与算力扩展良好",
                verdict: "true",
                evidence: "缩放规律在公开研究中有系统支持[1]。",
                boundary: "不能推出任意任务都单调提升。",
                supportingSources: [
                  {
                    title: "Attention Is All You Need",
                    url: "https://arxiv.org/abs/1706.03762",
                    snippet: "Transformer architecture and scaling discussion.",
                  },
                ],
              },
            },
            {
              text: "不应该盲目堆模型",
              verifiable: false,
              type: "value",
            },
            {
              text: "注意力机制对序列长度是二次复杂度",
              verifiable: true,
              type: "fact",
              verdict: {
                claimAtom: "注意力机制对序列长度是二次复杂度",
                verdict: "true",
                evidence: "标准 self-attention 对序列长度呈二次复杂度[1]。",
                boundary: "线性注意力等变体不在此断言范围。",
                supportingSources: [
                  {
                    title: "Efficient Transformers: A Survey",
                    url: "https://arxiv.org/abs/2009.06732",
                    snippet: "Survey of efficient attention and complexity.",
                  },
                ],
              },
            },
            {
              text: "因此它导致所有长文本任务都会失败",
              verifiable: true,
              type: "causal",
              verdict: {
                claimAtom: "因此它导致所有长文本任务都会失败",
                verdict: "unverified",
                evidenceGaps: ["检索预算未覆盖"],
              },
            },
          ],
          subclaimVerdicts: [
            {
              claimAtom: "Transformers 随数据与算力扩展良好",
              verdict: "true",
              evidence: "缩放规律在公开研究中有系统支持[1]。",
              boundary: "不能推出任意任务都单调提升。",
              supportingSources: [
                {
                  title: "Attention Is All You Need",
                  url: "https://arxiv.org/abs/1706.03762",
                  snippet: "Transformer architecture and scaling discussion.",
                },
              ],
              contradictingSources: [],
              evidenceGaps: [],
              sourcesRelatedOnly: false,
            },
            {
              claimAtom: "注意力机制对序列长度是二次复杂度",
              verdict: "true",
              evidence: "标准 self-attention 对序列长度呈二次复杂度[1]。",
              boundary: "线性注意力等变体不在此断言范围。",
              supportingSources: [
                {
                  title: "Efficient Transformers: A Survey",
                  url: "https://arxiv.org/abs/2009.06732",
                  snippet: "Survey of efficient attention and complexity.",
                },
              ],
              contradictingSources: [],
              evidenceGaps: [],
              sourcesRelatedOnly: false,
            },
          ],
          citationSources: [
            {
              title: "Attention Is All You Need",
              url: "https://arxiv.org/abs/1706.03762",
              snippet: "Transformer architecture and scaling discussion.",
            },
            {
              title: "Efficient Transformers: A Survey",
              url: "https://arxiv.org/abs/2009.06732",
              snippet: "Survey of efficient attention and complexity.",
            },
          ],
          evidenceChain: [
            {
              layer: "文献",
              finding: "扩展与复杂度是两条可独立核查的论断",
              evidence: "两篇 arXiv 文献分别支撑扩展性与复杂度主张[1][2]。",
              boundary: "不能用一篇综述代替具体任务的实测。",
              sourceRefs: [
                "https://arxiv.org/abs/1706.03762",
                "https://arxiv.org/abs/2009.06732",
              ],
              _citeSources: [
                {
                  title: "Attention Is All You Need",
                  url: "https://arxiv.org/abs/1706.03762",
                  snippet: "Transformer architecture and scaling discussion.",
                },
                {
                  title: "Efficient Transformers: A Survey",
                  url: "https://arxiv.org/abs/2009.06732",
                  snippet: "Survey of efficient attention and complexity.",
                },
              ],
            },
          ],
        }}
        onBack={() => {
          window.location.href = "/";
        }}
        onReverify={() => {
          window.location.href = "/";
        }}
      />
    );
  }

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
      artifactTitle={activeClaim || "核查卷宗"}
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
