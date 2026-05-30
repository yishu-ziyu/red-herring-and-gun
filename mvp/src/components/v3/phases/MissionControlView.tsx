import { useEffect, useMemo, useState, useCallback } from "react";
import {
  requestOrchestrateStream,
  type HandoffStep,
  type OrchestrateStreamEvent,
} from "../../../lib/agentExpansion";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import type {
  AtomicProposition,
  ClaimDiagnosis,
  ClaimDecompositionResult,
  EvidenceConsensusReport,
  KnowledgeBaseEntry,
  MultiSearchJob,
  VerificationResult,
} from "../../../lib/schemas";
import { useReasoning } from "../../../store/reasoningStore";
import { StreamingReasoningPanel } from "../StreamingReasoningPanel";
import { ConsensusProgressPanel } from "../ConsensusProgressPanel";
import { EvidenceDetailDrawer } from "../EvidenceDetailDrawer";
import { EvidenceMatrix } from "../EvidenceMatrix";
import { buildSearchJobs, executeSearchJobs } from "../../../lib/evidenceSearchRouter";
import { evaluateConsensus } from "../../../lib/evidenceConsensus";
import type { ChunkType, StreamingChunk, StreamingReasoningSession } from "../../../lib/streamingTypes";
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

type CasePathStatus = "pending" | "running" | "completed" | "failed";

interface CasePathStep {
  id: string;
  label: string;
  description: string;
  status: CasePathStatus;
  producer: string;
}

const AGENT_ORDER = [
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
];

