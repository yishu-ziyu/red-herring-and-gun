import { useEffect, useState, useCallback } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { EvidenceMatrixDemoPage } from "./components/v3/EvidenceMatrixDemoPage";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import type { ModelChoiceMap } from "./components/v3/ModelPicker";

type AppPhase = "input" | "executing";

function AppContent() {
  const [appPhase, setAppPhase] = useState<AppPhase>("input");
  const [renderedPhase, setRenderedPhase] = useState<AppPhase>("input");
  const [phaseClassName, setPhaseClassName] = useState("phase-enter");
  const [activeClaim, setActiveClaim] = useState("");
  const [activeIntake, setActiveIntake] = useState<CaseIntake | null>(null);
  const [activeModelChoice, setActiveModelChoice] = useState<ModelChoiceMap>({});
  const { dispatch } = useReasoning();

  // Demo route
  const isDemoRoute = window.location.pathname === "/demo";
  const isModelSettingsPreviewRoute = import.meta.env.DEV && window.location.pathname === "/model-settings-preview";

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
      setAppPhase("executing");
    },
    [dispatch]
  );

  const handleCancelExecution = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setActiveIntake(null);
    setActiveModelChoice({});
    setAppPhase("input");
  }, [dispatch]);

  if (isDemoRoute) {
    return <EvidenceMatrixDemoPage />;
  }

  if (isModelSettingsPreviewRoute) {
    return <ModelProviderSettingsPreview />;
  }

  return (
    <div className={`app-phase-shell ${phaseClassName}`}>
      {renderedPhase === "input" ? (
        <Dashboard onStartAnalysis={handleStartAnalysis} showUtilityMenu={import.meta.env.DEV} />
      ) : (
        <MissionControlView
          claim={activeClaim}
          intake={activeIntake}
          onCancel={handleCancelExecution}
          modelChoice={activeModelChoice}
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
