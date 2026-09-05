/**
 * reportFallback.ts — ReportComposer 失败时的确定性兜底报告与共识辩论构建。
 * 结构完整、不撒谎、不空白；分数走公式路径。
 */

import { computeFormulaScore } from "./formulaScore.js";

import { labelForScore } from "./credibilityScore.js";

import { applyExclusionLayerToReport } from "./reportAssembly/index.js";

import { applyFactDeskPostProcessToReport } from "./factDeskPostProcess.js";

import { applyPublicCopy } from "./publicCopy.js";

import { stringItems } from "./valueCoerce.js";

export async function runReportComposerWithFallback({
  claim,
  steps,
  search360Result,
  runAgent,
  onFallback,
}: {
  claim: string;
  steps: any[];
  search360Result: any;
  runAgent: (agentId: string, steps: any[], search360Result?: any) => Promise<any>;
  onFallback?: (step: any) => void;
}) {
  try {
    return await runAgent("report_composer", steps, search360Result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ReportComposer 调用失败";
    const startedAt = Date.now();
    const fallbackStep = {
      agent: "report_composer",
      agentName: "ReportComposer",
      agentIcon: "📝",
      systemPrompt: "deterministic fallback report",
      input: {
        claim,
        fallbackReason: message,
      },
      output: buildDeterministicFinalReport(claim, steps, search360Result, message),
      model: "fallback:deterministic-report",
      latencyMs: Date.now() - startedAt,
      timestamp: Date.now(),
      status: "completed",
    };
    onFallback?.(fallbackStep);
    return fallbackStep;
  }
}

export function buildDeterministicFinalReport(claim: string, steps: any[], searchResult: any, reason: string) {
  const rumorStep = steps.find((step) => step.agent === "rumor_detector");
  const factStep = [...steps].reverse().find((step) => step.agent === "fact_checker");
  const sourceStep = steps.find((step) => step.agent === "source_validator");
  const factResult = String(factStep?.output?.factCheckResult || "unverified");
  const sourceReliability = String(sourceStep?.output?.sourceReliability || "unverified");
  const keyFindings = stringItems(factStep?.output?.keyFindings);
  const counterEvidence = stringItems(factStep?.output?.counterEvidence);
  const verifiedSources = stringItems(sourceStep?.output?.verifiedSources);
  const questionableSources = stringItems(sourceStep?.output?.questionableSources);
  const missingSources = stringItems(sourceStep?.output?.missingSources);
  const searchSources = Array.isArray(searchResult?.sources) ? searchResult.sources.slice(0, 5) : [];
  const searchGaps = stringItems(searchResult?.unresolvedEvidenceGaps);
  const hasCounterEvidence = counterEvidence.length > 0 || stringItems(searchResult?.contradictingEvidence).length > 0;
  const hasMissingSources = missingSources.length > 0 || searchGaps.length > 0;
  const verdictType =
    factResult === "true" && !hasCounterEvidence && sourceReliability !== "low"
      ? "true"
      : factResult === "false"
        ? "false"
        : factResult === "partial" || hasCounterEvidence
          ? "mixed_misleading"
          : "unverified";
  // 审查 P2-2 修复：fallback 路径也调用 computeFormulaScore，
  // 让 rumor severity / missingSources / search evidence 等分量真正生效；
  // label 统一引用 labelForScore（基于 SCORE_LABELS），与公式路径一致。
  // computeFormulaScore 失败返回 null 时再退回 verdictType→固定分数兜底。
  const fallbackFormula = computeFormulaScore(
    rumorStep?.output,
    factStep?.output,
    sourceStep?.output,
    searchResult
  );
  const credibilityScore = fallbackFormula
    ? fallbackFormula.score
    : verdictType === "true" ? 72 :
      verdictType === "false" ? 18 :
      verdictType === "mixed_misleading" ? 45 :
      36;
  const credibilityLabel = fallbackFormula
    ? fallbackFormula.label
    : labelForScore(credibilityScore);
  const firstFinding = keyFindings[0] || String(searchResult?.answer || "").slice(0, 160) || "当前证据不足以直接确认原始说法。";
  const missingText = [...missingSources, ...searchGaps].slice(0, 2).join("；") || "仍需要更权威或原始来源复核。";
  const conclusion =
    verdictType === "true"
      ? `当前证据较支持该说法，但仍需保留来源边界：${firstFinding}`
      : verdictType === "false"
        ? `当前证据不支持该说法。`
        : verdictType === "mixed_misleading"
          ? `这条说法要拆开看：有真实片段，也有夸大或偷换。`
          : `公开材料还撑不住这条说法。`;

  const report: Record<string, unknown> = {
    verdictType,
    conclusion,
    credibilityScore,
    credibilityLabel,
    recommendation: hasMissingSources
      ? "先把出处补上，再判断这句话站不站得住。"
      : "按现有证据判断原句站不站得住，并标出查不清的部分。",
    summaryForPublic: `${conclusion} 本报告由兜底生成，因为最终写作模型未在服务时间内完成。`,
    whyHardToVerify: [
      reason.slice(0, 220),
      missingText,
      "搜索结果和 Agent 输出只能作为核查线索，不能替代原始材料或权威发布。",
    ],
    evidenceChain: [
      {
        layer: "原始命题",
        finding: claim.slice(0, 220),
        evidence: stringItems(rumorStep?.output?.rumorIndicators).slice(0, 3).join("；") || "未检测到足够明确的结构化谣言特征。",
        boundary: "这一步只识别表达风险，不直接判定真假。",
        sourceRefs: ["RumorDetector"],
      },
      {
        layer: "事实核查",
        finding: firstFinding,
        evidence: keyFindings.slice(0, 3).join("；") || "FactChecker 未返回足够关键发现。",
        boundary: "事实核查结果需要结合来源可靠性一起解释。",
        sourceRefs: ["FactChecker"],
      },
      {
        layer: "信源审计",
        finding: verifiedSources[0] || questionableSources[0] || missingText,
        evidence: [...verifiedSources, ...questionableSources].slice(0, 3).join("；") || "缺少可直接采信的信源列表。",
        boundary: "有来源线索不等于来源已被确认为权威。",
        sourceRefs: ["SourceValidator"],
      },
      {
        layer: "搜索来源",
        finding: searchSources[0]?.title || "搜索服务返回的来源有限。",
        evidence: searchSources.map((source: any, index: number) => `${index + 1}. ${source?.title || source?.url || "未命名来源"}`).join("；"),
        boundary: "搜索摘要只能提供交叉验证线索，不能单独推出最终事实。",
        sourceRefs: searchSources.map((source: any, index: number) => String(source?.url || source?.title || `S${index + 1}`)),
      },
      {
        layer: "结论边界",
        finding: conclusion,
        evidence: [...counterEvidence, ...searchGaps].slice(0, 3).join("；") || missingText,
        boundary: "最终写作模型超时，因此本结论采用保守兜底。",
        sourceRefs: ["FallbackReport"],
      },
    ],
    causalBoundary: "本次核查只能判断公开材料对原命题的支持程度，不能推出未被来源覆盖的因果、医学或政策结论。",
    closureActions: [
      {
        type: "archive_doubt",
        label: "保存证据边界",
        content: missingText,
        status: "ready",
      },
      {
        type: "follow_up",
        label: "补查原始来源",
        content: "优先寻找官方发布、原始研究、专业机构说明或当事方一手材料。",
        status: hasMissingSources ? "needs_review" : "ready",
      },
      {
        type: "share_public",
        label: "能信的部分",
        content: "只说证据已经撑住的部分，查不清的不要说成已经核实。",
        status: "needs_review",
      },
    ],
    confidenceDimensions: [
      buildConfidenceDimension("source_reliability", "来源可靠性", sourceReliability === "high" ? 78 : sourceReliability === "medium" ? 62 : 42, 70, sourceReliability === "high", sourceReliability),
      buildConfidenceDimension("evidence_completeness", "证据完整度", hasMissingSources ? 45 : 66, 60, !hasMissingSources, missingText),
      buildConfidenceDimension("consistency", "逻辑一致性", hasCounterEvidence ? 55 : 72, 75, !hasCounterEvidence, hasCounterEvidence ? "存在反证或冲突线索" : "未发现明显冲突"),
      buildConfidenceDimension("recency", "信息时效性", searchSources.length > 0 ? 58 : 35, 50, searchSources.length > 0, "以当前搜索返回为准"),
      buildConfidenceDimension("authority", "权威匹配度", verifiedSources.length > 0 ? 62 : 38, 65, verifiedSources.length > 0, verifiedSources[0] || "缺少明确权威来源"),
    ],
    _fallbackReason: reason,
    ...(fallbackFormula
      ? {
          _scoreSource: "formula",
          _scoreBreakdown: fallbackFormula.breakdown,
        }
      : {}),
  };

  // 排除层落库闸门：subclaimVerdicts 只覆盖可核查原子，不可核查原子单独进 nonVerifiableAtoms
  applyExclusionLayerToReport(report, rumorStep, factStep?.output?.subclaimVerdicts, searchResult?.sources);

  // Same A+F path as live LLM reports
  applyFactDeskPostProcessToReport(report, claim);
  // 兜底报告同样不能泄露内部 Agent 名/检索商标（证据链 sourceRefs 里的 RumorDetector 等）
  applyPublicCopy(report);
  return report;
}

function buildConfidenceDimension(
  dimension: string,
  label: string,
  score: number,
  threshold: number,
  passed: boolean,
  reason: string
) {
  return { dimension, label, score, threshold, passed, reason };
}

export function buildConsensusDebate(factStep: any, sourceStep: any, searchResult?: any) {
  const factCounterEvidence = stringItems(factStep?.output?.counterEvidence);
  const contradictingSources = stringItems(factStep?.output?.contradictingSources);
  const questionableSources = stringItems(sourceStep?.output?.questionableSources);
  const missingSources = stringItems(sourceStep?.output?.missingSources);
  const searchGaps = stringItems(searchResult?.unresolvedEvidenceGaps);
  const conflicts = [
    ...factCounterEvidence,
    ...contradictingSources,
    ...questionableSources,
    ...missingSources,
    ...searchGaps,
  ];

  if (conflicts.length === 0) {
    return {
      id: `debate-${Date.now()}`,
      status: "not_needed",
      title: "未发现需要调解的智能体冲突",
      conflictCount: 0,
      rounds: [],
      finalConsensus: "FactChecker 与 SourceValidator 没有返回显著冲突，ReportComposer 可以直接按证据边界收束。",
      confidenceAdjustment: 0,
    };
  }

  const sourceChallenges = [...questionableSources, ...missingSources, ...searchGaps].slice(0, 2);
  const factResponses = [...factCounterEvidence, ...contradictingSources].slice(0, 2);
  const roundCount = Math.max(sourceChallenges.length, factResponses.length, 1);
  const rounds = Array.from({ length: roundCount }, (_, index) => ({
    challenger: "SourceValidator",
    respondent: "FactChecker",
    challenge: sourceChallenges[index] || "信源层提示：当前材料只能支持局部事实，不能直接推出强结论。",
    response: factResponses[index] || "事实层已记录反证或未解决缺口，需要降低结论强度。",
  }));

  return {
    id: `debate-${Date.now()}`,
    status: "resolved",
    title: "智能体冲突调解室",
    conflictCount: conflicts.length,
    rounds,
    finalConsensus: "进入收束前，将高风险断言降级为证据允许的谨慎表达，并把缺失来源保留为后续追查问题。",
    confidenceAdjustment: Math.max(-18, -4 * Math.min(conflicts.length, 4)),
  };
}
