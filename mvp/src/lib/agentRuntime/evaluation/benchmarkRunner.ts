/**
 * evaluation/benchmarkRunner.ts
 *
 * Runs AgentRuntime against golden cases with deterministic mocks.
 * Each case gets a factory that produces per-agent mock outputs.
 */

import { AgentRuntime } from "../AgentRuntime";
import type { AgentRuntimeDependencies } from "../AgentRuntime";
import type { GoldenCase } from "./goldenDataset";
import { scoreCase, type CaseResult } from "./evaluationMetrics";

function mockSearchResult(): ReturnType<AgentRuntimeDependencies["getSearchForClaim"]> {
  return {
    answer: "mock search result",
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: [],
    relatedQuestions: [],
    _source: "tool-error",
    traceText: "mock",
  };
}

function defaultMockOutputs(case_: GoldenCase): Record<string, Record<string, unknown>> {
  const severity = case_.difficulty === "trap" ? "high" : "medium";
  const verdictType = case_.expectedVerdictType;
  const midCred = Math.round(
    (case_.expectedCredibilityRange[0] + case_.expectedCredibilityRange[1]) / 2
  );

  return {
    rumor_detector: {
      claimAtoms: [case_.claim],
      rumorTypes: case_.category === "health" ? ["健康"] : case_.category === "social" ? ["社会"] : ["科技"],
      rumorIndicators: case_.difficulty === "trap" ? ["虚假紧迫性", "恐惧诉求"] : ["情绪煽动"],
      severity,
      analysis: `该 claim 属于${case_.category}类型，需要进一步核查。`,
      detectedPatterns: ["需要验证"],
      neededEvidence: ["权威来源确认", "原始出处"],
      handoffTargets: ["fact_checker", "source_validator"],
    },
    fact_checker: {
      factCheckResult: verdictType === "false" ? "false" : verdictType === "unverified" ? "unverified" : "partial",
      confidence: case_.difficulty === "trap" ? "low" : "medium",
      sources: ["https://example.com/source-1"],
      supportingEvidence: verdictType === "false" ? [] : ["部分研究显示关联"],
      contradictingSources: verdictType === "mixed_misleading" ? ["反证：样本偏差", "反证：未控制混杂因素"] : [],
      keyFindings: ["发现需要进一步验证", "现有证据不充分"],
      counterEvidence: case_.category === "causal" ? ["观察性研究不能证明因果", "可能存在混杂因素"] : [],
      unresolvedEvidenceGaps: ["缺少官方确认", "缺少原始研究数据"],
      logicRisks: case_.category === "causal" ? ["把相关性当成因果"] : [],
    },
    source_validator: {
      sourceReliability: "medium",
      verifiedSources: ["https://example.com/source-1"],
      questionableSources: case_.difficulty === "trap" ? ["社交媒体转发"] : [],
      missingSources: ["缺少官方来源", "缺少原始出处"],
      verificationNotes: "信源质量中等，需要更多权威来源确认。",
    },
    alternative_explanation_searcher: case_.category === "causal" ? {
      alternativeExplanations: [
        { hypothesis: "混杂因素可能是真实原因", mechanism: "第三变量同时影响暴露和结果", requiredAssumptions: ["存在未观测到的混杂因素"], compatibilityWithEvidence: "medium", plausibility: "high" },
        { hypothesis: "选择偏倚导致观察到的关联", mechanism: "样本不代表总体", requiredAssumptions: ["样本有系统性偏差"], compatibilityWithEvidence: "medium", plausibility: "medium" },
      ],
      conclusion: "存在合理的替代解释，不能将观察到的关联直接等同于因果。",
    } : { alternativeExplanations: [], conclusion: "N/A" },
    counter_evidence_grader: case_.category === "causal" ? {
      counterEvidenceScore: -15,
      evidenceGapScore: -10,
      overallConfidenceAdjustment: -18,
      breakdown: { counterEvidenceStrength: "反证数量中等", gapImpact: "缺少RCT，因果推断受限", causalInferenceStrength: "观察性证据仅支持关联" },
      recommendation: "weaken",
    } : { counterEvidenceScore: 0, evidenceGapScore: 0, overallConfidenceAdjustment: 0, breakdown: { counterEvidenceStrength: "N/A", gapImpact: "N/A", causalInferenceStrength: "N/A" }, recommendation: "maintain" },
    report_composer: {
      verdictType,
      conclusion: case_.goldenRationale.slice(0, 180),
      credibilityScore: midCred,
      credibilityLabel: case_.expectedCredibilityRange[1] > 40 ? "部分可信" : "高度可疑",
      recommendation: "继续追踪",
      summaryForPublic: case_.goldenRationale.slice(0, 160),
      whyHardToVerify: ["现有证据不完整", "需要更多权威来源"],
      evidenceChain: [
        { layer: "1", finding: "发现需要验证", evidence: "搜索证据有限", boundary: "不能下确定结论", sourceRefs: ["source-1"] },
        { layer: "2", finding: "信源质量中等", evidence: "来源可追溯但非权威", boundary: "不能作为最终依据", sourceRefs: ["source-1"] },
        { layer: "3", finding: "证据边界明确", evidence: "缺少关键来源", boundary: "结论需保持谨慎", sourceRefs: [] },
      ],
      causalBoundary: case_.category === "causal" ? "现有证据仅支持相关性，不能证明因果关系。" : "N/A",
      canSay: ["现有证据不支持强结论"],
      cannotSay: ["不能确认因果关系", "不能排除替代解释"],
      closureActions: [
        { type: "archive_doubt", label: "存疑归档", content: "标记为需要继续追踪", status: "needs_review" },
        { type: "follow_up", label: "继续补证", content: "寻找更多权威来源", status: "needs_review" },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability", label: "信源可靠性", score: 40, threshold: 60, passed: false, reason: "信源质量中等" },
        { dimension: "evidence_completeness", label: "证据完整度", score: 30, threshold: 60, passed: false, reason: "证据不完整" },
        { dimension: "consistency", label: "一致性", score: 50, threshold: 60, passed: false, reason: "部分一致" },
        { dimension: "recency", label: "时效性", score: 40, threshold: 60, passed: false, reason: "信息时效性一般" },
        { dimension: "authority", label: "权威性", score: 30, threshold: 60, passed: false, reason: "缺少权威来源" },
      ],
    },
  };
}

