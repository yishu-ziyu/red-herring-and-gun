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
  SearchResultSource,
  SearchTask,
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
const CONTRADICT_QUERY_RE = /反驳|辟谣|不实|谣言|虚假|误读|无法证实|争议|澄清|召回|打假/;
const CONTRADICT_TEXT_RE = /不实|谣言|虚假|假的|错误|并无|并未|没有证据|无证据|不能证实|无法证实|不成立|被证实为假|召回|辟谣|澄清/;
const SUPPORT_TEXT_RE = /属实|证实|确认|确有|真实|成立|显示|发现|存在|官方通报|研究发现/;

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
        supportsProposition: taskSupportsProposition(task),
        contradictsProposition: taskContradictsProposition(task),
        topSourceUrl: task.result.sources[0]?.url ?? "",
      };
    }
  );

  // 4. 独立来源列表
  const independentSources: IndependentSource[] = independentGroups.map(
    (group, idx) => {
      const sources = group.sources as Array<SearchResultSource & { _provider?: string }>;
      return {
        id: `ind-src-${job.propositionId}-${idx + 1}`,
        title: group.canonicalTitle,
        url: group.canonicalUrl,
        domain: group.domain,
        sourceType: sources[0]?.sourceType ?? "未知",
        isOriginalSource: !group.isDuplicate,
        originalSourceUrl: group.originalSourceUrl,
        supports: sources.some((source) => sourceSupportsProposition(source)),
        contradicts: sources.some((source) => sourceContradictsProposition(source)),
        providerOrigins: sources
          .map((s) => s._provider)
          .filter(Boolean) as string[],
      };
    }
  );

  // 5. 反证覆盖：只在真实查询或真实来源文本出现反证信号时标记，不把反证发现误判为人工复核。
  const counterEvidenceSources = independentSources
    .filter((source) => source.contradicts)
    .map((source) => source.url)
    .filter(Boolean);
  const counterSearchPerformed =
    job.searchTasks.some(taskLooksLikeCounterSearch) || counterEvidenceSources.length > 0;
  const counterEvidenceCoverage: CounterEvidenceCoverage = {
    counterSearchPerformed,
    counterEvidenceFound: counterEvidenceSources.length > 0,
    counterEvidenceCount: counterEvidenceSources.length,
    counterEvidenceSources,
    verdict: counterEvidenceSources.length > 0
      ? "反证已覆盖"
      : counterSearchPerformed
      ? "暂未发现反证"
      : "反证检索未执行",
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
    (!config.requireCounterSearch || meetsMinimumCriteria.criteria3_counterSearchDone) &&
    meetsMinimumCriteria.criteria4_duplicatesCountedOnce;

  // 7. 状态判定
  const status = determineStatus(
    meetsMinimumCriteria,
    evidenceIndependence,
    providerResults,
    counterEvidenceCoverage,
    config
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
  _counterEvidence: CounterEvidenceCoverage,
  config: ConsensusConfig
): ConsensusStatus {
  const minProviders = config.minProvidersRequired ?? DEFAULT_CONFIG.minProvidersRequired ?? 2;
  const minIndependence = config.minIndependenceScore ?? DEFAULT_CONFIG.minIndependenceScore ?? 50;
  const activeProviders = providerResults.filter((p) => p.sourceCount > 0).length;
  const supportingProviders = providerResults.filter((p) => p.supportsProposition === true).length;
  const contradictingProviders = providerResults.filter((p) => p.contradictsProposition === true).length;

  if (activeProviders === 0) return "需人工复核";

  if (supportingProviders > 0 && contradictingProviders > 0) return "存疑";

  if (
    independence.independenceScore >= minIndependence &&
    (supportingProviders >= minProviders || contradictingProviders >= minProviders)
  ) {
    return "可进入推理";
  }

  if (criteria.criteria1_minProviders || supportingProviders > 0 || contradictingProviders > 0) return "存疑";

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
  const contradictingProviders = providerResults.filter(
    (p) => p.contradictsProposition === true
  ).length;

  switch (status) {
    case "可进入推理":
      return `${activeProviders} 个搜索源返回相关结果，${supportingProviders} 个支持、${contradictingProviders} 个反驳，来源独立性评分 ${independence.independenceScore}%。多源已形成同向证据，可以进入结论推理。`;

    case "存疑":
      return `${activeProviders} 个搜索源返回结果，${supportingProviders} 个支持、${contradictingProviders} 个反驳，来源独立性评分 ${independence.independenceScore}%。证据方向未完全收敛，应保留存疑边界。`;

    case "需人工复核":
      return `证据覆盖不足：${activeProviders} 个搜索源返回结果，独立性评分 ${independence.independenceScore}%。需要补搜或人工复核后再判断。`;

    default:
      return "状态评估完成。";
  }
}

function taskLooksLikeCounterSearch(task: SearchTask): boolean {
  return CONTRADICT_QUERY_RE.test(task.query);
}

function taskSupportsProposition(task: SearchTask): boolean | null {
  if (!task.result) return null;
  if (task.result.sources.some((source) => sourceSupportsProposition(source))) return true;
  if (SUPPORT_TEXT_RE.test(task.result.answer ?? "") && !CONTRADICT_TEXT_RE.test(task.result.answer ?? "")) {
    return true;
  }
  return null;
}

function taskContradictsProposition(task: SearchTask): boolean | null {
  if (!task.result) return null;
  if (task.result.sources.some((source) => sourceContradictsProposition(source))) return true;
  if (CONTRADICT_TEXT_RE.test(task.result.answer ?? "")) return true;
  return null;
}

function sourceSupportsProposition(source: SearchResultSource): boolean {
  if (source.evidenceRole === "支持" || source.evidenceRole === "限定") return true;
  const text = sourceText(source);
  return SUPPORT_TEXT_RE.test(text) && !CONTRADICT_TEXT_RE.test(text);
}

function sourceContradictsProposition(source: SearchResultSource): boolean {
  if (source.evidenceRole === "反驳") return true;
  return CONTRADICT_TEXT_RE.test(sourceText(source));
}

function sourceText(source: SearchResultSource): string {
  return `${source.title} ${source.snippet}`;
}
