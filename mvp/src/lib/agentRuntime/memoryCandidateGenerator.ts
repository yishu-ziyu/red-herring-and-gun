import type { Search360Response, Search360Source } from "../schemas";
import type { RuntimeStep } from "./AgentRuntime";
import type {
  MemoryCandidate,
  ReasoningPatternMemoryPayload,
  RecursivePathMemoryPayload,
  SearchStrategyMemoryPayload,
  SourceReputationMemoryPayload,
} from "./memoryCandidateTypes";

interface BuildMemoryCandidatesInput {
  runId: string;
  claim: string;
  steps: RuntimeStep[];
  finalReport?: Record<string, unknown>;
  searchResult?: Search360Response;
}

interface MemorySelectionContext {
  unresolvedQuestionCount: number;
  searchSource?: string;
}

const MAX_ACTIONABLE_MEMORY_CANDIDATES = 4;

export function buildMemoryCandidatesFromRun({
  runId,
  claim,
  steps,
  finalReport,
  searchResult,
}: BuildMemoryCandidatesInput): MemoryCandidate[] {
  const createdAt = Date.now();
  const normalizedClaim = normalizeClaim(claim);
  const sourceUrls = uniqueStrings((searchResult?.sources ?? []).map((source) => source.url)).slice(0, 20);
  const unresolvedQuestions = uniqueStrings([
    ...(searchResult?.unresolvedEvidenceGaps ?? []),
    ...steps.flatMap((step) => step.evidenceBundle.unresolvedQuestions ?? []),
  ]).slice(0, 20);
  const base = {
    status: "proposed" as const,
    provenance: {
      runId,
      claim,
      normalizedClaim,
      createdAt,
      sourceUrls,
      unresolvedQuestions,
    },
  };

  const candidates: MemoryCandidate[] = [];
  const rumorType = getString(finalReport, "rumorType") || getString(finalReport, "claimType") || "未分类";
  const conclusion = getString(finalReport, "conclusion") || getString(finalReport, "summaryForPublic");
  const credibilityScore = getNumber(finalReport, "credibilityScore") ?? 50;

  candidates.push({
    ...base,
    id: candidateId(runId, "case_pattern"),
    kind: "case_pattern",
    title: "案例模式：可复用核查结论边界",
    summary: conclusion
      ? `下次遇到相似命题，先复用这个结论边界：${conclusion.slice(0, 150)}`
      : "下次遇到相似命题，先召回本案的结论边界和证据要求。",
    confidence: clampScore(credibilityScore),
    tags: uniqueStrings(["case", rumorType, getString(finalReport, "credibilityLabel") ?? ""]).filter(Boolean),
    proposedByAgent: "ReportComposer",
    payload: {
      rumorType,
      verdictType: getString(finalReport, "verdictType"),
      credibilityScore,
      conclusion,
      publicRewrite: getString(finalReport, "summaryForPublic") || getString(finalReport, "publicFacing"),
    },
  });

  const strategy = buildSearchStrategyPayload(claim, rumorType, searchResult, unresolvedQuestions);
  if (strategy.effectiveQueries.length > 0 || strategy.sourceDomains.length > 0) {
    candidates.push({
      ...base,
      id: candidateId(runId, "search_strategy"),
      kind: "search_strategy",
      title: "搜索策略：本案有效检索路径",
      summary: `下次遇到相似命题，优先复用 ${strategy.effectiveQueries.length} 个支持/反驳查询；来源域名只作线索，不直接当结论。`,
      confidence: Math.min(88, 50 + strategy.sourceDomains.length * 4 + strategy.effectiveQueries.length * 3),
      tags: uniqueStrings(["search", rumorType, searchResult?._source ?? ""]).filter(Boolean),
      proposedByAgent: "FactChecker",
      payload: strategy,
    });
  }

  for (const candidate of buildSourceReputationCandidates(runId, base, searchResult)) {
    candidates.push(candidate);
  }

  const recursivePath = buildRecursivePathPayload(claim, searchResult, finalReport, unresolvedQuestions);
  if (recursivePath.subquestions.length > 0 || recursivePath.evidenceGaps.length > 0) {
    candidates.push({
      ...base,
      id: candidateId(runId, "recursive_path"),
      kind: "recursive_path",
      title: "递归搜索路径：问题拆解与停止条件",
      summary: `下次先追 ${recursivePath.subquestions.length} 个关键子问题；遇到相同证据缺口时不要提前收束。`,
      confidence: 70,
      tags: uniqueStrings(["recursive-search", rumorType]).filter(Boolean),
      proposedByAgent: "FactChecker",
      payload: recursivePath,
    });
  }

  const reasoningPattern = buildReasoningPatternPayload(finalReport);
  if (reasoningPattern) {
    candidates.push({
      ...base,
      id: candidateId(runId, "reasoning_pattern"),
      kind: "reasoning_pattern",
      title: "推理模式：容易误导用户的半真半假结构",
      summary: `下次遇到相似结构，先检查这个推理边界：${reasoningPattern.whyItMatters.slice(0, 140)}`,
      confidence: 76,
      tags: uniqueStrings(["reasoning", rumorType, "do-not-overclaim"]).filter(Boolean),
      proposedByAgent: "ReportComposer",
      payload: reasoningPattern,
    });
  }

  if (unresolvedQuestions.length > 0 || searchResult?._source === "tool-error") {
    candidates.push({
      ...base,
      id: candidateId(runId, "failure_record"),
      kind: "failure_record",
      title: "失败记录：未解决证据缺口",
      summary: unresolvedQuestions[0]
        ? `下次补查这个证据缺口：${unresolvedQuestions[0]}`
        : "下次遇到相似案件，先补真实搜索结果，不能用空工具结果收束。",
      confidence: 65,
      tags: uniqueStrings(["failure", "follow-up", searchResult?._source ?? ""]).filter(Boolean),
      proposedByAgent: "SourceValidator",
      payload: {
        evidenceGaps: unresolvedQuestions,
        searchSource: searchResult?._source,
        traceText: searchResult?.traceText,
      },
    });
  }

  return selectActionableMemoryCandidates(dedupeById(candidates), {
    unresolvedQuestionCount: unresolvedQuestions.length,
    searchSource: searchResult?._source,
  });
}

