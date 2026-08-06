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
          showUtilityMenu={import.meta.env.DEV}
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
          showUtilityMenu={import.meta.env.DEV}
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
