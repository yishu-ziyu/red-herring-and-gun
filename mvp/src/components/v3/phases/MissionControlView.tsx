import { useEffect, useMemo, useState } from "react";
import {
  requestOrchestrateStream,
  type HandoffStep,
  type OrchestrateStreamEvent,
} from "../../../lib/agentExpansion";
import { useReasoning } from "../../../store/reasoningStore";
import { AgentCard } from "./mission/AgentCard";
import { CanvasThumbnail } from "./mission/CanvasThumbnail";
import { StepTimeline } from "./mission/StepTimeline";

interface MissionControlViewProps {
  claim: string;
  onCancel: () => void;
  onComplete: () => void;
}

type RunStatus = "idle" | "running" | "completed" | "failed";

const AGENT_ORDER = [
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
];

const OUTPUT_KEY_LABELS: Record<string, string> = {
  conclusion: "结论",
  summary: "摘要",
  reasoning: "推理",
  confidence: "置信度",
  credibilityScore: "可信度",
  credibilityLabel: "可信度",
  riskSignals: "风险信号",
  rumorIndicators: "谣言特征",
  evidence: "证据",
  sources: "信源",
  limitations: "限制",
  recommendations: "建议",
};

function normalizeAgent(agent?: string | null) {
  return (agent ?? "").trim().toLowerCase();
}

function upsertStep(steps: HandoffStep[], nextStep: HandoffStep) {
  const nextAgent = normalizeAgent(nextStep.agent);
  const existingIndex = steps.findIndex((step) => normalizeAgent(step.agent) === nextAgent);
  if (existingIndex < 0) return [...steps, nextStep];
  return steps.map((step, index) => (index === existingIndex ? nextStep : step));
}

function buildStep(event: OrchestrateStreamEvent, status: HandoffStep["status"]): HandoffStep {
  return {
    agent: normalizeAgent(event.agent) || "unknown",
    agentName: event.agentName ?? event.agent ?? "Unknown",
    agentIcon: event.agentIcon ?? "◆",
    systemPrompt: "",
    input: {},
    output: event.output ?? {},
    model: event.model ?? "pending",
    latencyMs: event.latencyMs ?? 0,
    timestamp: event.timestamp ?? Date.now(),
    status,
    error: event.error,
  };
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 4)
      .map((item) => summarizeValue(item))
      .join(" / ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value).slice(0, 140);
  }
  return "";
}

function extractOutputItems(output: Record<string, unknown>) {
  const entries = Object.entries(output).filter(([, value]) => value !== undefined && value !== null);

  if (entries.length === 0) return [];

  return entries
    .slice(0, 6)
    .map(([key, value]) => {
      const label = OUTPUT_KEY_LABELS[key] ?? key;
      const text = summarizeValue(value);
      return text ? `${label}: ${text}` : label;
    })
    .filter(Boolean);
}

function calculateProgress(steps: HandoffStep[], runStatus: RunStatus) {
  if (runStatus === "completed") return 100;

  const completedCount = steps.filter((step) => step.status === "completed").length;
  const runningStep = steps.find((step) => step.status === "running");
  const runningBonus = runningStep ? 0.55 : runStatus === "running" ? 0.15 : 0;
  const raw = ((completedCount + runningBonus) / AGENT_ORDER.length) * 100;

  return Math.min(runStatus === "failed" ? 100 : 95, raw);
}

function selectCurrentStep(steps: HandoffStep[]) {
  return (
    steps.find((step) => step.status === "running") ??
    [...steps].reverse().find((step) => step.status === "completed" || step.status === "failed") ??
    null
  );
}

