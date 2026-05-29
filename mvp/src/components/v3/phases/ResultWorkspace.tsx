import { useCallback, useMemo, useState } from "react";
import type { HandoffResult, HandoffStep } from "../../../lib/agentExpansion";
import type { CanvasEdge, CanvasNode } from "../../../data/reasoningCanvas";
import type { ClaimDiagnosis } from "../../../lib/schemas";
import { calculateCredibilityScore } from "../../../lib/reportExporter";
import { useReasoning } from "../../../store/reasoningStore";
import { ReasoningWorkspaceV3 } from "../ReasoningWorkspaceV3";
import { EvidenceMap } from "./EvidenceMap";
import { ReportPanel } from "./result/ReportPanel";

interface ResultWorkspaceProps {
  claim: string;
  handoffResult: HandoffResult | null;
  onReset: () => void;
}

type ResultTab = "canvas" | "report" | "settings";

const FALLBACK_LABEL = "部分可信";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAgent(agent?: string) {
  return (agent ?? "").trim().toLowerCase();
}

function buildCitationNodeMap(nodes: CanvasNode[]) {
  const map = new Map<string, string>();
  nodes.forEach((node) => {
    if (node.sourceRef?.candidateId) {
      map.set(node.sourceRef.candidateId, node.id);
    }
    if (node.id.startsWith("handoff-source-")) {
      const citationId = node.id.replace("handoff-source-", "");
      map.set(citationId, node.id);
    }
  });
  return map;
}

function buildHandoffEvidenceGraph(result: HandoffResult | null): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  if (!result || result.steps.length === 0) return { nodes: [], edges: [] };

  const nodes: CanvasNode[] = [
    {
      id: "handoff-controller",
      type: "agent_task",
      title: "Handoff 调度器",
      subtitle: `调度 ${result.steps.length} 个 Agent`,
      x: 12,
      y: 50,
      status: "handoff",
      handoffState: result.steps.some((step) => step.status === "failed") ? "failed" : "completed",
      revealStage: 99,
    },
  ];
  const edges: CanvasEdge[] = [];
  const positions: Record<string, { x: number; y: number }> = {
    rumor_detector: { x: 32, y: 50 },
    fact_checker: { x: 52, y: 32 },
    source_validator: { x: 52, y: 68 },
    report_composer: { x: 72, y: 50 },
  };
  const nodeIdForAgent = new Map<string, string>();

  result.steps.forEach((step, index) => {
    const agent = normalizeAgent(step.agent);
    const pos = positions[agent] ?? { x: 30 + index * 16, y: index % 2 === 0 ? 42 : 58 };
    const nodeId = `handoff-agent-${agent || index}`;
    nodeIdForAgent.set(agent, nodeId);
    nodes.push({
      id: nodeId,
      type: "agent_task",
      title: `${step.agentIcon || "◆"} ${step.agentName}`,
      subtitle: summarizeStepOutput(step),
      x: pos.x,
      y: pos.y,
      status: "handoff",
      handoffState: step.status,
      revealStage: 99,
    });
  });

  const rumorNode = nodeIdForAgent.get("rumor_detector");
  const factNode = nodeIdForAgent.get("fact_checker");
  const sourceNode = nodeIdForAgent.get("source_validator");
  const reportNode = nodeIdForAgent.get("report_composer");

  if (rumorNode) {
    edges.push({ id: "handoff-edge-controller-rumor", from: "handoff-controller", to: rumorNode, label: "claim", revealStage: 99, animated: true });
  }
  if (rumorNode && factNode) {
    edges.push({ id: "handoff-edge-rumor-fact", from: rumorNode, to: factNode, label: "fact-check", revealStage: 99, animated: true, style: "parallel_split" });
  }
  if (rumorNode && sourceNode) {
    edges.push({ id: "handoff-edge-rumor-source", from: rumorNode, to: sourceNode, label: "source-check", revealStage: 99, animated: true, style: "parallel_split" });
  }
  if (factNode && reportNode) {
    edges.push({ id: "handoff-edge-fact-report", from: factNode, to: reportNode, label: "findings", revealStage: 99, animated: true, style: "parallel_join" });
  }
  if (sourceNode && reportNode) {
    edges.push({ id: "handoff-edge-source-report", from: sourceNode, to: reportNode, label: "sources", revealStage: 99, animated: true, style: "parallel_join" });
  }

  if (result.finalReport) {
    nodes.push({
      id: "handoff-report",
      type: "evidence_need",
      title: "核查报告",
      subtitle: getString(result.finalReport.conclusion) || "综合核查报告已生成",
      x: 88,
      y: 50,
      status: "handoff",
      handoffState: "completed",
      revealStage: 99,
    });
    if (reportNode) {
      edges.push({ id: "handoff-edge-report-final", from: reportNode, to: "handoff-report", label: "report", revealStage: 99, animated: true });
    }
  }

  return { nodes, edges };
}

