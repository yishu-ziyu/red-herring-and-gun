// ───────────────────────────────────────────────────────────────
// Demo Data — 纯静态部署时的 fallback 数据
// 从 vite.config.ts 的 buildOrchestrateDemoFallback / buildDemoFallback 迁移而来
// ───────────────────────────────────────────────────────────────

import type { AgentExpansionResponse, HandoffResult, RecursiveSearchResponse, SherlockSearchResponse } from "./agentExpansion";
import { getAgentContract } from "./agentConfigs";

function buildDemoConfidenceDimensions() {
  return [
    { dimension: "source_reliability", label: "来源可靠性", score: 0, threshold: 70, passed: false, reason: "服务未返回真实信源。" },
    { dimension: "evidence_completeness", label: "证据完整度", score: 0, threshold: 60, passed: false, reason: "服务未返回真实证据。" },
    { dimension: "consistency", label: "逻辑一致性", score: 0, threshold: 75, passed: false, reason: "没有真实 Agent 输出可供合成。" },
    { dimension: "recency", label: "信息时效性", score: 0, threshold: 50, passed: false, reason: "没有真实搜索结果可判断时效性。" },
    { dimension: "authority", label: "权威匹配度", score: 0, threshold: 65, passed: false, reason: "没有真实权威来源。" },
  ];
}

function buildConservativeFactCheckFallback() {
  return {
    factCheckResult: "unverified",
    confidence: "low",
    sources: [],
    supportingEvidence: [],
    contradictingSources: [],
    keyFindings: [],
    counterEvidence: [],
    unresolvedEvidenceGaps: ["事实核查模型未返回真实结果，系统不生成事实判断。"],
  };
}

function buildConservativeSourceFallback() {
  return {
    sourceReliability: "unverified",
    verifiedSources: [],
    questionableSources: [],
    missingSources: [],
    verificationNotes: "信源验证模型未返回真实结果，系统不生成信源判断。",
  };
}

function buildConservativeReportFallback() {
  return {
    conclusion: "报告生成模型未返回真实结果，系统不生成核查结论。",
    credibilityScore: 0,
    credibilityLabel: "未出结论",
    recommendation: "请在模型和搜索服务返回真实结果后再查看核查报告。",
    summaryForPublic: "本次运行没有生成可发布结论。",
    confidenceDimensions: buildDemoConfidenceDimensions(),
  };
}

function buildRumorDetectorFallback() {
  return {
    _source: "demo-fallback",
    claimAtoms: [],
    rumorTypes: [],
    rumorIndicators: [],
    severity: "low",
    analysis: "谣言特征检测模型未返回真实结果，系统不生成判断。",
    detectedPatterns: [],
    neededEvidence: ["需要真实模型分诊后才能生成证据需求。"],
    handoffTargets: ["fact_checker", "source_validator"],
  };
}

// ── Orchestrate (多 Agent Handoff) ────────────────────────────

export function buildOrchestrateDemoFallback(claim: string): HandoffResult {
  const now = Date.now();
  return {
    claim,
    steps: [
      {
        agent: "rumor_detector",
        agentName: "RumorDetector",
        agentIcon: "🔍",
        agentContract: getAgentContract("rumor_detector"),
        systemPrompt: "检测谣言特征",
        input: { claim },
        output: buildRumorDetectorFallback(),
        model: "demo-fallback",
        latencyMs: 800,
        timestamp: now,
        status: "completed",
      },
      {
        agent: "fact_checker",
        agentName: "FactChecker",
        agentIcon: "⚖️",
        agentContract: getAgentContract("fact_checker"),
        systemPrompt: "事实核查与证据收集",
        input: { claim, rumorIndicators: [] },
        output: buildConservativeFactCheckFallback(),
        model: "demo-fallback",
        latencyMs: 1200,
        timestamp: now + 1000,
        status: "completed",
      },
      {
        agent: "source_validator",
        agentName: "SourceValidator",
        agentIcon: "📋",
        agentContract: getAgentContract("source_validator"),
        systemPrompt: "信源验证",
        input: { claim, sources: [] },
        output: buildConservativeSourceFallback(),
        model: "demo-fallback",
        latencyMs: 900,
        timestamp: now + 1500,
        status: "completed",
      },
      {
        agent: "report_composer",
        agentName: "ReportComposer",
        agentIcon: "📋",
        agentContract: getAgentContract("report_composer"),
        systemPrompt: "综合报告生成",
        input: { claim, factCheckResult: "unverified", confidence: "low" },
        output: buildConservativeReportFallback(),
        model: "demo-fallback",
        latencyMs: 600,
        timestamp: now + 2400,
        status: "completed",
      },
    ],
    finalReport: buildConservativeReportFallback(),
  };
}

// ── Orchestrate Stream (SSE 流式) ─────────────────────────────

