import { useEffect, useState, useCallback } from "react";
import { ReasoningProvider, useReasoning } from "./store/reasoningStore";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { runDemoPipeline } from "./lib/pipeline";
import { canvasNodes, canvasEdges, reasoningSteps } from "./data/reasoningCanvas";
import type { CanvasNode } from "./data/reasoningCanvas";

type AppPhase = "input" | "executing";

function AppContent() {
  const [appPhase, setAppPhase] = useState<AppPhase>("input");
  const [renderedPhase, setRenderedPhase] = useState<AppPhase>("input");
  const [phaseClassName, setPhaseClassName] = useState("phase-enter");
  const [activeClaim, setActiveClaim] = useState("");
  const { dispatch } = useReasoning();

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
    (claim: string, caseId?: string, _orchestrate?: boolean) => {
      if (caseId) {
        const { caseData: selectedCase, report: selectedReport } = runDemoPipeline(caseId);
        dispatch({
          type: "INIT_CASE",
          payload: {
            caseData: selectedCase,
            report: selectedReport,
            nodes: canvasNodes,
            edges: canvasEdges,
            steps: reasoningSteps,
          },
        });
      } else {
        const { caseData: defaultCase, report: defaultReport } = runDemoPipeline();
        const rootNode: CanvasNode = {
          id: "claim-root",
          type: "claim",
          title: claim,
          subtitle: "待核查信息",
          x: 46,
          y: 45,
          status: "risk",
          revealStage: 99,
        };
        dispatch({
          type: "INIT_CASE",
          payload: {
            caseData: { ...defaultCase, originalClaim: claim },
            report: defaultReport,
            nodes: [rootNode],
            edges: [],
            steps: [],
          },
        });
      }
      setActiveClaim(claim);
      setAppPhase("executing");
    },
    [dispatch]
  );

  const handleCancelExecution = useCallback(() => {
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setAppPhase("input");
  }, [dispatch]);

  return (
    <div className={`app-phase-shell ${phaseClassName}`}>
      {renderedPhase === "input" ? (
        <Dashboard onStartAnalysis={handleStartAnalysis} />
      ) : (
        <MissionControlView
          claim={activeClaim}
          onCancel={handleCancelExecution}
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