function summarizeStepOutput(step: HandoffStep) {
  if (step.status === "failed") return step.error ?? "执行失败";

  const output = step.output;
  if (typeof output.conclusion === "string") return output.conclusion.slice(0, 80);
  if (typeof output.analysis === "string") return output.analysis.slice(0, 80);
  if (Array.isArray(output.keyFindings) && output.keyFindings.length > 0) {
    return String(output.keyFindings[0]).slice(0, 80);
  }
  if (typeof output.verificationNotes === "string") return output.verificationNotes.slice(0, 80);
  return step.status === "completed" ? "结构化输出已完成" : "等待执行";
}

function pickReportSteps(handoffResult: HandoffResult | null) {
  return handoffResult?.steps ?? [];
}

function buildQuickAnalysisSteps(
  diagnosis: ClaimDiagnosis | null,
  doNotInfer: string[],
  nextEvidenceNeeded: string[]
): HandoffStep[] {
  const now = Date.now();
  const evidenceTitles = [
    diagnosis?.risk ? `风险信号：${diagnosis.risk}` : "",
    diagnosis?.whyNotDirectFactCheck ? `证据边界：${diagnosis.whyNotDirectFactCheck}` : "",
    diagnosis?.rumorIndicators?.length
      ? `谣言特征：${diagnosis.rumorIndicators.join("、")}`
      : "",
    ...nextEvidenceNeeded.slice(0, 2).map((item) => `待补证据：${item}`),
  ].filter(Boolean);
  const keyFindings = [
    diagnosis?.whyNotDirectFactCheck
      ? `核查边界：${diagnosis.whyNotDirectFactCheck}`
      : "当前材料还不足以直接判定为真或假。",
    diagnosis?.risk ? `文本风险：${diagnosis.risk}` : "",
    nextEvidenceNeeded[0] ? `待补证据：${nextEvidenceNeeded[0]}` : "",
  ].filter(Boolean);

  return [
    {
      agent: "rumor_detector",
      agentName: "RumorDetector",
      agentIcon: "!",
      systemPrompt: "",
      input: {},
      output: {
        rumorIndicators: diagnosis?.rumorIndicators ?? [],
        analysis: diagnosis?.risk ?? "需要先识别文本中的风险信号。",
        detectedPatterns: diagnosis?.ambiguousTerms ?? [],
      },
      model: "demo-pipeline",
      latencyMs: 0,
      timestamp: now,
      status: "completed",
    },
    {
      agent: "fact_checker",
      agentName: "FactChecker",
      agentIcon: "?",
      systemPrompt: "",
      input: {},
      output: {
        factCheckResult: "partial",
        confidence: "medium",
        keyFindings,
        counterEvidence: doNotInfer,
        sources: evidenceTitles,
      },
      model: "demo-pipeline",
      latencyMs: 0,
      timestamp: now + 1,
      status: "completed",
    },
    {
      agent: "source_validator",
      agentName: "SourceValidator",
      agentIcon: "#",
      systemPrompt: "",
      input: {},
      output: {
        sourceReliability: evidenceTitles.length > 0 ? "medium" : "unverified",
        verifiedSources: evidenceTitles,
        missingSources: nextEvidenceNeeded,
        verificationNotes: nextEvidenceNeeded.length > 0
          ? `仍需补充：${nextEvidenceNeeded.slice(0, 3).join("；")}`
          : "当前 Demo 证据链已生成。",
      },
      model: "demo-pipeline",
      latencyMs: 0,
      timestamp: now + 2,
      status: "completed",
    },
  ];
}

