import type {
  CandidateMaterial,
  EvidenceQualitySummary,
  GradedEvidence,
  ScoreLevel,
  SourceQualityAssessment,
} from "./schemas";
import { assessSourceCredibility, calculateSourceDiversity, scoreFreshnessFromTimestamp } from "./sourceCredibility";

const SOURCE_TYPE_BASE_SCORE: Record<CandidateMaterial["sourceType"], number> = {
  学术论文: 92,
  招聘数据: 82,
  企业案例: 66,
  行业报告: 74,
  新闻报道: 68,
  评论文章: 35,
};

const SOURCE_TYPE_TIER: Record<CandidateMaterial["sourceType"], number> = {
  学术论文: 1,
  招聘数据: 2,
  行业报告: 2,
  新闻报道: 3,
  企业案例: 4,
  评论文章: 6,
};

function scoreLevelValue(level: ScoreLevel): number {
  if (level === "高") return 88;
  if (level === "中") return 62;
  return 34;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function assessCandidateEvidenceQuality(candidate: CandidateMaterial): SourceQualityAssessment {
  const credibility = assessSourceCredibility(candidate.title);
  const sourceTypeScore = SOURCE_TYPE_BASE_SCORE[candidate.sourceType];
  const traceabilityScore = scoreLevelValue(candidate.traceability);
  const contextScore = scoreLevelValue(candidate.contextFit);
  const independenceScore = scoreLevelValue(candidate.independence);
  const credibilityScore = clampScore(
    sourceTypeScore * 0.42 + traceabilityScore * 0.26 + contextScore * 0.16 + independenceScore * 0.16
  );

  return {
    sourceType: candidate.sourceType,
    credibilityScore: Math.max(credibility.score, credibilityScore),
    // 审查 P2-8 修复：原实现 scoreFreshnessFromTimestamp() 未传参，恒返回 50。
    // 改为传入 candidate.publishedAt；缺失时 scoreFreshnessFromTimestamp 仍返回 50（保持原行为）。
    freshnessScore: scoreFreshnessFromTimestamp(candidate.publishedAt),
    diversityKey: candidate.title,
    tier: Math.min(credibility.tier, SOURCE_TYPE_TIER[candidate.sourceType]),
    reason: `${candidate.sourceType}，${candidate.traceability}可追溯，${candidate.independence}独立性。`,
  };
}

export function summarizeEvidenceQuality(grades: GradedEvidence[]): EvidenceQualitySummary {
  const qualityItems = grades.map((grade) => grade.sourceQuality).filter((item): item is SourceQualityAssessment => Boolean(item));
  const domains = qualityItems.map((item) => item.diversityKey);
  const supportCount = grades.filter((grade) => grade.evidenceRole === "支持" || grade.evidenceRole === "限定").length;
  const contradictCount = grades.filter((grade) => grade.evidenceRole === "反驳" || grade.usageLevel === "反证").length;
  const weakEvidenceCount = grades.filter(
    (grade) => grade.usageLevel === "仅作线索" || grade.usageLevel === "背景材料" || grade.scores.relevance === "低"
  ).length;
  const highTierSourceCount = qualityItems.filter((item) => item.tier <= 2).length;

  if (qualityItems.length === 0) {
    return {
      averageCredibility: 0,
      averageFreshness: 0,
      diversityScore: 0,
      supportCount,
      contradictCount,
      weakEvidenceCount,
      highTierSourceCount,
    };
  }

  return {
    averageCredibility: clampScore(
      qualityItems.reduce((sum, item) => sum + item.credibilityScore, 0) / qualityItems.length
    ),
    averageFreshness: clampScore(
      qualityItems.reduce((sum, item) => sum + item.freshnessScore, 0) / qualityItems.length
    ),
    diversityScore: calculateSourceDiversity(domains),
    supportCount,
    contradictCount,
    weakEvidenceCount,
    highTierSourceCount,
  };
}