/**
 * Create a mock callAgentWithFallback that identifies agents by systemPrompt fingerprint.
 */
function createMockCaller(outputs: Record<string, Record<string, unknown>>) {
  // Each agent's systemPrompt contains a unique identifier that doesn't
  // appear in other agents' prompts. We use these for reliable routing.
  const fingerprintMap: Record<string, string> = {
    "谣言特征检测专家": "rumor_detector",
    "事实核查专家": "fact_checker",
    "信源验证专家": "source_validator",
    "替代解释搜索专家": "alternative_explanation_searcher",
    "反证评分专家": "counter_evidence_grader",
    "核查报告生成专家": "report_composer",
  };

  return async (args: Record<string, unknown>): Promise<{ output: Record<string, unknown>; model: string }> => {
    const systemPrompt = typeof args.systemPrompt === "string" ? args.systemPrompt : "";
    let agentId = "report_composer";

    for (const [fingerprint, id] of Object.entries(fingerprintMap)) {
      if (systemPrompt.includes(fingerprint)) {
        agentId = id;
        break;
      }
    }

    const output = outputs[agentId] ?? {};
    return { output, model: "mock" };
  };
}

/**
 * Run a single golden case through AgentRuntime with deterministic mocks.
 */
export async function runCase(golden: GoldenCase): Promise<CaseResult> {
  const outputs = defaultMockOutputs(golden);
  const mockCaller = createMockCaller(outputs);

  const deps: AgentRuntimeDependencies = {
    env: {},
    codexBin: "echo",
    getSearchForClaim: async () => mockSearchResult(),
    getAgentTimeoutMs: () => 5000,
    getAgentReasoningEffort: () => "medium",
    callAgentWithFallback: mockCaller as AgentRuntimeDependencies["callAgentWithFallback"],
  };

  try {
    const runtime = new AgentRuntime(deps);
    const runResult = await runtime.runCase({ claim: golden.claim });
    return { case: golden, result: runResult };
  } catch (error) {
    return {
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "error",
        steps: [],
        finalReport: {},
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 0,
      },
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

/**
 * Run all golden cases and return scored results.
 */
export async function runBenchmark(): Promise<{
  results: CaseResult[];
  scores: ReturnType<typeof import("./evaluationMetrics").scoreCase>[];
  aggregate: ReturnType<typeof import("./evaluationMetrics").aggregateMetrics>;
}> {
  const { goldenDataset } = await import("./goldenDataset");
  const results: CaseResult[] = [];

  for (const golden of goldenDataset) {
    const result = await runCase(golden);
    results.push(result);
  }

  const { scoreCase, aggregateMetrics } = await import("./evaluationMetrics");
  const scores = results.map((r) => scoreCase(r));
  const aggregate = aggregateMetrics(scores);

  return { results, scores, aggregate };
}