export function MissionControlView({ claim, onCancel, onComplete }: MissionControlViewProps) {
  const { dispatch } = useReasoning();
  const [steps, setSteps] = useState<HandoffStep[]>([]);
  const [currentStep, setCurrentStep] = useState<HandoffStep | null>(null);
  const [outputItems, setOutputItems] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (runStatus !== "running" || startedAt === null) return;

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(timer);
  }, [runStatus, startedAt]);

  useEffect(() => {
    if (!claim.trim()) return;

    let cancelled = false;
    let accumulatedSteps: HandoffStep[] = [];
    let completionTimer: number | undefined;

    const startTimer = window.setTimeout(() => {
      async function runStream() {
        dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
        setSteps([]);
        setCurrentStep(null);
        setOutputItems(["任务已进入多 Agent 调度队列。"]);
        setStartedAt(Date.now());
        setElapsedMs(0);
        setRunStatus("running");
        setErrorMessage("");

        try {
          for await (const event of requestOrchestrateStream(claim)) {
            if (cancelled) return;

            switch (event.type) {
              case "agent_start": {
                const step = buildStep(event, "running");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setOutputItems([`${step.agentName} 已接管当前任务。`]);
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "agent_complete": {
                const step = buildStep(event, "completed");
                const nextOutputItems = extractOutputItems(step.output);
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setOutputItems(
                  nextOutputItems.length > 0
                    ? nextOutputItems
                    : [`${step.agentName} 已完成，等待下一步。`]
                );
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "agent_error": {
                const step = buildStep(event, "failed");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setStartedAt(null);
                setRunStatus("failed");
                setErrorMessage(event.error ?? event.message ?? `${step.agentName} 执行失败`);
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                dispatch({
                  type: "COMPLETE_HANDOFF_STREAM",
                  payload: { error: event.error ?? event.message },
                });
                break;
              }
              case "complete": {
                const finalSteps =
                  event.steps && event.steps.length > 0 ? event.steps : accumulatedSteps;
                const finalReport = event.finalReport;
                const totalLatency = event.totalLatencyMs ?? finalSteps.reduce(
                  (sum, step) => sum + step.latencyMs,
                  0
                );
                const finalCurrentStep = selectCurrentStep(finalSteps);

                finalSteps.forEach((step) => {
                  dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                });
                dispatch({
                  type: "SET_HANDOFF_FINAL_REPORT",
                  payload: {
                    finalReport,
                    totalLatencyMs: totalLatency,
                    model: finalSteps.map((step) => step.model).filter(Boolean).join(", ") || "multi-agent",
                  },
                });
                dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: {} });

                setSteps(finalSteps);
                setCurrentStep(finalCurrentStep);
                setOutputItems(["多 Agent 核查已完成，正在整理结果工作区。"]);
                setStartedAt(null);
                setElapsedMs((current) => totalLatency || current);
                setRunStatus("completed");

                completionTimer = window.setTimeout(() => {
                  if (!cancelled) onComplete();
                }, 650);
                break;
              }
              case "error": {
                setStartedAt(null);
                setRunStatus("failed");
                setErrorMessage(event.error ?? event.message ?? "Orchestrate 流式调用失败");
                dispatch({
                  type: "COMPLETE_HANDOFF_STREAM",
                  payload: { error: event.error ?? event.message },
                });
                break;
              }
            }
          }
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : "Orchestrate 流式调用失败";
          setStartedAt(null);
          setRunStatus("failed");
          setErrorMessage(message);
          dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
        }
      }

      void runStream();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (completionTimer) window.clearTimeout(completionTimer);
    };
  }, [claim, dispatch, onComplete]);

  const currentAgent = normalizeAgent(currentStep?.agent) || null;
  const progress = useMemo(() => calculateProgress(steps, runStatus), [steps, runStatus]);

  return (
    <main className="mission-control-view">
      <header className="mission-topbar">
        <div className="mission-brand">
          <strong>真探 Agent</strong>
          <span>Mission Control</span>
        </div>
        <button className="mission-cancel-btn" type="button" onClick={onCancel}>
          取消核查
        </button>
      </header>

      <section className="mission-stage" aria-label="当前执行 Agent">
        <AgentCard
          claim={claim}
          step={currentStep}
          elapsedMs={elapsedMs}
          progress={progress}
          outputItems={outputItems}
          status={runStatus}
        />
        {errorMessage ? <p className="mission-error">{errorMessage}</p> : null}
      </section>

      <StepTimeline steps={steps} currentAgent={currentAgent} />
      <CanvasThumbnail steps={steps} currentAgent={currentAgent} />
    </main>
  );
}