export function ResultWorkspace({ claim, handoffResult, onReset }: ResultWorkspaceProps) {
  const { state } = useReasoning();
  const [activeTab, setActiveTab] = useState<ResultTab>("report");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | undefined>();

  const fallbackCredibility = useMemo(() => {
    if (!state.report || !state.diagnosis) return { score: 50, label: FALLBACK_LABEL };
    const fallbackCase = {
      originalClaim: state.originalClaim,
      rumorType: undefined,
      useContext: "结果工作台",
      diagnosis: state.diagnosis,
      subclaims: state.report.subclaimStatuses.map((status) => ({
        id: status.subclaimId,
        text: status.subclaim,
        type: "事件事实" as const,
        roleInArgument: status.status,
      })),
      routes: [],
      searchPlans: [],
      candidates: [],
    };
    return calculateCredibilityScore(fallbackCase, state.report);
  }, [state.diagnosis, state.originalClaim, state.report]);

  const report = handoffResult?.finalReport ?? {};
  const reportSteps = useMemo(() => {
    const handoffSteps = pickReportSteps(handoffResult);
    if (handoffSteps.length > 0) return handoffSteps;
    return buildQuickAnalysisSteps(
      state.diagnosis,
      state.diagnosis
        ? [
            state.diagnosis.whyNotDirectFactCheck,
            "不能把情绪化比喻直接当作事实证据。",
          ].filter(Boolean)
        : state.report?.doNotInfer ?? [],
      state.diagnosis
        ? [
            state.diagnosis.whyNotDirectFactCheck,
            ...state.diagnosis.ambiguousTerms.map((term) => `需要明确“${term}”的定义、剂量或证据口径。`),
          ].filter(Boolean)
        : state.report?.nextEvidenceNeeded ?? []
    );
  }, [handoffResult, state.diagnosis, state.report]);
  const conclusion =
    getString(report.conclusion) ||
    (handoffResult
      ? state.report?.allowedConclusion
      : state.report?.overallStatus && state.diagnosis?.risk
        ? `${state.report.overallStatus}：${state.diagnosis.risk}`
        : "") ||
    "当前信息需要更多证据，暂不能直接判定为真或假。";
  const credibilityScore = getNumber(report.credibilityScore) ?? fallbackCredibility.score;
  const credibilityLabel = getString(report.credibilityLabel) || fallbackCredibility.label;
  const summaryForPublic =
    getString(report.summaryForPublic) ||
    (handoffResult
      ? state.report?.rewrittenClaim.publicFacing
      : state.diagnosis?.whyNotDirectFactCheck || state.diagnosis?.risk) ||
    conclusion;

  const graphResult = useMemo<HandoffResult | null>(() => {
    if (handoffResult) return handoffResult;
    if (reportSteps.length === 0) return null;
    return {
      claim: claim || state.originalClaim,
      steps: reportSteps,
      finalReport: {
        conclusion,
        credibilityScore,
        credibilityLabel,
        summaryForPublic,
      },
    };
  }, [
    claim,
    conclusion,
    credibilityLabel,
    credibilityScore,
    handoffResult,
    reportSteps,
    state.originalClaim,
    summaryForPublic,
  ]);
  const derivedGraph = useMemo(() => buildHandoffEvidenceGraph(graphResult), [graphResult]);
  const graphNodes = derivedGraph.nodes.length > 0 ? derivedGraph.nodes : state.nodes;
  const graphEdges = derivedGraph.nodes.length > 0 ? derivedGraph.edges : state.edges;
  const citationNodeMap = useMemo(() => buildCitationNodeMap(graphNodes), [graphNodes]);

  const handleSourceClick = useCallback(
    (sourceId: string) => {
      setHighlightedNodeId(citationNodeMap.get(sourceId) ?? graphNodes[0]?.id);
    },
    [citationNodeMap, graphNodes]
  );

  return (
    <main className="result-workspace">
      <header className="result-topbar">
        <div className="result-brand">
          <strong>真探 Agent</strong>
          <span>Result Workspace</span>
        </div>
        <nav className="result-tabs" aria-label="结果工作区">
          {(["canvas", "report", "settings"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "canvas" ? "画布" : tab === "report" ? "报告" : "设置"}
            </button>
          ))}
        </nav>
        <button className="result-reset-btn" type="button" onClick={onReset}>
          重新核查
        </button>
      </header>

      {activeTab === "report" ? (
        <section className="result-report-layout">
          <ReportPanel
            claim={claim || state.originalClaim}
            rumorType={state.diagnosis?.mixedJudgments.slice(0, 2).join(" / ")}
            conclusion={conclusion}
            credibilityScore={credibilityScore}
            credibilityLabel={credibilityLabel}
            summaryForPublic={summaryForPublic}
            steps={reportSteps}
            onSourceClick={handleSourceClick}
          />
          <EvidenceMap
            nodes={graphNodes}
            edges={graphEdges}
            highlightedNodeId={highlightedNodeId}
            onNodeClick={setHighlightedNodeId}
            onToggleFullscreen={() => setActiveTab("canvas")}
          />
        </section>
      ) : null}

      {activeTab === "canvas" ? (
        <section className="result-canvas-tab">
          <ReasoningWorkspaceV3 orchestrateMode={false} />
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="result-settings-tab">
          <h2>设置</h2>
          <p>当前版本保留结果态设置入口，后续可接入导出格式、证据阈值和人工判定偏好。</p>
        </section>
      ) : null}

      <footer className="result-bottom-bar">
        <button type="button">导出报告</button>
        <button type="button">复制摘要</button>
        <button type="button">继续追问</button>
        <span>{handoffResult ? `深度核查 ${reportSteps.length} 步完成` : "快速分析结果"}</span>
      </footer>
    </main>
  );
}
