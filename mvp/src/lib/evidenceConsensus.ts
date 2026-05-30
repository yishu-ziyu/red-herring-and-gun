/**
 * evidenceConsensus.ts — 证据共识评估引擎
 *
 * 核心逻辑：不做简单投票，基于真实搜索任务的来源覆盖、独立性、来源等级和反证覆盖评估。
 */

import type {
  MultiSearchJob,
  EvidenceConsensusReport,
  PropositionConsensusResult,
  ConsensusStatus,
  EvidenceIndependenceAssessment,
  SourceTierDistribution,
  CounterEvidenceCoverage,
  ProviderConsensusResult,
  IndependentSource,
  MinimumCriteriaCheck,
} from "./schemas";
import {
  groupSourcesByIndependence,
  calculateIndependenceScore,
  getSourceTier,
} from "./sourceIndependence";

export interface ConsensusConfig {
  minProvidersRequired?: number;
  minIndependenceScore?: number;
  requireCounterSearch?: boolean;
}

const DEFAULT_CONFIG: ConsensusConfig = {
  minProvidersRequired: 2,
  minIndependenceScore: 50,
  requireCounterSearch: true,
};

const CONSENSUS_PROVIDERS = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];

/**
 * 执行共识评估
 */
export function evaluateConsensus(
  jobs: MultiSearchJob[],
  config: ConsensusConfig = {}
): EvidenceConsensusReport {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const timestamp = Date.now();

  const propositionResults: PropositionConsensusResult[] = jobs.map((job) =>
    evaluateProposition(job, cfg)
  );

  const overallStats = {
    totalPropositions: propositionResults.length,
    readyForReasoning: propositionResults.filter(
      (r) => r.status === "可进入推理"
    ).length,
    doubtful: propositionResults.filter((r) => r.status === "存疑").length,
    needsManualReview: propositionResults.filter(
      (r) => r.status === "需人工复核"
    ).length,
    totalIndependentSources: propositionResults.reduce(
      (sum, r) => sum + r.evidenceIndependence.independentSources,
      0
    ),
    totalDuplicateSources: propositionResults.reduce(
      (sum, r) => sum + r.evidenceIndependence.duplicateSources,
      0
    ),
    counterEvidenceSearchesPerformed: propositionResults.filter(
      (r) => r.counterEvidenceCoverage.counterSearchPerformed
    ).length,
  };

  return {
    consensusId: `consensus-${timestamp}`,
    timestamp,
    propositionResults,
    overallStats,
  };
}

// ── 命题级别评估 ───────────────────────────────────────────────

function evaluateProposition(
  job: MultiSearchJob,
  config: ConsensusConfig
): PropositionConsensusResult {
  const allSources = job.searchTasks
    .filter((t) => t.status === "completed" && t.result)
    .flatMap((t) => t.result!.sources.map((s) => ({ ...s, _provider: t.provider })));

  // 1. 来源独立性评估
  const sourceGroups = groupSourcesByIndependence(allSources);
  const independentGroups = sourceGroups.filter((g) => !g.isDuplicate);
  const duplicateGroups = sourceGroups.filter((g) => g.isDuplicate);

  const evidenceIndependence: EvidenceIndependenceAssessment = {
    totalSources: allSources.length,
    independentSources: independentGroups.length,
    duplicateSources: duplicateGroups.reduce(
      (sum, g) => sum + g.sources.length - 1,
      0
    ),
    independenceScore: calculateIndependenceScore(
      allSources.length,
      independentGroups.length
    ),
    reasoning: buildIndependenceReasoning(sourceGroups),
  };

  // 2. 来源分级统计
  const tierDistribution: SourceTierDistribution = {
    government: 0,
    academic: 0,
    media: 0,
    selfMedia: 0,
    forum: 0,
    unknown: 0,
    highestTierFound: "unknown",
  };

  let highestTier = 4;
  for (const source of allSources) {
    const tier = getSourceTier(source.domain, source.sourceType);
    const type = source.sourceType ?? "未知";
    switch (type) {
      case "官方":
        tierDistribution.government++;
        break;
      case "学术":
        tierDistribution.academic++;
        break;
      case "媒体":
        tierDistribution.media++;
        break;
      case "自媒体":
        tierDistribution.selfMedia++;
        break;
      case "论坛":
        tierDistribution.forum++;
        break;
      default:
        tierDistribution.unknown++;
    }
    if (tier < highestTier) highestTier = tier;
  }

  tierDistribution.highestTierFound =
    highestTier <= 1
      ? "government"
      : highestTier === 2
      ? "media"
      : highestTier === 3
      ? "selfMedia"
      : "forum";

  // 3. Provider 结果汇总
  const providerResults: ProviderConsensusResult[] = CONSENSUS_PROVIDERS.map(
    (provider) => {
      const task = job.searchTasks.find((t) => t.provider === provider);
      if (!task || task.status !== "completed" || !task.result) {
        return {
          provider,
          status: task?.status ?? "pending",
          sourceCount: 0,
          relevantSources: 0,
          supportsProposition: null,
          contradictsProposition: null,
          topSourceUrl: "",
        };
      }

      return {
        provider,
        status: task.status,
        sourceCount: task.result.sources.length,
        relevantSources: task.result.sources.length,
        supportsProposition: null,
        contradictsProposition: null,
        topSourceUrl: task.result.sources[0]?.url ?? "",
      };
    }
  );

  // 4. 独立来源列表
  const independentSources: IndependentSource[] = independentGroups.map(
    (group, idx) => ({
      id: `ind-src-${job.propositionId}-${idx + 1}`,
      title: group.canonicalTitle,
      url: group.canonicalUrl,
      domain: group.domain,
      sourceType: group.sources[0]?.sourceType ?? "未知",
      isOriginalSource: !group.isDuplicate,
      originalSourceUrl: group.originalSourceUrl,
      supports: false,
      contradicts: false,
      providerOrigins: group.sources
        .map((s) => (s as unknown as { _provider?: string })._provider)
        .filter(Boolean) as string[],
    })
  );

  // 5. 反证覆盖：当前矩阵只消费同题检索结果；未运行独立反证查询时不声称“未发现”。
  const counterEvidenceCoverage: CounterEvidenceCoverage = {
    counterSearchPerformed: false,
    counterEvidenceFound: false,
    counterEvidenceCount: 0,
    counterEvidenceSources: [],
    verdict: "反证检索未执行",
  };

  // 6. 最低条件检查
  const meetsMinimumCriteria: MinimumCriteriaCheck = {
    criteria1_minProviders:
      providerResults.filter((p) => p.sourceCount > 0).length >= (config.minProvidersRequired ?? 2),
    criteria2_hasHighTierOrOriginal:
      tierDistribution.government > 0 ||
      tierDistribution.academic > 0 ||
      independentSources.some((s) => s.isOriginalSource),
    criteria3_counterSearchDone: counterEvidenceCoverage.counterSearchPerformed,
    criteria4_duplicatesCountedOnce:
      evidenceIndependence.duplicateSources === 0 ||
      evidenceIndependence.independentSources >= 1,
    allMet: false,
  };

  meetsMinimumCriteria.allMet =
    meetsMinimumCriteria.criteria1_minProviders &&
    meetsMinimumCriteria.criteria2_hasHighTierOrOriginal &&
    meetsMinimumCriteria.criteria3_counterSearchDone &&
    meetsMinimumCriteria.criteria4_duplicatesCountedOnce;

  // 7. 状态判定
  const status = determineStatus(
    meetsMinimumCriteria,
    evidenceIndependence,
    providerResults,
    counterEvidenceCoverage
  );

  const statusReason = buildStatusReason(
    status,
    evidenceIndependence,
    tierDistribution,
    counterEvidenceCoverage,
    providerResults
  );

  return {
    propositionId: job.propositionId,
    propositionText: job.propositionText,
    status,
    statusReason,
    evidenceIndependence,
    sourceTierDistribution: tierDistribution,
    counterEvidenceCoverage,
    providerResults,
    independentSources,
    meetsMinimumCriteria,
  };
}

