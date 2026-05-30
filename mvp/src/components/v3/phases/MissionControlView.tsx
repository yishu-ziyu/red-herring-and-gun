import { useEffect, useMemo, useState } from "react";
import {
  requestOrchestrateStream,
  type HandoffStep,
  type OrchestrateStreamEvent,
} from "../../../lib/agentExpansion";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import type { ClaimDiagnosis, KnowledgeBaseEntry, VerificationResult } from "../../../lib/schemas";
import { useReasoning } from "../../../store/reasoningStore";
import { AgentCard } from "./mission/AgentCard";
import { CanvasThumbnail } from "./mission/CanvasThumbnail";
import { StepTimeline } from "./mission/StepTimeline";

interface MissionControlViewProps {
  claim: string;
  onCancel: () => void;
}

type RunStatus = "idle" | "running" | "completed" | "failed";
type StreamItemStatus = "queued" | "running" | "completed" | "failed" | "final";

interface MissionStreamItem {
  id: string;
  agentName: string;
  title: string;
  detail: string;
  status: StreamItemStatus;
  timestamp: number;
}

const AGENT_ORDER = [
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
];

const AGENT_PROCESS_COPY: Record<string, { running: string[]; completed: string[] }> = {
  rumor_detector: {
    running: [
      "扫描原句里的高风险词、绝对化表达和情绪触发点。",
      "判断它是不是混合了事实、因果、预测或价值判断。",
      "把需要核查的断言拆给后续 Agent，而不是直接给结论。",
    ],
    completed: [
      "已完成谣言特征定位。",
      "已把原句改写成后续可验证的问题队列。",
      "下一步进入支持/反驳双向核查。",
    ],
  },
  fact_checker: {
    running: [
      "同时生成支持查询和反驳查询。",
      "寻找权威材料、反例、争议点和无法证实的空白。",
      "把候选材料先放进证据池，暂不允许它直接推出结论。",
    ],
    completed: [
      "已完成支持/反驳材料的第一轮归集。",
      "已记录仍缺失的证据问题。",
      "下一步交给信源校验做来源分层。",
    ],
  },
  source_validator: {
    running: [
      "检查来源层级、发布时间、机构属性和转述链条。",
      "区分官方来源、专业解释、媒体转述和低可信线索。",
      "给每条材料标注支持、反驳、限定、背景或不可用角色。",
    ],
    completed: [
      "已完成信源可信度分层。",
      "已把低可信或只支持局部的材料降权。",
      "下一步检查哪些推断仍然不能成立。",
    ],
  },
  report_composer: {
    running: [
      "读取前面 Agent 留下的证据边界。",
      "检查哪些话可以说、哪些推断必须禁止。",
      "把最终表达压到证据真正允许的强度。",
    ],
    completed: [
      "已完成结论许可审计。",
      "已把强断言降级为更谨慎的表达。",
      "最终摘要只作为收束，不替代上面的推理过程。",
    ],
  },
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
    evidenceBundle: event.evidenceBundle,
    model: event.model ?? "pending",
    latencyMs: event.latencyMs ?? 0,
    timestamp: event.timestamp ?? Date.now(),
    status,
    error: event.error,
  };
}

