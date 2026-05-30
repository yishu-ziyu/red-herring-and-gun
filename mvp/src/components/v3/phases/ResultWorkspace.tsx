import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HandoffResult, HandoffStep } from "../../../lib/agentExpansion";
import type { CanvasEdge, CanvasNode } from "../../../data/reasoningCanvas";
import type { ClaimDiagnosis, KnowledgeBaseEntry, VerificationResult } from "../../../lib/schemas";
import { normalizeAgentBiasFindings } from "../../../lib/biasAudit";
import { buildConfidenceAssessments, extractConfidenceAssessments } from "../../../lib/confidenceEngine";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import {
  archiveDoubtful,
  buildRebuttalCardMarkdown,
  calculateCredibilityScore,
  downloadFile,
  getDoubtfulArchiveCount,
  shareVerification,
  type ClosureReportPayload,
} from "../../../lib/reportExporter";
import { buildSpindleCanvas } from "../../../lib/spindleCanvasBuilder";
import { useReasoning } from "../../../store/reasoningStore";
import { ReasoningWorkspaceV3 } from "../ReasoningWorkspaceV3";
import { EvidenceMap } from "./EvidenceMap";
import { BenchmarkPanel } from "../panels/BenchmarkPanel";
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
  return buildSpindleCanvas(result.claim, result);
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

function collectClosureSources(steps: HandoffStep[]) {
  const sources: string[] = [];
  steps.forEach((step) => {
    ["sources", "verifiedSources", "questionableSources"].forEach((key) => {
      const value = step.output[key];
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === "string" && item.trim()) sources.push(item.trim());
        });
      }
    });
  });
  return Array.from(new Set(sources)).slice(0, 8);
}