// ── 状态判定逻辑 ───────────────────────────────────────────────

function determineStatus(
  criteria: MinimumCriteriaCheck,
  independence: EvidenceIndependenceAssessment,
  providerResults: ProviderConsensusResult[],
  counterEvidence: CounterEvidenceCoverage
): ConsensusStatus {
  // 如果反证已发现 → 需人工复核
  if (counterEvidence.counterEvidenceFound) {
    return "需人工复核";
  }

  // 如果所有最低条件都满足 → 可进入推理
  if (
    criteria.allMet &&
    independence.independenceScore >= 50 &&
    providerResults.filter((p) => p.supportsProposition === true).length >= 1
  ) {
    return "可进入推理";
  }

  // 如果部分条件满足但来源不足 → 存疑
  if (
    criteria.criteria1_minProviders &&
    criteria.criteria3_counterSearchDone
  ) {
    return "存疑";
  }

  // 否则 → 需人工复核
  return "需人工复核";
}

// ── 辅助文本生成 ───────────────────────────────────────────────

function buildIndependenceReasoning(
  groups: ReturnType<typeof groupSourcesByIndependence>
): string {
  const independentCount = groups.filter((g) => !g.isDuplicate).length;
  const duplicateCount = groups.filter((g) => g.isDuplicate).length;

  if (duplicateCount === 0) {
    return `所有 ${groups.length} 个来源均为独立来源，无转载关系。`;
  }

  const totalDuplicates = groups
    .filter((g) => g.isDuplicate)
    .reduce((sum, g) => sum + g.sources.length - 1, 0);

  return `共发现 ${groups.length} 组来源，其中 ${independentCount} 组独立来源，${duplicateCount} 组存在转载关系（去重后排除 ${totalDuplicates} 个重复来源）。`;
}

function buildStatusReason(
  status: ConsensusStatus,
  independence: EvidenceIndependenceAssessment,
  _tierDistribution: SourceTierDistribution,
  counterEvidence: CounterEvidenceCoverage,
  providerResults: ProviderConsensusResult[]
): string {
  const activeProviders = providerResults.filter((p) => p.sourceCount > 0).length;
  const supportingProviders = providerResults.filter(
    (p) => p.supportsProposition === true
  ).length;

  switch (status) {
    case "可进入推理":
      return `${activeProviders} 个 Provider 返回了相关结果，来源独立性评分 ${independence.independenceScore}%，反证搜索${counterEvidence.verdict}。满足最低共识条件。`;

    case "存疑":
      return `${activeProviders} 个 Provider 返回了结果，其中 ${supportingProviders} 个支持该命题。来源独立性评分 ${independence.independenceScore}%。存在证据缺口或来源等级不足。`;

    case "需人工复核":
      return `证据不足以支撑自动判断：${activeProviders} 个 Provider 返回结果，独立性评分 ${independence.independenceScore}%。建议人工介入核查。`;

    default:
      return "状态评估完成。";
  }
}
