import type { ConfidenceAssessment, FinalReport } from "./schemas";
import type { HandoffStep } from "./agentExpansion";

type ConfidenceReportContext = Pick<FinalReport, "nextEvidenceNeeded" | "evidenceQualitySummary" | "logicRiskItems">;

const DIMENSIONS: Array<Omit<ConfidenceAssessment, "score" | "passed" | "reason">> = [
  { dimension: "source_reliability", label: "来源可靠性", threshold: 70 },
  { dimension: "evidence_completeness", label: "证据完整度", threshold: 60 },
  { dimension: "consistency", label: "逻辑一致性", threshold: 75 },
  { dimension: "recency", label: "信息时效性", threshold: 50 },
  { dimension: "authority", label: "权威匹配度", threshold: 65 },
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function reliabilityScore(value: unknown) {
  switch (value) {
    case "high":
      return 84;
    case "medium":
      return 62;
    case "low":
      return 34;
    case "unverified":
      return 24;
    default:
      return 50;
  }
}

function getLogicRiskPenalty(report?: ConfidenceReportContext | null) {
  const logicRisks = report?.logicRiskItems ?? [];
  const high = logicRisks.filter((risk) => risk.severity === "high").length;
  const medium = logicRisks.filter((risk) => risk.severity === "medium").length;
  const low = logicRisks.filter((risk) => risk.severity === "low").length;
  return {
    count: logicRisks.length,
    high,
    medium,
    low,
    penalty: high * 14 + medium * 7 + low * 3,
  };
}

function applyLogicRiskPenalty(
  rows: ConfidenceAssessment[],
  report?: ConfidenceReportContext | null
): ConfidenceAssessment[] {
  const risk = getLogicRiskPenalty(report);
  if (risk.count === 0) return rows;

  return rows.map((row) => {
    if (row.dimension !== "consistency") return row;
    const score = clampScore(row.score - risk.penalty);
    return {
      ...row,
      score,
      passed: score >= row.threshold,
      reason: `${row.reason} 另发现 ${risk.count} 项逻辑风险，其中高风险 ${risk.high} 项，已扣减一致性分。`,
    };
  });
}

export function extractConfidenceAssessments(
  raw: unknown,
  fallbackScore: number,
  steps: HandoffStep[] = [],
  report?: ConfidenceReportContext | null
): ConfidenceAssessment[] {
  if (Array.isArray(raw)) {
    const parsed = raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<ConfidenceAssessment>;
        const meta = DIMENSIONS.find((dimension) => dimension.dimension === value.dimension);
        if (!meta) return null;
        const score = clampScore(typeof value.score === "number" ? value.score : fallbackScore);
        return {
          ...meta,
          score,
          passed: score >= meta.threshold,
          reason: typeof value.reason === "string" ? value.reason : "由 ReportComposer 输出。",
        };
      })
      .filter((item): item is ConfidenceAssessment => item !== null);

    if (parsed.length === DIMENSIONS.length) return applyLogicRiskPenalty(parsed, report);
  }

  return buildConfidenceAssessments(fallbackScore, steps, report);
}