export function* buildOrchestrateStreamDemoFallback(claim: string): Generator<{
  type: "agent_start" | "agent_complete" | "complete";
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  agentContract?: ReturnType<typeof getAgentContract>;
  output?: Record<string, unknown>;
  model?: string;
  latencyMs?: number;
  steps?: { agent: string; agentName: string; agentIcon: string; agentContract?: ReturnType<typeof getAgentContract>; output: Record<string, unknown>; model: string; latencyMs: number; timestamp: number; status: string }[];
  finalReport?: Record<string, unknown>;
  totalLatencyMs?: number;
  claim?: string;
}> {
  const now = Date.now();

  yield {
    type: "agent_start",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    agentIcon: "🔍",
    agentContract: getAgentContract("rumor_detector"),
  };

  yield {
    type: "agent_complete",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    agentIcon: "🔍",
    agentContract: getAgentContract("rumor_detector"),
    output: buildRumorDetectorFallback(),
    model: "demo-fallback",
    latencyMs: 800,
  };

  yield {
    type: "agent_start",
    agent: "fact_checker",
    agentName: "FactChecker",
    agentIcon: "⚖️",
    agentContract: getAgentContract("fact_checker"),
  };

  yield {
    type: "agent_complete",
    agent: "fact_checker",
    agentName: "FactChecker",
    agentIcon: "⚖️",
    agentContract: getAgentContract("fact_checker"),
    output: buildConservativeFactCheckFallback(),
    model: "demo-fallback",
    latencyMs: 1200,
  };

  yield {
    type: "agent_start",
    agent: "source_validator",
    agentName: "SourceValidator",
    agentIcon: "📋",
    agentContract: getAgentContract("source_validator"),
  };

  yield {
    type: "agent_complete",
    agent: "source_validator",
    agentName: "SourceValidator",
    agentIcon: "📋",
    agentContract: getAgentContract("source_validator"),
    output: buildConservativeSourceFallback(),
    model: "demo-fallback",
    latencyMs: 900,
  };

  yield {
    type: "agent_start",
    agent: "report_composer",
    agentName: "ReportComposer",
    agentIcon: "📋",
    agentContract: getAgentContract("report_composer"),
  };

  yield {
    type: "agent_complete",
    agent: "report_composer",
    agentName: "ReportComposer",
    agentIcon: "📋",
    agentContract: getAgentContract("report_composer"),
    output: buildConservativeReportFallback(),
    model: "demo-fallback",
    latencyMs: 600,
  };

  yield {
    type: "complete",
    claim,
    steps: [
      {
        agent: "rumor_detector",
        agentName: "RumorDetector",
        agentIcon: "🔍",
        agentContract: getAgentContract("rumor_detector"),
        output: buildRumorDetectorFallback(),
        model: "demo-fallback",
        latencyMs: 800,
        timestamp: now,
        status: "completed",
      },
      {
        agent: "fact_checker",
        agentName: "FactChecker",
        agentIcon: "⚖️",
        agentContract: getAgentContract("fact_checker"),
        output: buildConservativeFactCheckFallback(),
        model: "demo-fallback",
        latencyMs: 1200,
        timestamp: now + 1000,
        status: "completed",
      },
      {
        agent: "source_validator",
        agentName: "SourceValidator",
        agentIcon: "📋",
        agentContract: getAgentContract("source_validator"),
        output: buildConservativeSourceFallback(),
        model: "demo-fallback",
        latencyMs: 900,
        timestamp: now + 1500,
        status: "completed",
      },
      {
        agent: "report_composer",
        agentName: "ReportComposer",
        agentIcon: "📋",
        agentContract: getAgentContract("report_composer"),
        output: buildConservativeReportFallback(),
        model: "demo-fallback",
        latencyMs: 600,
        timestamp: now + 2400,
        status: "completed",
      },
    ],
    finalReport: buildConservativeReportFallback(),
    totalLatencyMs: 3500,
  };
}

// ── Single Agent Expand ───────────────────────────────────────

export function buildExpandDemoFallback(mode: string, nodeTitle: string): AgentExpansionResponse {
  const labels: Record<string, string> = {
    search: "Searcher 子 Agent",
    evidence_audit: "Grader 子 Agent",
    counter: "Counter 子 Agent",
    rewrite: "Composer 子 Agent",
  };

  return {
    controllerNote: `用户对"${nodeTitle}"发起 ${mode}，但 Agent 服务未返回真实结果。`,
    agentTitle: labels[mode] ?? "Agent",
    agentSubtitle: "服务未返回真实结果",
    resultTitle: "未生成结果",
    resultSubtitle: "系统不会用模拟内容补全核查判断。",
    resultStatus: "blocked",
    traceText: "Agent 服务未返回真实结果，本次不生成补充解释。",
    inspectorSummary: "没有真实模型输出，不能形成可用结论或证据。",
    canSay: [],
    cannotSay: ["不能将缺失的模型输出包装成事实、证据或建议"],
    sources: [],
    model: `demo-fallback:${mode}`,
  };
}

// ── Recursive Search ──────────────────────────────────────────

export function buildRecursiveSearchDemoFallback(claim: string): RecursiveSearchResponse {
  return {
    controllerNote: `用户对"${claim}"发起递归深度搜索，但搜索服务未返回真实结果。`,
    runTitle: "递归深度搜索",
    traceText: "搜索服务未返回真实结果，系统不生成递归线索。",
    clues: [],
    frontier: [],
    stopped: [],
    canSay: [],
    cannotSay: ["不能将缺失的搜索结果包装成线索或结论"],
    model: "demo-fallback:recursive",
  };
}

// ── Sherlock Search ───────────────────────────────────────────

export function buildSherlockSearchDemoFallback(claim: string): SherlockSearchResponse {
  return {
    controllerNote: `用户对"${claim}"发起 Sherlock 风格搜索，但搜索服务未返回真实结果。`,
    runTitle: "Sherlock 多平台溯源搜索",
    traceText: "搜索服务未返回真实结果，系统不生成搜索线索。",
    hits: [],
    sourcesSearched: 0,
    sourcesMatched: 0,
    supportQueries: [`${claim} 证据 来源 官方说明`],
    contradictQueries: [`${claim} 辟谣 反例 无法证实`],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: ["搜索服务未返回真实结果，不能确认或反驳该声明。"],
    canSay: [],
    cannotSay: ["不能将未返回的搜索结果包装成事实或线索"],
    model: "demo-fallback:sherlock",
  };
}
