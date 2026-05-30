import { useEffect, useRef, useState, useCallback } from "react";
import { ReasoningProvider, selectLatestHandoffRun, useReasoning } from "./store/reasoningStore";
import { Dashboard } from "./components/v3/Dashboard";
import { MissionControlView } from "./components/v3/phases/MissionControlView";
import { ResultWorkspace } from "./components/v3/phases/ResultWorkspace";
import { requestOrchestrate } from "./lib/agentExpansion";
import { runDemoPipeline } from "./lib/pipeline";
import { canvasNodes, canvasEdges, reasoningSteps } from "./data/reasoningCanvas";
import type { CanvasNode } from "./data/reasoningCanvas";

type AppPhase = "input" | "executing" | "result";

function AppContent() {
  const [appPhase, setAppPhase] = useState<AppPhase>("input");
  const [renderedPhase, setRenderedPhase] = useState<AppPhase>("input");
  const [phaseClassName, setPhaseClassName] = useState("phase-enter");
  const [orchestrateMode, setOrchestrateMode] = useState(false);
  const [activeClaim, setActiveClaim] = useState("");
  const quickRunRef = useRef(0);
  const { state, dispatch } = useReasoning();
  const latestHandoffRun = selectLatestHandoffRun(state);

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
    (claim: string, caseId?: string, orchestrate?: boolean) => {
      const nextOrchestrateMode = orchestrate ?? false;

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
      setOrchestrateMode(nextOrchestrateMode);
      setAppPhase(nextOrchestrateMode ? "executing" : "result");

      if (!nextOrchestrateMode) {
        const runId = quickRunRef.current + 1;
        quickRunRef.current = runId;
        dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
        void requestOrchestrate(claim)
          .then((result) => {
            if (quickRunRef.current !== runId) return;
            result.steps.forEach((step) => {
              dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
            });
            dispatch({
              type: "SET_HANDOFF_FINAL_REPORT",
              payload: {
                finalReport: result.finalReport,
                totalLatencyMs: result.steps.reduce((sum, step) => sum + step.latencyMs, 0),
                model: result.steps.map((step) => step.model).filter(Boolean).join(", ") || "multi-agent",
              },
            });
            dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: {} });
          })
          .catch((error: unknown) => {
            if (quickRunRef.current !== runId) return;
            dispatch({
              type: "COMPLETE_HANDOFF_STREAM",
              payload: { error: error instanceof Error ? error.message : "快速分析模型调用失败" },
            });
          });
      }
    },
    [dispatch]
  );

  const handleCancelExecution = useCallback(() => {
    quickRunRef.current += 1;
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setOrchestrateMode(false);
    setAppPhase("input");
  }, [dispatch]);

  const handleResetToInput = useCallback(() => {
    quickRunRef.current += 1;
    dispatch({ type: "RESET" });
    setActiveClaim("");
    setOrchestrateMode(false);
    setAppPhase("input");
  }, [dispatch]);

  const handleExecutionComplete = useCallback(() => {
    setAppPhase("result");
  }, []);

  return (
    <div className={`app-phase-shell ${phaseClassName}`}>
      {renderedPhase === "input" ? (
        <Dashboard onStartAnalysis={handleStartAnalysis} />
      ) : renderedPhase === "executing" && orchestrateMode ? (
        <MissionControlView
          claim={activeClaim}
          onCancel={handleCancelExecution}
          onComplete={handleExecutionComplete}
        />
      ) : (
        <ResultWorkspace
          claim={activeClaim || state.originalClaim}
          handoffResult={
            latestHandoffRun
              ? {
                  claim: latestHandoffRun.claim,
                  steps: latestHandoffRun.steps,
                  finalReport: latestHandoffRun.finalReport,
                }
              : null
          }
          onReset={handleResetToInput}
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