function inferVerificationResult(score: number): VerificationResult {
  if (score >= 70) return "true";
  if (score >= 40) return "partial";
  return "unknown";
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
  const [actionMessage, setActionMessage] = useState("");
  const [archiveCount, setArchiveCount] = useState(0);
  const savedKnowledgeIdRef = useRef<string | null>(null);
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);

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
  const modelSummary = useMemo(() => {
    const models = Array.from(new Set(reportSteps.map((step) => step.model).filter(Boolean)));
    if (models.length === 0) return "";
    return models.length > 2 ? `${models.slice(0, 2).join(" / ")} +${models.length - 2}` : models.join(" / ");
  }, [reportSteps]);
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
  const logicRiskItems = useMemo(() => {
    const findings = [
      ...normalizeAgentBiasFindings(report, { agentId: "final_report" }),
      ...reportSteps.flatMap((step) => normalizeAgentBiasFindings(step.output, { agentId: step.agent })),
      ...(state.report ? normalizeAgentBiasFindings(state.report, { agentId: "demo_report" }) : []),
    ];

    const seen = new Set<string>();
    return findings.filter((item) => {
      const key = `${item.label}-${item.explanation}-${item.severity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [report, reportSteps, state.report]);
  const confidenceReport = useMemo(
    () => ({
      nextEvidenceNeeded: state.report?.nextEvidenceNeeded ?? [],
      evidenceQualitySummary: state.report?.evidenceQualitySummary,
      logicRiskItems,
    }),
    [logicRiskItems, state.report?.evidenceQualitySummary, state.report?.nextEvidenceNeeded]
  );
  const confidenceAssessments = useMemo(
    () =>
      extractConfidenceAssessments(
        report.confidenceDimensions ?? buildConfidenceAssessments(credibilityScore, reportSteps, confidenceReport),
        credibilityScore,
        reportSteps,
        confidenceReport
      ),
    [confidenceReport, credibilityScore, report.confidenceDimensions, reportSteps]
  );

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
  const closurePayload = useMemo<ClosureReportPayload>(
    () => ({
      claim: claim || state.originalClaim,
      conclusion,
      credibilityScore,
      credibilityLabel,
      summaryForPublic,
      sources: collectClosureSources(reportSteps),
    }),
    [claim, conclusion, credibilityLabel, credibilityScore, reportSteps, state.originalClaim, summaryForPublic]
  );

  useEffect(() => {
    setArchiveCount(getDoubtfulArchiveCount());
  }, []);

  useEffect(() => {
    if (!closurePayload.claim || reportSteps.length === 0 || !state.diagnosis) return;
    const entryId = `case-${closurePayload.claim.replace(/\s+/g, "-").slice(0, 48)}-result`;
    if (savedKnowledgeIdRef.current === entryId) return;
    savedKnowledgeIdRef.current = entryId;

    const entry: KnowledgeBaseEntry = {
      id: entryId,
      claim: closurePayload.claim,
      rumorType: state.diagnosis.risk.includes("政治")
        ? "政治"
        : state.diagnosis.risk.includes("娱乐")
          ? "娱乐"
          : "结果态",
      diagnosis: state.diagnosis,
      finalReport: handoffResult?.finalReport ?? state.report ?? {},
      handoffSteps: reportSteps,
      credibilityScore,
      verificationResult: inferVerificationResult(credibilityScore),
      timestamp: Date.now(),
      tags: [
        "result",
        credibilityLabel,
        ...(state.diagnosis.rumorIndicators ?? []),
      ],
    };

    void knowledgeBase.saveCase(entry);
  }, [
    closurePayload.claim,
    credibilityLabel,
    credibilityScore,
    handoffResult?.finalReport,
    knowledgeBase,
    reportSteps,
    state.diagnosis,
    state.report,
  ]);

  const handleSourceClick = useCallback(
    (sourceId: string) => {
      setHighlightedNodeId(citationNodeMap.get(sourceId) ?? graphNodes[0]?.id);
    },
    [citationNodeMap, graphNodes]
  );

  const handleExport = useCallback(() => {
    const md = [
      "# 红鲱鱼与枪 — 结果工作台报告",
      "",
      `**待核查信息**：${closurePayload.claim}`,
      `**结论**：${closurePayload.credibilityLabel}（${closurePayload.credibilityScore}%）`,
      "",
      closurePayload.conclusion,
      "",
      "## 公众摘要",
      closurePayload.summaryForPublic,
      "",
      "## 可复核来源",
      ...(closurePayload.sources.length > 0
        ? closurePayload.sources.map((source) => `- ${source}`)
        : ["- 暂无来源，建议继续补证。"]),
    ].join("\n");
    downloadFile(md, `红鲱鱼与枪结果报告_${closurePayload.claim.slice(0, 18)}.md`, "text/markdown;charset=utf-8");
    setActionMessage("报告已导出为 Markdown。");
  }, [closurePayload]);

  const handleRebuttalCard = useCallback(() => {
    const md = buildRebuttalCardMarkdown(closurePayload);
    downloadFile(md, `红鲱鱼与枪辟谣卡片_${closurePayload.claim.slice(0, 18)}.md`, "text/markdown;charset=utf-8");
    setActionMessage("辟谣卡片已生成。");
  }, [closurePayload]);

  const handleArchive = useCallback(() => {
    archiveDoubtful(closurePayload);
    const nextCount = getDoubtfulArchiveCount();
    setArchiveCount(nextCount);
    setActionMessage(`已存疑归档，当前共 ${nextCount} 条。`);
  }, [closurePayload]);

  const handleShare = useCallback(async () => {
    const entry = await shareVerification(closurePayload);
    setActionMessage(entry.channel === "native-share" ? "已调用系统分享。" : "已复制分享文本。");
  }, [closurePayload]);

  return (
    <main className="result-workspace">
      <header className="result-topbar">
        <div className="result-brand">
          <strong>红鲱鱼与枪</strong>
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
            confidenceAssessments={confidenceAssessments}
            logicRiskItems={logicRiskItems}
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
          <BenchmarkPanel handoffRuns={state.handoffRuns} />
        </section>
      ) : null}

      <footer className="result-bottom-bar">
        <button type="button" onClick={handleExport}>导出报告</button>
        <button type="button" onClick={handleRebuttalCard}>辟谣卡片</button>
        <button type="button" onClick={handleArchive}>存疑归档</button>
        <button type="button" onClick={handleShare}>分享核查</button>
        {actionMessage ? <em className="result-action-message">{actionMessage}</em> : null}
        <span>
          {handoffResult
            ? `模型核查 ${reportSteps.length} 步完成${modelSummary ? ` · ${modelSummary}` : ""}`
            : state.isExpanding
              ? "正在调用国产大模型刷新报告"
              : "快速分析结果"}
          {archiveCount > 0 ? ` · 存疑 ${archiveCount}` : ""}
        </span>
      </footer>
    </main>
  );
}