export function buildConfidenceAssessments(
  credibilityScore: number,
  steps: HandoffStep[] = [],
  report?: ConfidenceReportContext | null
): ConfidenceAssessment[] {
  const sourceStep = steps.find((step) => step.agent === "source_validator");
  const factStep = steps.find((step) => step.agent === "fact_checker");
  const verifiedSources = toArray(sourceStep?.output.verifiedSources);
  const questionableSources = toArray(sourceStep?.output.questionableSources);
  const missingSources = toArray(sourceStep?.output.missingSources);
  const keyFindings = toArray(factStep?.output.keyFindings);
  const nextEvidenceNeeded = report?.nextEvidenceNeeded ?? [];
  const qualitySummary = report?.evidenceQualitySummary;
  const logicRiskPenalty = getLogicRiskPenalty(report);
  const evidenceBundleQuality = steps
    .map((step) => step.evidenceBundle?.sourceQualityScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const averageBundleQuality =
    evidenceBundleQuality.length > 0
      ? Math.round(evidenceBundleQuality.reduce((sum, score) => sum + score, 0) / evidenceBundleQuality.length)
      : null;

  const scores: Record<ConfidenceAssessment["dimension"], { score: number; reason: string }> = {
    source_reliability: {
      score: qualitySummary
        ? clampScore(qualitySummary.averageCredibility + qualitySummary.highTierSourceCount * 4 - qualitySummary.weakEvidenceCount * 5)
        : averageBundleQuality !== null
        ? clampScore(averageBundleQuality)
        : reliabilityScore(sourceStep?.output.sourceReliability),
      reason:
        qualitySummary
          ? `来源平均可信度 ${qualitySummary.averageCredibility}/100，高等级来源 ${qualitySummary.highTierSourceCount} 条，弱证据 ${qualitySummary.weakEvidenceCount} 条。`
          : averageBundleQuality !== null
          ? `Agent 证据包平均来源质量 ${averageBundleQuality}/100。`
          : verifiedSources.length > 0
          ? `已验证 ${verifiedSources.length} 个来源，仍有 ${questionableSources.length} 个可疑来源。`
          : "缺少可追溯的权威来源，按中低置信度处理。",
    },
    evidence_completeness: {
      score: qualitySummary
        ? clampScore(
            credibilityScore +
              qualitySummary.supportCount * 5 +
              qualitySummary.contradictCount * 6 -
              qualitySummary.weakEvidenceCount * 7 -
              nextEvidenceNeeded.length * 5
          )
        : clampScore(credibilityScore + keyFindings.length * 6 - nextEvidenceNeeded.length * 8),
      reason:
        qualitySummary
          ? `支持/限定证据 ${qualitySummary.supportCount} 条，反证 ${qualitySummary.contradictCount} 条，待补证据 ${nextEvidenceNeeded.length} 项。`
          : nextEvidenceNeeded.length > 0
          ? `仍有 ${nextEvidenceNeeded.length} 项待补证据。`
          : `FactChecker 返回 ${keyFindings.length} 条关键发现。`,
    },
    consistency: {
      score: clampScore(credibilityScore + (factStep?.output.factCheckResult === "partial" ? 4 : 0) - logicRiskPenalty.penalty),
      reason:
        logicRiskPenalty.count > 0
          ? `发现 ${logicRiskPenalty.count} 项逻辑风险，其中高风险 ${logicRiskPenalty.high} 项，结论需降级表达。`
          : "依据事实核查结果与报告结论的一致性估算。",
    },
    recency: {
      score: qualitySummary ? qualitySummary.averageFreshness : clampScore(60 - missingSources.length * 5),
      reason: qualitySummary
        ? `证据平均时效性 ${qualitySummary.averageFreshness}/100；缺失发布时间时按保守分处理。`
        : "当前结果未统一返回发布时间，采用保守时效性评分。",
    },
    authority: {
      score: qualitySummary
        ? clampScore(45 + qualitySummary.highTierSourceCount * 12 + qualitySummary.diversityScore * 0.25 - qualitySummary.weakEvidenceCount * 6)
        : clampScore(50 + verifiedSources.length * 10 - questionableSources.length * 8),
      reason:
        qualitySummary
          ? `来源多样性 ${qualitySummary.diversityScore}/100，高等级来源越多，权威匹配度越高。`
          : verifiedSources.length > 0
          ? "存在可复核来源，但仍需区分官方、媒体与社交线索。"
          : "尚未发现明确权威来源。",
    },
  };

  return DIMENSIONS.map((dimension) => {
    const value = scores[dimension.dimension];
    return {
      ...dimension,
      score: value.score,
      passed: value.score >= dimension.threshold,
      reason: value.reason,
    };
  });
}