const RUNTIME_STREAM_STAGES = [
  {
    id: "rumor_detector",
    name: "rumor_detector",
    nameZh: "声明分诊",
    description: "国产大模型拆解 claim，识别谣言类型和后续证据需求。",
    agentName: "RumorDetector",
    agentIcon: "🚨",
  },
  {
    id: "fact_checker",
    name: "fact_checker",
    nameZh: "事实交叉核查",
    description: "国产大模型结合多搜索引擎线索，比较支持与反驳证据。",
    agentName: "FactChecker",
    agentIcon: "🔎",
  },
  {
    id: "source_validator",
    name: "source_validator",
    nameZh: "信源与溯源",
    description: "国产大模型审计来源层级、转载链和未解决证据缺口。",
    agentName: "SourceValidator",
    agentIcon: "📚",
  },
  {
    id: "report_composer",
    name: "report_composer",
    nameZh: "报告收束",
    description: "国产大模型根据证据边界生成最终可说/不可说的报告。",
    agentName: "ReportComposer",
    agentIcon: "📝",
  },
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

function findAgentStep(steps: HandoffStep[], agent: string) {
  return steps.find((step) => normalizeAgent(step.agent) === agent);
}

function isStepCompleted(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "completed";
}

function isStepRunning(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "running";
}

function isStepFailed(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "failed";
}

function statusFromSignals(completed: boolean, running: boolean, failed = false): CasePathStatus {
  if (failed) return "failed";
  if (completed) return "completed";
  if (running) return "running";
  return "pending";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function searchTaskStats(searchJobs: MultiSearchJob[]) {
  return searchJobs.reduce(
    (stats, job) => {
      job.searchTasks.forEach((task) => {
        stats.total += 1;
        if (task.status === "pending") stats.pending += 1;
        if (task.status === "running") stats.running += 1;
        if (task.status === "completed") stats.completed += 1;
        if (task.status === "failed") stats.failed += 1;
        if (task.result?.sources) {
          stats.sources += task.result.sources.length;
        }
      });
      return stats;
    },
    { total: 0, pending: 0, running: 0, completed: 0, failed: 0, sources: 0 }
  );
}

function isNonAuthenticStep(step: HandoffStep) {
  const source = typeof step.output._source === "string" ? step.output._source : "";
  const fallbackReason = typeof step.output.fallbackReason === "string" ? step.output.fallbackReason : "";
  return step.model.includes("demo-fallback") || source === "demo-fallback" || Boolean(fallbackReason);
}

function formatLatency(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
    agentContract: event.agentContract,
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

function buildRuntimeStreamingSession(claim: string): StreamingReasoningSession {
  return {
    sessionId: `runtime-session-${Date.now()}`,
    claim,
    stages: RUNTIME_STREAM_STAGES.map((stage) => ({
      ...stage,
      status: "pending",
      chunks: [],
    })),
    overallStatus: "idle",
    currentStageId: null,
    source: "runtime",
    sourceLabel: "真实 Agent SSE",
  };
}

function buildRuntimeChunk(stageId: string, type: ChunkType, content: string): StreamingChunk {
  return {
    id: `${stageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    timestamp: Date.now(),
  };
}

function summarizeStepOutput(step: HandoffStep) {
  const fallbackReason = typeof step.output.fallbackReason === "string" ? step.output.fallbackReason : "";
  if (fallbackReason) {
    return `真实模型调用未完成，已降级到 ${step.model}。原因：${fallbackReason}`;
  }

  const summary =
    typeof step.output.analysis === "string"
      ? step.output.analysis
      : typeof step.output.summary === "string"
        ? step.output.summary
        : typeof step.output.finalSummary === "string"
          ? step.output.finalSummary
          : "";

  return summary ? `${step.model} 返回结构化结果：${summary}` : `${step.model} 已返回结构化结果。`;
}

function buildDecompositionFromRumorStep(claim: string, step: HandoffStep): ClaimDecompositionResult | null {
  const rawAtoms = Array.isArray(step.output.claimAtoms) ? step.output.claimAtoms : [];
  const atomTexts = rawAtoms
    .map((atom) => {
      if (typeof atom === "string") return atom.trim();
      if (atom && typeof atom === "object" && "text" in atom && typeof atom.text === "string") {
        return atom.text.trim();
      }
      if (atom && typeof atom === "object" && "claim" in atom && typeof atom.claim === "string") {
        return atom.claim.trim();
      }
      return "";
    })
    .filter(Boolean);

  if (atomTexts.length === 0) return null;

  const atomicPropositions: AtomicProposition[] = atomTexts.slice(0, 4).map((text, index) => ({
    id: `prop-${String.fromCharCode(97 + index)}`,
    text,
    type: inferAtomicType(text),
    verifiability: "可直接验证",
  }));

  return {
    originalClaim: claim,
    atomicPropositions,
    decompositionReasoning: `${step.agentName} 使用 ${step.model} 输出 claimAtoms，交叉验证区只消费该真实 Agent 结果。`,
  };
}

function inferAtomicType(text: string): AtomicProposition["type"] {
  if (/[0-9%]/.test(text)) return "数值断言";
  if (/(导致|因为|由于|死于|归因|造成)/.test(text)) return "因果推断";
  if (/(称|表示|来源|爆料|传出)/.test(text)) return "归因断言";
  return "事实陈述";
}

function reportText(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function reportNumber(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confidenceDimensions(report: Record<string, unknown> | null) {
  const raw = report?.confidenceDimensions;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    label: string;
    score: number;
    threshold: number;
    passed: boolean;
    reason: string;
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.label === "string" &&
      typeof value.score === "number" &&
      typeof value.threshold === "number" &&
      typeof value.passed === "boolean" &&
      typeof value.reason === "string"
    );
  });
}

function logicRiskItems(report: Record<string, unknown> | null) {
  const raw = report?.logicRiskItems;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    label: string;
    severity: string;
    explanation: string;
    mitigation: string;
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.label === "string" &&
      typeof value.severity === "string" &&
      typeof value.explanation === "string" &&
      typeof value.mitigation === "string"
    );
  });
}

function processItemsForAgent(agent?: string | null, phase: "running" | "completed" = "running") {
  const key = normalizeAgent(agent);
  return AGENT_PROCESS_COPY[key]?.[phase] ?? [
    phase === "running" ? "正在读取上一步留下的上下文。" : "已完成当前思考步骤。",
    phase === "running" ? "正在决定下一步要交给哪个 Agent。" : "已把过程记录交还给中控。",
  ];
}

function processSummaryForStep(step: HandoffStep, phase: "running" | "completed") {
  const traceItems = phase === "running" ? step.agentContract?.uiTrace.running : step.agentContract?.uiTrace.complete;
  const items = traceItems && traceItems.length > 0 ? traceItems : processItemsForAgent(step.agent, phase);
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

function outputItemsForStep(step: HandoffStep, phase: "running" | "completed") {
  const traceItems = phase === "running" ? step.agentContract?.uiTrace.running : step.agentContract?.uiTrace.complete;
  const items = traceItems && traceItems.length > 0 ? traceItems : processItemsForAgent(step.agent, phase);
  if (phase === "running") {
    return items.map((item) => `执行计划：${item}`);
  }
  return items.map((item) => `真实返回：${item}`);
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

function MissionFinalReportPanel({
  claim,
  finalReport,
}: {
  claim: string;
  finalReport: Record<string, unknown> | null;
}) {
  if (!finalReport) return null;

  const conclusion = reportText(finalReport, "conclusion");
  const label = reportText(finalReport, "credibilityLabel");
  const recommendation = reportText(finalReport, "recommendation");
  const summaryForPublic = reportText(finalReport, "summaryForPublic");
  const score = reportNumber(finalReport, "credibilityScore");
  const dimensions = confidenceDimensions(finalReport);
  const risks = logicRiskItems(finalReport);

  return (
    <section className="mission-final-report" aria-label="最终核查判断">
      <div className="mission-final-report-head">
        <div>
          <span>Final Verdict</span>
          <strong>最终核查判断</strong>
        </div>
        <div className="mission-final-verdict-badges">
          {label ? <em>{label}</em> : null}
          {score !== null ? <strong>{score}/100</strong> : null}
        </div>
      </div>

      <div className="mission-final-claim">
        <span>原始信息</span>
        <p>{claim}</p>
      </div>

      {conclusion ? (
        <div className="mission-final-conclusion">
          <span>判断</span>
          <p>{conclusion}</p>
        </div>
      ) : (
        <div className="mission-final-conclusion mission-final-conclusion--empty">
          <span>判断</span>
          <p>ReportComposer 已完成，但模型未返回可展示的 conclusion 字段。</p>
        </div>
      )}

      {(summaryForPublic || recommendation) ? (
        <div className="mission-closure-grid" aria-label="结果闭环动作">
          {summaryForPublic ? (
            <article>
              <span>辟谣卡片文案</span>
              <p>{summaryForPublic}</p>
            </article>
          ) : null}
          {recommendation ? (
            <article>
              <span>处理建议</span>
              <p>{recommendation}</p>
            </article>
          ) : null}
        </div>
      ) : null}

      {dimensions.length > 0 ? (
        <div className="mission-confidence-list" aria-label="FIRE 置信度维度">
          {dimensions.map((dimension) => (
            <article key={dimension.label} className={dimension.passed ? "passed" : "failed"}>
              <div>
                <strong>{dimension.label}</strong>
                <span>{dimension.score}/{dimension.threshold}</span>
              </div>
              <p>{dimension.reason}</p>
            </article>
          ))}
        </div>
      ) : null}

      {risks.length > 0 ? (
        <div className="mission-risk-list" aria-label="逻辑风险审计">
          {risks.map((risk) => (
            <article key={`${risk.label}-${risk.severity}`}>
              <strong>{risk.label}</strong>
              <p>{risk.explanation}</p>
              <small>{risk.mitigation}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function buildCasePathSteps({
  steps,
  claimDecomposition,
  searchJobs,
  consensusReport,
  finalReport,
  evidenceItemCount,
}: {
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  finalReport: Record<string, unknown> | null;
  evidenceItemCount: number;
}): CasePathStep[] {
  const searchStats = searchTaskStats(searchJobs);
  const searchRunning = searchStats.running > 0 || searchStats.pending > 0;
  return [
    {
      id: "docket",
      label: "立案",
      description: "RumorDetector 识别类型、风险信号和证据需求。",
      producer: "RumorDetector",
      status: statusFromSignals(
        isStepCompleted(steps, "rumor_detector"),
        isStepRunning(steps, "rumor_detector"),
        isStepFailed(steps, "rumor_detector")
      ),
    },
    {
      id: "atoms",
      label: "拆题",
      description: "只使用 RumorDetector 真实 claimAtoms，不走模板拆题。",
      producer: "RumorDetector.claimAtoms",
      status: statusFromSignals(Boolean(claimDecomposition), isStepRunning(steps, "rumor_detector")),
    },
    {
      id: "trace",
      label: "溯源",
      description: "SourceValidator 审计原始来源、转载链和缺失来源。",
      producer: "SourceValidator",
      status: statusFromSignals(
        isStepCompleted(steps, "source_validator"),
        isStepRunning(steps, "source_validator"),
        isStepFailed(steps, "source_validator")
      ),
    },
    {
      id: "cross_search",
      label: "交叉验证",
      description: "360 / AnySearch / Metaso / Tavily / Exa 并行检索同一命题。",
      producer: "Search Tool Registry",
      status: statusFromSignals(Boolean(consensusReport), searchJobs.length > 0 && searchRunning),
    },
    {
      id: "reasoning",
      label: "逻辑推演",
      description: "FactChecker 和 ReportComposer 标明可推断、不可推断和证据缺口。",
      producer: "FactChecker + ReportComposer",
      status: statusFromSignals(
        isStepCompleted(steps, "fact_checker") || Boolean(finalReport),
        isStepRunning(steps, "fact_checker") || isStepRunning(steps, "report_composer"),
        isStepFailed(steps, "fact_checker") || isStepFailed(steps, "report_composer")
      ),
    },
    {
      id: "evidence_chain",
      label: "证据链",
      description: "把 Agent 证据包和搜索来源组织成可点击证据板。",
      producer: "Evidence Bundle",
      status: statusFromSignals(evidenceItemCount > 0 || searchStats.sources > 0, searchJobs.length > 0 && !consensusReport),
    },
    {
      id: "closure",
      label: "闭环行动",
      description: "只有 ReportComposer 返回真实字段后才展示辟谣卡片、建议和归档状态。",
      producer: "ReportComposer",
      status: statusFromSignals(Boolean(finalReport), isStepRunning(steps, "report_composer")),
    },
  ];
}

function CaseDocketPanel({
  claim,
  steps,
  claimDecomposition,
  runStatus,
  finalReport,
  evidenceItemCount,
  searchJobs,
  consensusReport,
}: {
  claim: string;
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  runStatus: RunStatus;
  finalReport: Record<string, unknown> | null;
  evidenceItemCount: number;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
}) {
  const rumorStep = findAgentStep(steps, "rumor_detector");
  const pathSteps = buildCasePathSteps({
    steps,
    claimDecomposition,
    searchJobs,
    consensusReport,
    finalReport,
    evidenceItemCount,
  });
  const rumorTypes = readStringArray(rumorStep?.output.rumorTypes);
  const neededEvidence = readStringArray(rumorStep?.output.neededEvidence);

  return (
    <aside className="case-docket-panel" aria-label="案件卷宗">
      <div className="case-panel-heading">
        <span>Case Docket</span>
        <strong>案件卷宗</strong>
      </div>
      <section className="case-claim-card">
        <span>原始信息</span>
        <p>{claim}</p>
        <em>{runStatus === "running" ? "办理中" : runStatus === "completed" ? "已收束" : runStatus === "failed" ? "已中断" : "待立案"}</em>
      </section>

      <section className="case-real-data-card">
        <span>立案标签</span>
        {rumorTypes.length > 0 ? (
          <div className="case-tag-row">
            {rumorTypes.map((type) => (
              <strong key={type}>{type}</strong>
            ))}
          </div>
        ) : (
          <p>等待 RumorDetector 真实返回。</p>
        )}
      </section>

      <section className="case-real-data-card">
        <span>证据需求</span>
        {neededEvidence.length > 0 ? (
          <ul>
            {neededEvidence.slice(0, 4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>尚未收到模型生成的证据需求。</p>
        )}
      </section>

      <ol className="case-path-list" aria-label="调查路径">
        {pathSteps.map((item) => (
          <li key={item.id} className={`case-path-item case-path-item--${item.status}`}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.producer}</span>
            </div>
            <p>{item.description}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function AtomicQuestionsPanel({
  claimDecomposition,
}: {
  claimDecomposition: ClaimDecompositionResult | null;
}) {
  return (
    <section className="case-board-section" aria-label="原子命题">
      <div className="case-section-heading">
        <span>Atomic Questions</span>
        <strong>拆题结果</strong>
      </div>
      {claimDecomposition ? (
        <div className="case-atom-list">
          {claimDecomposition.atomicPropositions.map((proposition, index) => (
            <article key={proposition.id}>
              <span>A{index + 1}</span>
              <p>{proposition.text}</p>
              <small>{proposition.type} · {proposition.verifiability}</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="case-empty-state">等待 RumorDetector 的真实 claimAtoms。这里不会用模板拆题替代。</p>
      )}
    </section>
  );
}

function SourceTracePanel({ steps }: { steps: HandoffStep[] }) {
  const sourceStep = findAgentStep(steps, "source_validator");
  const verifiedSources = readStringArray(sourceStep?.output.verifiedSources);
  const questionableSources = readStringArray(sourceStep?.output.questionableSources);
  const missingSources = readStringArray(sourceStep?.output.missingSources);
  const notes = typeof sourceStep?.output.verificationNotes === "string" ? sourceStep.output.verificationNotes : "";

  return (
    <section className="case-board-section" aria-label="溯源记录">
      <div className="case-section-heading">
        <span>Source Trace</span>
        <strong>溯源记录</strong>
      </div>
      {sourceStep ? (
        <div className="case-source-grid">
          <article>
            <span>已验证</span>
            <strong>{verifiedSources.length}</strong>
            <p>{verifiedSources[0] ?? "模型未返回 verifiedSources。"}</p>
          </article>
          <article>
            <span>存疑</span>
            <strong>{questionableSources.length}</strong>
            <p>{questionableSources[0] ?? "模型未返回 questionableSources。"}</p>
          </article>
          <article>
            <span>缺失</span>
            <strong>{missingSources.length}</strong>
            <p>{missingSources[0] ?? "模型未返回 missingSources。"}</p>
          </article>
          {notes ? <p className="case-source-note">{notes}</p> : null}
        </div>
      ) : (
        <p className="case-empty-state">SourceValidator 尚未返回；不展示推测来源。</p>
      )}
    </section>
  );
}

function EvidenceBoardPanel({
  steps,
  claimDecomposition,
  searchJobs,
  consensusReport,
  consensusStarted,
  onSelectProposition,
}: {
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  consensusStarted: boolean;
  onSelectProposition: (propositionId: string) => void;
}) {
  const stats = searchTaskStats(searchJobs);

  return (
    <section className="case-evidence-board" aria-label="证据板">
      <div className="case-board-topline">
        <div>
          <span>Evidence Board</span>
          <strong>证据板</strong>
        </div>
        <div className="case-stat-row" aria-label="搜索任务状态">
          <span>{stats.completed} 已完成</span>
          <span>{stats.running} 运行中</span>
          <span>{stats.failed} 失败</span>
          <span>{stats.sources} 来源</span>
        </div>
      </div>

      <AtomicQuestionsPanel claimDecomposition={claimDecomposition} />
      <SourceTracePanel steps={steps} />

      <section className="case-board-section" aria-label="多搜索引擎交叉验证">
        <div className="case-section-heading">
          <span>Cross Search Matrix</span>
          <strong>交叉验证矩阵</strong>
        </div>
        <p className="case-board-note">
          360 / AnySearch / Metaso / Tavily / Exa 对同一原子命题并行检索；失败项只记录失败，不补模拟证据。
        </p>
        <div className="mission-consensus-grid case-consensus-grid">
          <ConsensusProgressPanel
            claimDecomposition={claimDecomposition}
            searchJobs={searchJobs}
            consensusReport={consensusReport}
          />
          {consensusReport ? (
            <EvidenceMatrix
              consensusReport={consensusReport}
              searchJobs={searchJobs}
              onCellClick={onSelectProposition}
              onStatusClick={onSelectProposition}
            />
          ) : (
            <section className="workspace-panel">
              <div className="panel-heading">
                <span>Evidence Matrix</span>
                <strong>{consensusStarted ? "等待真实搜索返回" : "等待真实拆题结果"}</strong>
              </div>
            </section>
          )}
        </div>
      </section>
    </section>
  );
}

function ReasoningAuditPanel({
  steps,
  finalReport,
}: {
  steps: HandoffStep[];
  finalReport: Record<string, unknown> | null;
}) {
  const factStep = findAgentStep(steps, "fact_checker");
  const supportingEvidence = readStringArray(factStep?.output.supportingEvidence);
  const counterEvidence = readStringArray(factStep?.output.counterEvidence);
  const gaps = readStringArray(factStep?.output.unresolvedEvidenceGaps);
  const risks = logicRiskItems(finalReport);

  return (
    <section className="case-audit-panel" aria-label="逻辑推演审计">
      <div className="case-section-heading">
        <span>Reasoning Audit</span>
        <strong>逻辑推演</strong>
      </div>
      <div className="case-audit-grid">
        <article>
          <span>可支持</span>
          <strong>{supportingEvidence.length}</strong>
          <p>{supportingEvidence[0] ?? "等待 FactChecker 返回支持证据。"}</p>
        </article>
        <article>
          <span>反证/限制</span>
          <strong>{counterEvidence.length}</strong>
          <p>{counterEvidence[0] ?? "尚未收到反证或限制证据。"}</p>
        </article>
        <article>
          <span>证据缺口</span>
          <strong>{gaps.length}</strong>
          <p>{gaps[0] ?? "尚未收到未解决证据缺口。"}</p>
        </article>
      </div>
      {risks.length > 0 ? (
        <div className="case-risk-stack">
          {risks.slice(0, 3).map((risk) => (
            <article key={`${risk.label}-${risk.severity}`}>
              <strong>{risk.label}</strong>
              <p>{risk.explanation}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CaseVerdictPanel({
  claim,
  streamItems,
  finalReport,
  steps,
}: {
  claim: string;
  streamItems: MissionStreamItem[];
  finalReport: Record<string, unknown> | null;
  steps: HandoffStep[];
}) {
  return (
    <aside className="case-verdict-panel" aria-label="结论审计与闭环">
      <MissionStreamPanel items={streamItems} finalReport={finalReport} />
      <ReasoningAuditPanel steps={steps} finalReport={finalReport} />
      <MissionFinalReportPanel claim={claim} finalReport={finalReport} />
      {!finalReport ? (
        <section className="case-closure-waiting">
          <span>Closure Actions</span>
          <strong>闭环行动待生成</strong>
          <p>只有 ReportComposer 返回真实报告字段后，才会显示辟谣卡片、处理建议和案例库写入状态。</p>
        </section>
      ) : null}
    </aside>
  );
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
        <span>Live Case Log</span>
        <strong>实时办案记录</strong>
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
          <p className="mission-stream-empty">等待办案台分配第一个 Agent。</p>
        )}
      </div>
      {finalReport ? (
        <section className="mission-final-brief" aria-label="Agent 收束摘要">
          <span>Final Synthesis</span>
          <strong>{score !== null ? `收束完成 · 可信度 ${score}/100` : "Agent 已完成收束"}</strong>
          <p>
            {finalStatus ? `最终判断已生成，当前状态为「${finalStatus}」。` : "最终判断已生成。"}
            {reportText(finalReport, "conclusion") ? ` ${reportText(finalReport, "conclusion")}` : ""}
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
  const [selectedPropositionId, setSelectedPropositionId] = useState("");
  const [consensusStarted, setConsensusStarted] = useState(false);

  useEffect(() => {
    if (runStatus !== "running" || startedAt === null) return;

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(timer);
  }, [runStatus, startedAt]);

  useEffect(() => {
    const trimmedClaim = claim.trim();
    if (!trimmedClaim) return;

    dispatch({ type: "RESET_CONSENSUS" });
    setSelectedPropositionId("");
    setConsensusStarted(false);
  }, [claim, dispatch]);

  const runConsensusPipeline = useCallback(
    async (decomposition: ClaimDecompositionResult) => {
      dispatch({ type: "SET_CLAIM_DECOMPOSITION", payload: decomposition });

      const jobs = buildSearchJobs(
        decomposition.atomicPropositions.map((proposition) => proposition.text),
        { enableCounterSearch: true }
      );
      dispatch({ type: "SET_SEARCH_JOBS", payload: jobs });

      const completedJobs = await executeSearchJobs(jobs, { enableCounterSearch: true });
      dispatch({ type: "SET_SEARCH_JOBS", payload: completedJobs });
      dispatch({ type: "SET_CONSENSUS_REPORT", payload: evaluateConsensus(completedJobs) });
    },
    [dispatch]
  );

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

    const appendRuntimeChunk = (stageId: string, type: ChunkType, content: string) => {
      dispatch({
        type: "APPEND_STREAMING_CHUNK",
        payload: {
          stageId,
          chunk: buildRuntimeChunk(stageId, type, content),
        },
      });
    };

    const startTimer = window.setTimeout(() => {
      async function runStream() {
        dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
        dispatch({ type: "START_STREAMING_SESSION", payload: buildRuntimeStreamingSession(claim) });
        setSteps([]);
        setCurrentStep(null);
        setStreamItems([]);
        setFinalReport(null);
        setOutputItems([
          "建立案件卷宗。",
          "等待办案台按顺序分派 Agent。",
          "本页只展示真实调用过程、失败状态和真实返回字段。",
        ]);
        pushStreamItem({
          agentName: "办案台",
          title: "建立核查任务",
          detail: "办案台会按 Agent 顺序流式展开；未返回真实字段前不生成结论。",
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
                setOutputItems(outputItemsForStep(step, "running"));
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "running" },
                });
                appendRuntimeChunk(step.agent, "action", `${step.agentName} 开始调用国产大模型服务。`);
                outputItemsForStep(step, "running").slice(0, 2).forEach((item) => {
                  appendRuntimeChunk(step.agent, "action", item);
                });
                pushStreamItem({
                  agentName: step.agentName,
                  title: "开始真实模型调用",
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

                if (isNonAuthenticStep(step)) {
                  const message = `${step.agentName} 未返回真实模型结果，已停止展示结论。原因：${step.output.fallbackReason ?? "收到 demo-fallback 输出"}`;
                  setOutputItems([message, "办案台不会把降级结果包装成真实核查。"]);
                  setErrorMessage(message);
                  setStartedAt(null);
                  setRunStatus("failed");
                  appendRuntimeChunk(step.agent, "tool_call", message);
                  dispatch({
                    type: "UPDATE_STREAMING_STAGE",
                    payload: { stageId: step.agent, status: "error" },
                  });
                  pushStreamItem({
                    agentName: step.agentName,
                    title: "真实调用缺失，停止收束",
                    detail: message,
                    status: "failed",
                  });
                  dispatch({ type: "APPEND_HANDOFF_STEP", payload: { ...step, status: "failed" } });
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  return;
                }

                setOutputItems(outputItemsForStep(step, "completed"));
                appendRuntimeChunk(step.agent, step.model.includes("demo-fallback") ? "thought" : "result", summarizeStepOutput(step));
                appendRuntimeChunk(step.agent, "result", `模型链路：${step.model}，耗时 ${formatLatency(step.latencyMs)}。`);
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "completed" },
                });
                if (step.agent === "rumor_detector" && !step.model.includes("demo-fallback")) {
                  const decomposition = buildDecompositionFromRumorStep(claim, step);
                  if (decomposition) {
                    setConsensusStarted(true);
                    void runConsensusPipeline(decomposition).catch((error) => {
                      console.warn("Cross-search consensus pipeline failed:", error);
                    });
                  }
                }
                pushStreamItem({
                  agentName: step.agentName,
                  title: "模型返回结构化结果",
                  detail: processSummaryForStep(step, "completed"),
                  status: "completed",
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "tool_start": {
                appendRuntimeChunk("fact_checker", "tool_call", `${event.toolName ?? "工具"} 开始真实调用：${event.query ?? claim}`);
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: "开始工具调用",
                  detail: event.query ?? claim,
                  status: "running",
                });
                break;
              }
              case "tool_result": {
                const sourceCount = Array.isArray(event.result?.sources) ? event.result.sources.length : 0;
                appendRuntimeChunk(
                  "fact_checker",
                  "result",
                  `${event.toolName ?? "工具"} 返回真实结果：${event.model ?? "unknown"}，来源 ${sourceCount} 条。`
                );
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: "工具调用完成",
                  detail: `${event.model ?? "unknown"}，来源 ${sourceCount} 条`,
                  status: "completed",
                });
                break;
              }
              case "tool_error": {
                appendRuntimeChunk(
                  "fact_checker",
                  "tool_call",
                  `${event.toolName ?? "工具"} 真实调用失败：${event.error ?? event.message ?? "未知错误"}。不生成模拟证据。`
                );
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: "工具调用失败",
                  detail: event.error ?? event.message ?? "未产生可引用证据",
                  status: "failed",
                });
                break;
              }
              case "agent_error": {
                const step = buildStep(event, "failed");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setErrorMessage(event.error ?? event.message ?? `${step.agentName} 真实调用失败`);
                appendRuntimeChunk(step.agent, "thought", `真实模型调用异常：${event.error ?? event.message ?? "未知错误"}。`);
                pushStreamItem({
                  agentName: step.agentName,
                  title: "真实调用失败，停止生成结论",
                  detail: event.error ?? event.message ?? `${step.agentName} 执行失败`,
                  status: "failed",
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "complete": {
                const finalSteps =
                  event.steps && event.steps.length > 0 ? event.steps : accumulatedSteps;
                const finalReport = event.finalReport;
                const nonAuthenticStep = finalSteps.find(isNonAuthenticStep);
                if (nonAuthenticStep) {
                  const message = `${nonAuthenticStep.agentName} 含有非真实降级输出，办案台已拒绝生成最终判断。`;
                  setStartedAt(null);
                  setRunStatus("failed");
                  setErrorMessage(message);
                  setFinalReport(null);
                  setOutputItems([message, "请检查模型服务或 API Key 后重新发起真实核查。"]);
                  pushStreamItem({
                    agentName: "办案台",
                    title: "拒绝展示非真实结论",
                    detail: message,
                    status: "failed",
                  });
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  return;
                }
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
                dispatch({ type: "END_STREAMING_SESSION" });

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
                setErrorMessage("");
                {
                  const conclusion = reportText(finalReport ?? null, "conclusion");
                  const label = reportText(finalReport ?? null, "credibilityLabel");
                  const recommendation = reportText(finalReport ?? null, "recommendation");
                  const score =
                    typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : null;
                  setOutputItems([
                    conclusion ? `最终判断：${conclusion}` : "ReportComposer 已完成，但未返回 conclusion 字段。",
                    label || score !== null ? `可信度：${label || "未标注"}${score !== null ? ` · ${score}/100` : ""}` : "",
                    recommendation ? `处理建议：${recommendation}` : "",
                  ].filter(Boolean));
                }
                pushStreamItem({
                  agentName: "ReportComposer",
                  title: "最终判断已生成",
                  detail: reportText(finalReport ?? null, "conclusion") || "ReportComposer 已完成，但未返回 conclusion 字段。",
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
                  agentName: "办案台",
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
  }, [claim, dispatch, knowledgeBase, runConsensusPipeline, state.diagnosis]);

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
    <main className="mission-control-view case-workbench-view">
      <header className="mission-topbar">
        <div className="mission-brand">
          <strong>红鲱鱼与枪</strong>
          <span>Case Workbench</span>
        </div>
        <button className="mission-cancel-btn" type="button" onClick={onCancel}>
          取消核查
        </button>
      </header>

      <section className="case-workbench-shell" aria-label="真实核查办案台">
        <CaseDocketPanel
          claim={claim}
          steps={steps}
          claimDecomposition={state.claimDecomposition}
          runStatus={runStatus}
          finalReport={finalReport}
          evidenceItemCount={evidenceItemCount}
          searchJobs={state.searchJobs}
          consensusReport={state.consensusReport}
        />

        <section className="case-center-column" aria-label="当前 Agent 与证据板">
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

          <EvidenceBoardPanel
            steps={steps}
            claimDecomposition={state.claimDecomposition}
            searchJobs={state.searchJobs}
            consensusReport={state.consensusReport}
            consensusStarted={consensusStarted}
            onSelectProposition={setSelectedPropositionId}
          />
        </section>

        <CaseVerdictPanel
          claim={claim}
          streamItems={streamItems}
          finalReport={finalReport}
          steps={steps}
        />
      </section>

      <StepTimeline steps={steps} currentAgent={currentAgent} />
      <CanvasThumbnail steps={steps} currentAgent={currentAgent} />

      {/* 交叉验证实时流式推理面板 */}
      <StreamingReasoningPanel session={state.streamingSession} />

      {state.consensusReport ? (
        <EvidenceDetailDrawer
          isOpen={Boolean(selectedPropositionId)}
          onClose={() => setSelectedPropositionId("")}
          propositionId={selectedPropositionId}
          consensusReport={state.consensusReport}
          searchJobs={state.searchJobs}
        />
      ) : null}
    </main>
  );
}