function reportText(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function processItemsForAgent(agent?: string | null, phase: "running" | "completed" = "running") {
  const key = normalizeAgent(agent);
  return AGENT_PROCESS_COPY[key]?.[phase] ?? [
    phase === "running" ? "正在读取上一步留下的上下文。" : "已完成当前思考步骤。",
    phase === "running" ? "正在决定下一步要交给哪个 Agent。" : "已把过程记录交还给中控。",
  ];
}

function processSummaryForStep(step: HandoffStep, phase: "running" | "completed") {
  const items = processItemsForAgent(step.agent, phase);
  const bundle = step.evidenceBundle;
  const evidenceCount = bundle
    ? bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length
    : 0;
  const unresolvedCount = bundle?.unresolvedQuestions.length ?? 0;
  const suffix =
    phase === "completed" && (evidenceCount > 0 || unresolvedCount > 0)
      ? ` 本轮留下 ${evidenceCount} 条证据线索、${unresolvedCount} 个待确认问题。`
      : "";
  return `${items.join(" ")}${suffix}`;
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

function inferDiagnosis(steps: HandoffStep[], fallback: ClaimDiagnosis | null): ClaimDiagnosis {
  if (fallback) return fallback;

  const rumorStep = steps.find((step) => step.agent === "rumor_detector");
  const indicators = Array.isArray(rumorStep?.output.rumorIndicators)
    ? rumorStep.output.rumorIndicators.filter((item): item is string => typeof item === "string")
    : [];

  return {
    mixedJudgments: ["事件事实"],
    ambiguousTerms: indicators,
    risk: typeof rumorStep?.output.analysis === "string"
      ? rumorStep.output.analysis
      : "需要结合权威来源继续核查。",
    whyNotDirectFactCheck: "该结论来自多 Agent 自动核查流程，仍需保留证据边界。",
    rumorIndicators: indicators,
  };
}

function inferVerificationResult(score: number): VerificationResult {
  if (score >= 70) return "true";
  if (score >= 40) return "partial";
  return "unknown";
}

function MissionStreamPanel({
  items,
  finalReport,
}: {
  items: MissionStreamItem[];
  finalReport: Record<string, unknown> | null;
}) {
  const score = typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : null;
  const finalStatus = reportText(finalReport, "credibilityLabel");

  return (
    <aside className="mission-stream-panel" aria-label="Agent 流式思考过程">
      <div className="mission-stream-heading">
        <span>Agent Stream</span>
        <strong>流式推理记录</strong>
      </div>
      <div className="mission-stream-list">
        {items.length > 0 ? (
          items.map((item) => (
            <article key={item.id} className={`mission-stream-item mission-stream-item--${item.status}`}>
              <div className="mission-stream-item-head">
                <strong>{item.agentName}</strong>
                <span>{item.status}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))
        ) : (
          <p className="mission-stream-empty">等待中控分配第一个 Agent。</p>
        )}
      </div>
      {finalReport ? (
        <section className="mission-final-brief" aria-label="Agent 收束摘要">
          <span>Final Synthesis</span>
          <strong>{score !== null ? `收束完成 · 可信度 ${score}/100` : "Agent 已完成收束"}</strong>
          <p>
            {finalStatus ? `最终判断已生成，当前状态为「${finalStatus}」。` : "最终判断已生成。"}
            这里保留的是收束状态，完整重点仍在上方每个 Agent 的思考过程。
          </p>
        </section>
      ) : null}
    </aside>
  );
}

export function MissionControlView({ claim, onCancel }: MissionControlViewProps) {
  const { state, dispatch } = useReasoning();
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);
  const [steps, setSteps] = useState<HandoffStep[]>([]);
  const [currentStep, setCurrentStep] = useState<HandoffStep | null>(null);
  const [outputItems, setOutputItems] = useState<string[]>([]);
  const [streamItems, setStreamItems] = useState<MissionStreamItem[]>([]);
  const [finalReport, setFinalReport] = useState<Record<string, unknown> | null>(null);
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

    const pushStreamItem = (item: Omit<MissionStreamItem, "id" | "timestamp">) => {
      setStreamItems((prev) => [
        ...prev,
        {
          ...item,
          id: `${Date.now()}-${prev.length}`,
          timestamp: Date.now(),
        },
      ]);
    };

    const startTimer = window.setTimeout(() => {
      async function runStream() {
        dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
        setSteps([]);
        setCurrentStep(null);
        setStreamItems([]);
        setFinalReport(null);
        setOutputItems([
          "建立任务上下文。",
          "等待中控按顺序分派 Agent。",
          "本页会展示思考过程，不直接展开结果报告。",
        ]);
        pushStreamItem({
          agentName: "Mission Control",
          title: "建立核查任务",
          detail: "中控会按 Agent 顺序流式展开，不直接跳到最终报告。",
          status: "queued",
        });
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
                setOutputItems(processItemsForAgent(step.agent, "running"));
                pushStreamItem({
                  agentName: step.agentName,
                  title: "开始思考",
                  detail: processSummaryForStep(step, "running"),
                  status: "running",
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "agent_complete": {
                const step = buildStep(event, "completed");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setOutputItems(processItemsForAgent(step.agent, "completed"));
                pushStreamItem({
                  agentName: step.agentName,
                  title: "完成一轮思考",
                  detail: processSummaryForStep(step, "completed"),
                  status: "completed",
                });
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
                pushStreamItem({
                  agentName: step.agentName,
                  title: "执行失败",
                  detail: event.error ?? event.message ?? `${step.agentName} 执行失败`,
                  status: "failed",
                });
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

                const credibilityScore =
                  typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : 50;
                const entry: KnowledgeBaseEntry = {
                  id: `case-${claim.replace(/\s+/g, "-").slice(0, 48)}-deep`,
                  claim,
                  rumorType: state.diagnosis?.risk?.includes("政治")
                    ? "政治"
                    : state.diagnosis?.risk?.includes("娱乐")
                      ? "娱乐"
                      : "深度核查",
                  diagnosis: inferDiagnosis(finalSteps, state.diagnosis),
                  finalReport: finalReport ?? {},
                  handoffSteps: finalSteps,
                  credibilityScore,
                  verificationResult: inferVerificationResult(credibilityScore),
                  timestamp: Date.now(),
                  tags: [
                    "deep",
                    ...(state.diagnosis?.rumorIndicators ?? []),
                    typeof finalReport?.credibilityLabel === "string" ? finalReport.credibilityLabel : "",
                  ],
                };
                void knowledgeBase.saveCase(entry);

                setSteps(finalSteps);
                setCurrentStep(finalCurrentStep);
                setFinalReport(finalReport ?? null);
                setOutputItems([
                  "多 Agent 核查已完成。",
                  "最终判断已经收束，但页面不会跳到报告页。",
                  "请沿上方流式记录回看每一步如何形成证据边界。",
                ]);
                pushStreamItem({
                  agentName: "ReportComposer",
                  title: "完成收束，但不展开报告",
                  detail: "中控只提示结论已经形成；用户仍从上方思考链路理解为什么这么收束。",
                  status: "final",
                });
                setStartedAt(null);
                setElapsedMs((current) => totalLatency || current);
                setRunStatus("completed");
                break;
              }
              case "error": {
                setStartedAt(null);
                setRunStatus("failed");
                setErrorMessage(event.error ?? event.message ?? "Orchestrate 流式调用失败");
                pushStreamItem({
                  agentName: "Mission Control",
                  title: "流式调用失败",
                  detail: event.error ?? event.message ?? "Orchestrate 流式调用失败",
                  status: "failed",
                });
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
          pushStreamItem({
            agentName: "Mission Control",
            title: "执行中断",
            detail: message,
            status: "failed",
          });
          dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
        }
      }

      void runStream();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [claim, dispatch, knowledgeBase, state.diagnosis]);

  const currentAgent = normalizeAgent(currentStep?.agent) || null;
  const progress = useMemo(() => calculateProgress(steps, runStatus), [steps, runStatus]);
  const evidenceBundleCount = useMemo(
    () => steps.filter((step) => step.evidenceBundle).length,
    [steps]
  );
  const evidenceItemCount = useMemo(
    () =>
      steps.reduce((sum, step) => {
        const bundle = step.evidenceBundle;
        if (!bundle) return sum;
        return sum + bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length;
      }, 0),
    [steps]
  );

  return (
    <main className="mission-control-view">
      <header className="mission-topbar">
        <div className="mission-brand">
          <strong>红鲱鱼与枪</strong>
          <span>Mission Control</span>
        </div>
        <button className="mission-cancel-btn" type="button" onClick={onCancel}>
          取消核查
        </button>
      </header>

      <section className="mission-stage" aria-label="当前执行 Agent">
        <div className="mission-process-grid">
          <div className="mission-process-primary">
            <AgentCard
              claim={claim}
              step={currentStep}
              elapsedMs={elapsedMs}
              progress={progress}
              outputItems={outputItems}
              status={runStatus}
            />
            {errorMessage ? <p className="mission-error">{errorMessage}</p> : null}
            {evidenceBundleCount > 0 ? (
              <p className="mission-evidence-bundles">
                已累计 {evidenceBundleCount} 个 Agent 证据包，关联 {evidenceItemCount} 条支持/反驳证据。
              </p>
            ) : null}
          </div>
          <MissionStreamPanel items={streamItems} finalReport={finalReport} />
        </div>
      </section>

      <StepTimeline steps={steps} currentAgent={currentAgent} />
      <CanvasThumbnail steps={steps} currentAgent={currentAgent} />
    </main>
  );
}
