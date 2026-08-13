import { useEffect, useState, useCallback } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { ResultView } from "./components/v3/phases/ResultView";
import { EvidenceMatrixDemoPage } from "./components/v3/EvidenceMatrixDemoPage";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import { MissionShellPreview } from "./components/v3/phases/mission/MissionShellPreview";
import { caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import type { ModelChoiceMap } from "./components/v3/ModelPicker";

type AppPhase = "input" | "executing" | "result";

function AppContent() {
  const [appPhase, setAppPhase] = useState<AppPhase>("input");
  const [renderedPhase, setRenderedPhase] = useState<AppPhase>("input");
  const [phaseClassName, setPhaseClassName] = useState("phase-enter");
  const [activeClaim, setActiveClaim] = useState("");
  const [activeIntake, setActiveIntake] = useState<CaseIntake | null>(null);
  const [activeModelChoice, setActiveModelChoice] = useState<ModelChoiceMap>({});
  const [activeFinalReport, setActiveFinalReport] = useState<Record<string, unknown> | null>(null);
  const { dispatch } = useReasoning();

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

  const handleStartAnalysis = useCallback(
    (intake: CaseIntake, modelChoice: ModelChoiceMap) => {
      dispatch({ type: "RESET" });
      const claim = caseIntakePrimaryText(intake);
      setActiveClaim(claim);
      setActiveIntake(intake);
      setActiveModelChoice(modelChoice);
      setActiveFinalReport(null);
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
    setAppPhase("input");
  }, [dispatch]);

  const handleExecutionComplete = useCallback((finalReport: Record<string, unknown>) => {
    setActiveFinalReport(finalReport);
    setAppPhase("result");
  }, []);

  // 重新核查：回 input 并预填 claim，方便用户改完再发起（不直接 re-executing）
  const handleReverify = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveFinalReport(null);
    setAppPhase("input");
  }, [dispatch]);

  const handleBackFromResult = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setActiveIntake(null);
    setActiveModelChoice({});
    setActiveFinalReport(null);
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
          verdictType: "partial",
          credibilityLabel: "部分可信",
          credibilityScore: 72,
          conclusion:
            "Transformers 随数据与算力扩展良好[1]，但注意力机制对序列长度是二次复杂度[2]。",
          recommendation: "引用时区分扩展规律与复杂度瓶颈，不要混为一谈。",
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
    <div className={`app-phase-shell ${phaseClassName}`}>
      {renderedPhase === "input" ? (
        <Dashboard
          onStartAnalysis={handleStartAnalysis}
          initialClaim={activeClaim}
        />
      ) : renderedPhase === "executing" ? (
        <MissionControlView
          claim={activeClaim}
          intake={activeIntake}
          onCancel={handleCancelExecution}
          onComplete={handleExecutionComplete}
          modelChoice={activeModelChoice}
        />
      ) : activeFinalReport ? (
        <ResultView
          claim={activeClaim}
          finalReport={activeFinalReport}
          onBack={handleBackFromResult}
          onCancel={handleBackFromResult}
          onReverify={handleReverify}
        />
      ) : (
        <Dashboard
          onStartAnalysis={handleStartAnalysis}
          initialClaim={activeClaim}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReasoningProvider>
      <AppContent />
    </ReasoningProvider>
  );
}