function buildSearchStrategyPayload(
  claim: string,
  rumorType: string,
  searchResult?: Search360Response,
  unresolvedQuestions: string[] = []
): SearchStrategyMemoryPayload {
  return {
    rumorType,
    effectiveQueries: uniqueStrings([
      claim,
      searchResult?.supportQuery,
      searchResult?.contradictQuery,
      ...(searchResult?.relatedQuestions ?? []),
    ]).slice(0, 10),
    ineffectiveQueries: searchResult?._source === "tool-error" ? [claim] : [],
    sourceDomains: uniqueStrings((searchResult?.sources ?? []).map(sourceDomain)).slice(0, 16),
    stopRules: [
      "没有独立反证时不能直接判真，只能标注证据缺口。",
      "观察性相关不能写成因果证明。",
      ...unresolvedQuestions.slice(0, 3),
    ],
  };
}

function buildSourceReputationCandidates(
  runId: string,
  base: Pick<MemoryCandidate, "status" | "provenance">,
  searchResult?: Search360Response
): MemoryCandidate<SourceReputationMemoryPayload>[] {
  const grouped = new Map<string, Search360Source[]>();
  for (const source of searchResult?.sources ?? []) {
    const domain = sourceDomain(source);
    if (!domain) continue;
    grouped.set(domain, [...(grouped.get(domain) ?? []), source]);
  }

  return Array.from(grouped.entries()).flatMap(([domain, sources], index) => {
    const observedScores = sources
      .map((source) => source.credibilityScore)
      .filter((score): score is number => typeof score === "number");
    const posteriorScore = observedScores.length > 0
      ? Math.round(observedScores.reduce((sum, score) => sum + score, 0) / observedScores.length)
      : 50;
    const payload: SourceReputationMemoryPayload = {
      domain,
      sourceName: sources[0]?.title,
      observedRoles: uniqueStrings(sources.map((source) => source.evidenceRole ?? source.sourceType ?? "未知")),
      observedScores,
      posteriorScore,
      note: "这是基于本案证据表现的后验观察，不是预设信源真伪。",
    };
    if (!sourceReputationChangesNextAction(payload, sources.length)) return [];
    const candidate: MemoryCandidate<SourceReputationMemoryPayload> = {
      ...base,
      id: candidateId(runId, `source_reputation_${index + 1}`),
      kind: "source_reputation",
      title: `来源信誉观察：${domain}`,
      summary: `下次遇到 ${domain}，按本案表现调整查证顺序：出现 ${sources.length} 次，后验分 ${posteriorScore}/100。`,
      confidence: Math.min(82, 55 + sources.length * 5),
      tags: uniqueStrings(["source", domain, searchResult?._source ?? ""]).filter(Boolean),
      proposedByAgent: "SourceValidator",
      payload,
    };
    return [candidate];
  }).slice(0, 2);
}

function buildRecursivePathPayload(
  claim: string,
  searchResult?: Search360Response,
  finalReport?: Record<string, unknown>,
  unresolvedQuestions: string[] = []
): RecursivePathMemoryPayload {
  return {
    rootClaim: claim,
    subquestions: uniqueStrings([
      ...(searchResult?.relatedQuestions ?? []),
      ...getStringArray(finalReport, "nextEvidenceNeeded"),
    ]).slice(0, 10),
    effectiveQueries: uniqueStrings([searchResult?.supportQuery, searchResult?.contradictQuery]).slice(0, 6),
    evidenceGaps: unresolvedQuestions,
    stopRules: uniqueStrings([
      ...getStringArray(finalReport, "doNotInfer"),
      "若只有单一搜索引擎或同源转载，必须继续交叉验证。",
    ]).slice(0, 8),
  };
}

function buildReasoningPatternPayload(finalReport?: Record<string, unknown>): ReasoningPatternMemoryPayload | null {
  const causalBoundary = getString(finalReport, "causalBoundary");
  const whyHard = getString(finalReport, "whyHardToVerify") || getString(finalReport, "whyNotDirectFactCheck");
  const blocked = uniqueStrings([
    ...getStringArray(finalReport, "cannotInfer"),
    ...getStringArray(finalReport, "doNotInfer"),
  ]).slice(0, 8);
  if (!causalBoundary && !whyHard && blocked.length === 0) return null;
  return {
    pattern: causalBoundary || "混合事实、相关性和建议的命题需要拆解后再判断。",
    whyItMatters: whyHard || causalBoundary || blocked[0] || "该模式容易把有限证据写成绝对判断。",
    blockedInference: blocked,
    saferRewrite: getString(finalReport, "summaryForPublic") || getString(finalReport, "recommendation"),
  };
}

function selectActionableMemoryCandidates(
  candidates: MemoryCandidate[],
  context: MemorySelectionContext
): MemoryCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreMemoryUsefulness(candidate, context),
    }))
    .filter(({ score }) => score >= 2)
    .sort((left, right) => right.score - left.score || right.candidate.confidence - left.candidate.confidence)
    .slice(0, MAX_ACTIONABLE_MEMORY_CANDIDATES)
    .map(({ candidate }) => ({
      ...candidate,
      tags: uniqueStrings([...candidate.tags, "actionable-memory"]),
    }));
}

function scoreMemoryUsefulness(candidate: MemoryCandidate, context: MemorySelectionContext) {
  let score = 0;

  if (candidate.kind === "case_pattern") score += 2;
  if (candidate.kind === "search_strategy") score += hasReusableSearchStrategy(candidate.payload) ? 3 : -1;
  if (candidate.kind === "recursive_path") score += hasReusableRecursivePath(candidate.payload) ? 3 : -1;
  if (candidate.kind === "reasoning_pattern") score += 3;
  if (candidate.kind === "failure_record") {
    score += context.unresolvedQuestionCount > 0 || context.searchSource === "tool-error" ? 3 : 0;
  }
  if (candidate.kind === "source_reputation") {
    score += sourceReputationChangesNextAction(candidate.payload as SourceReputationMemoryPayload) ? 2 : -2;
  }

  if (candidate.summary.includes("下次")) score += 1;
  if (candidate.summary.includes("优先") || candidate.summary.includes("避免") || candidate.summary.includes("不能")) {
    score += 1;
  }

  return score;
}

function hasReusableSearchStrategy(payload: unknown) {
  const strategy = payload as Partial<SearchStrategyMemoryPayload>;
  return Boolean(
    (strategy.effectiveQueries?.length ?? 0) > 1 ||
    strategy.ineffectiveQueries?.length ||
    strategy.sourceDomains?.length ||
    (strategy.stopRules?.length ?? 0) > 2
  );
}

function hasReusableRecursivePath(payload: unknown) {
  const path = payload as Partial<RecursivePathMemoryPayload>;
  return Boolean(path.subquestions?.length || path.evidenceGaps?.length || path.stopRules?.length);
}

function sourceReputationChangesNextAction(payload: SourceReputationMemoryPayload, occurrenceCount = 0) {
  const scoreSpread = payload.observedScores.length > 1
    ? Math.max(...payload.observedScores) - Math.min(...payload.observedScores)
    : 0;
  const roleText = payload.observedRoles.join(" ");
  return (
    occurrenceCount >= 2 ||
    payload.posteriorScore <= 45 ||
    payload.posteriorScore >= 80 ||
    scoreSpread >= 25 ||
    roleText.includes("不可用") ||
    roleText.includes("线索")
  );
}

function candidateId(runId: string, suffix: string) {
  return `memory-${runId}-${suffix}`;
}

function getString(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringArray(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function sourceDomain(source?: Pick<Search360Source, "domain" | "url">) {
  if (source?.domain) return source.domain.replace(/^www\./, "");
  if (!source?.url) return "";
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeClaim(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?;；:"“”'‘’()[\]【】]/g, "");
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}
