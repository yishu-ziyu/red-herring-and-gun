// ───────────────────────────────────────────────────────────────
// Demo Data — 纯静态部署时的 fallback 数据
// 从 vite.config.ts 的 buildOrchestrateDemoFallback / buildDemoFallback 迁移而来
// ───────────────────────────────────────────────────────────────

import type { AgentExpansionResponse, HandoffResult, RecursiveSearchResponse, SherlockSearchResponse } from "./agentExpansion";

function buildDemoConfidenceDimensions() {
  return [
    { dimension: "source_reliability", label: "来源可靠性", score: 58, threshold: 70, passed: false, reason: "Demo 模式下只有模拟来源，按保守值处理。" },
    { dimension: "evidence_completeness", label: "证据完整度", score: 54, threshold: 60, passed: false, reason: "仍需补充原始材料和权威来源。" },
    { dimension: "consistency", label: "逻辑一致性", score: 72, threshold: 75, passed: false, reason: "前序 Agent 输出大体一致，但尚未完全闭环。" },
    { dimension: "recency", label: "信息时效性", score: 52, threshold: 50, passed: true, reason: "Demo 结果不含发布时间，采用保守时效性判断。" },
    { dimension: "authority", label: "权威匹配度", score: 48, threshold: 65, passed: false, reason: "缺少明确权威机构来源。" },
  ];
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
        systemPrompt: "检测谣言特征",
        input: { claim },
        output: {
          rumorIndicators: ["检测到绝对化表述", "检测到匿名信源暗示"],
          severity: "medium",
          analysis: `对"${claim}"的谣言特征分析。该声明包含若干典型谣言特征，包括绝对化表述和可能的匿名信源暗示。`,
          detectedPatterns: ["绝对化表述", "匿名信源"],
        },
        model: "demo-fallback",
        latencyMs: 800,
        timestamp: now,
        status: "completed",
      },
      {
        agent: "fact_checker",
        agentName: "FactChecker",
        agentIcon: "⚖️",
        systemPrompt: "事实核查与证据收集",
        input: { claim, rumorIndicators: ["检测到绝对化表述", "检测到匿名信源暗示"] },
        output: {
          factCheckResult: "partial",
          confidence: "medium",
          sources: ["Demo 来源：相关科普文章", "Demo 来源：专家访谈"],
          keyFindings: ["核心事实部分成立", "存在一定程度的夸大或断章取义"],
          counterEvidence: ["反面证据：部分数据不支持该结论", "反面证据：存在更准确的替代解释"],
        },
        model: "demo-fallback",
        latencyMs: 1200,
        timestamp: now + 1000,
        status: "completed",
      },
      {
        agent: "source_validator",
        agentName: "SourceValidator",
        agentIcon: "📋",
        systemPrompt: "信源验证",
        input: { claim, sources: ["Demo 来源：相关科普文章", "Demo 来源：专家访谈"] },
        output: {
          sourceReliability: "medium",
          verifiedSources: ["Demo：某权威机构官方网站"],
          questionableSources: ["Demo：社交媒体转发"],
          missingSources: ["Demo：原始研究或公告未指明"],
          verificationNotes: "Demo 模式：部分信源具备可追溯性，但仍缺少原始材料。",
        },
        model: "demo-fallback",
        latencyMs: 900,
        timestamp: now + 1500,
        status: "completed",
      },
      {
        agent: "report_composer",
        agentName: "ReportComposer",
        agentIcon: "📋",
        systemPrompt: "综合报告生成",
        input: { claim, factCheckResult: "partial", confidence: "medium" },
        output: {
          conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
          credibilityScore: 45,
          credibilityLabel: "部分可信",
          recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
          summaryForPublic: "该信息包含部分事实，但也存在夸大和谣言特征，建议谨慎对待。",
          confidenceDimensions: buildDemoConfidenceDimensions(),
        },
        model: "demo-fallback",
        latencyMs: 600,
        timestamp: now + 2400,
        status: "completed",
      },
    ],
    finalReport: {
      conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
      credibilityScore: 45,
      credibilityLabel: "部分可信",
      recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
      summaryForPublic: "该信息包含部分事实，但也存在夸大和谣言特征，建议谨慎对待。",
      confidenceDimensions: buildDemoConfidenceDimensions(),
    },
  };
}

// ── Orchestrate Stream (SSE 流式) ─────────────────────────────

export function* buildOrchestrateStreamDemoFallback(claim: string): Generator<{
  type: "agent_start" | "agent_complete" | "complete";
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  output?: Record<string, unknown>;
  model?: string;
  latencyMs?: number;
  steps?: { agent: string; agentName: string; agentIcon: string; output: Record<string, unknown>; model: string; latencyMs: number; timestamp: number; status: string }[];
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
  };

  yield {
    type: "agent_complete",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    agentIcon: "🔍",
    output: {
      rumorIndicators: ["检测到绝对化表述", "检测到匿名信源暗示"],
      severity: "medium",
      analysis: `对"${claim}"的谣言特征分析。该声明包含若干典型谣言特征。`,
      detectedPatterns: ["绝对化表述", "匿名信源"],
    },
    model: "demo-fallback",
    latencyMs: 800,
  };

  yield {
    type: "agent_start",
    agent: "fact_checker",
    agentName: "FactChecker",
    agentIcon: "⚖️",
  };

  yield {
    type: "agent_complete",
    agent: "fact_checker",
    agentName: "FactChecker",
    agentIcon: "⚖️",
    output: {
      factCheckResult: "partial",
      confidence: "medium",
      sources: ["Demo 来源：相关科普文章", "Demo 来源：专家访谈"],
      keyFindings: ["核心事实部分成立", "存在一定程度的夸大或断章取义"],
    },
    model: "demo-fallback",
    latencyMs: 1200,
  };

  yield {
    type: "agent_start",
    agent: "source_validator",
    agentName: "SourceValidator",
    agentIcon: "📋",
  };

  yield {
    type: "agent_complete",
    agent: "source_validator",
    agentName: "SourceValidator",
    agentIcon: "📋",
    output: {
      sourceReliability: "medium",
      verifiedSources: ["Demo：某权威机构官方网站"],
      questionableSources: ["Demo：社交媒体转发"],
      missingSources: ["Demo：原始研究或公告未指明"],
      verificationNotes: "Demo 模式：部分信源具备可追溯性，但仍缺少原始材料。",
    },
    model: "demo-fallback",
    latencyMs: 900,
  };

  yield {
    type: "agent_start",
    agent: "report_composer",
    agentName: "ReportComposer",
    agentIcon: "📋",
  };

  yield {
    type: "agent_complete",
    agent: "report_composer",
    agentName: "ReportComposer",
    agentIcon: "📋",
    output: {
      conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
      credibilityScore: 45,
      credibilityLabel: "部分可信",
      recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
      confidenceDimensions: buildDemoConfidenceDimensions(),
    },
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
        output: {
          rumorIndicators: ["检测到绝对化表述", "检测到匿名信源暗示"],
          severity: "medium",
          analysis: `对"${claim}"的谣言特征分析。`,
          detectedPatterns: ["绝对化表述", "匿名信源"],
        },
        model: "demo-fallback",
        latencyMs: 800,
        timestamp: now,
        status: "completed",
      },
      {
        agent: "fact_checker",
        agentName: "FactChecker",
        agentIcon: "⚖️",
        output: {
          factCheckResult: "partial",
          confidence: "medium",
          sources: ["Demo 来源：相关科普文章", "Demo 来源：专家访谈"],
          keyFindings: ["核心事实部分成立", "存在一定程度的夸大或断章取义"],
        },
        model: "demo-fallback",
        latencyMs: 1200,
        timestamp: now + 1000,
        status: "completed",
      },
      {
        agent: "source_validator",
        agentName: "SourceValidator",
        agentIcon: "📋",
        output: {
          sourceReliability: "medium",
          verifiedSources: ["Demo：某权威机构官方网站"],
          questionableSources: ["Demo：社交媒体转发"],
          missingSources: ["Demo：原始研究或公告未指明"],
          verificationNotes: "Demo 模式：部分信源具备可追溯性，但仍缺少原始材料。",
        },
        model: "demo-fallback",
        latencyMs: 900,
        timestamp: now + 1500,
        status: "completed",
      },
      {
        agent: "report_composer",
        agentName: "ReportComposer",
        agentIcon: "📋",
        output: {
          conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
          credibilityScore: 45,
          credibilityLabel: "部分可信",
          recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
          confidenceDimensions: buildDemoConfidenceDimensions(),
        },
        model: "demo-fallback",
        latencyMs: 600,
        timestamp: now + 2400,
        status: "completed",
      },
    ],
    finalReport: {
      conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
      credibilityScore: 45,
      credibilityLabel: "部分可信",
      recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
      confidenceDimensions: buildDemoConfidenceDimensions(),
    },
    totalLatencyMs: 3500,
  };
}

// ── Single Agent Expand ───────────────────────────────────────

export function buildExpandDemoFallback(mode: string, nodeTitle: string): AgentExpansionResponse {
  const fallbacks: Record<string, AgentExpansionResponse> = {
    search: {
      controllerNote: `用户要求对"${nodeTitle}"进行联网搜索。Demo 模式下返回模拟搜索结果。`,
      agentTitle: "Searcher 子 Agent",
      agentSubtitle: "模拟搜索：返回与该节点相关的候选材料",
      resultTitle: "新增候选证据（模拟）",
      resultSubtitle: "以下材料为演示数据，真实环境将调用搜索引擎",
      resultStatus: "limited",
      traceText: `我在"${nodeTitle}"附近搜索到新的候选材料，已接入画布。`,
      inspectorSummary: "模拟搜索返回了 3 份候选材料。它们可以支撑部分讨论，但证据强度有限。",
      canSay: ["找到新的讨论材料", "可作为背景线索或进一步审计的起点"],
      cannotSay: ["不能直接将搜索结论作为最终判断", "需要进一步审计材料来源和证据强度"],
      sources: ["模拟来源：相关学术论文摘要", "模拟来源：行业报告片段", "模拟来源：新闻报道"],
      model: "demo-fallback:search",
    },
    evidence_audit: {
      controllerNote: `用户对"${nodeTitle}"发起证据审计。Demo 模式下返回模拟审计结果。`,
      agentTitle: "Grader 子 Agent",
      agentSubtitle: "模拟审计：评估当前节点可以说什么、不能说什么",
      resultTitle: "证据审计结果（模拟）",
      resultSubtitle: "当前节点的证据许可与限制",
      resultStatus: "active",
      traceText: `我审计了"${nodeTitle}"，发现还需要更多直接证据才能下结论。`,
      inspectorSummary: "模拟审计表明，当前材料不足以支持强结论，建议标记为待验证。",
      canSay: ["可以用作背景信息", "可以支撑初步讨论"],
      cannotSay: ["不能作为直接因果证据", "不能推出确定性结论"],
      sources: [],
      model: "demo-fallback:evidence_audit",
    },
    counter: {
      controllerNote: `用户对"${nodeTitle}"发起反证生成。Demo 模式下返回模拟反证。`,
      agentTitle: "Counter 子 Agent",
      agentSubtitle: "模拟反证：生成替代解释和反面检查路径",
      resultTitle: "反向分支（模拟）",
      resultSubtitle: "可能的替代解释和削弱因素",
      resultStatus: "risk",
      traceText: `我沿着"${nodeTitle}"生成了反证路径，防止过度自信。`,
      inspectorSummary: "模拟反证提示：可能存在宏观经济、行业周期等替代解释。",
      canSay: ["存在替代解释的可能性", "需要考虑反面证据"],
      cannotSay: ["不能因此否定原判断", "不能将可能性当作确定性"],
      sources: ["模拟来源：反方观点综述"],
      model: "demo-fallback:counter",
    },
    rewrite: {
      controllerNote: `用户对"${nodeTitle}"发起局部改写。Demo 模式下返回模拟改写。`,
      agentTitle: "Composer 子 Agent",
      agentSubtitle: "模拟改写：基于当前证据给出更谨慎的表达",
      resultTitle: "局部改写（模拟）",
      resultSubtitle: "将强断言调整为证据允许的范围",
      resultStatus: "rewrite",
      traceText: `我改写了"${nodeTitle}"的表达，使其更符合现有证据。`,
      inspectorSummary: "模拟改写完成：原句中的强因果推断已调整为更谨慎的表述。",
      canSay: ["可以用更谨慎的方式表达原观点", "保留核心观点但降低断言强度"],
      cannotSay: ["不能在没有证据的情况下保留强断言", "不能把不确定性包装成确定性"],
      sources: [],
      model: "demo-fallback:rewrite",
    },
  };

  return fallbacks[mode] ?? fallbacks.evidence_audit;
}

// ── Recursive Search ──────────────────────────────────────────

export function buildRecursiveSearchDemoFallback(claim: string): RecursiveSearchResponse {
  return {
    controllerNote: `用户对"${claim}"发起递归深度搜索。Demo 模式下返回模拟递归搜索结果。`,
    runTitle: "递归深度搜索（模拟）",
    traceText: "模拟递归搜索：已遍历 2 层推理深度，发现若干候选线索。",
    clues: [
      {
        id: "demo-clue-1",
        title: "模拟线索：背景信息",
        summary: "这是一条模拟的递归搜索线索，用于展示递归搜索功能的界面效果。",
        source: "Demo 来源",
        role: "context",
        confidence: "medium",
      },
      {
        id: "demo-clue-2",
        title: "模拟线索：支持证据",
        summary: "这是一条模拟的支持性证据线索。",
        source: "Demo 来源",
        role: "support",
        confidence: "low",
      },
    ],
    frontier: [
      {
        id: "demo-frontier-1",
        title: "模拟前沿节点",
        reasonToContinue: "可以继续深入探索该方向。",
        nextQuestion: "下一步可以追问什么问题？",
        estimatedValue: "medium",
      },
    ],
    stopped: [
      {
        id: "demo-stopped-1",
        title: "模拟终止节点",
        reason: "budget",
      },
    ],
    canSay: ["模拟递归搜索返回了若干线索"],
    cannotSay: ["不能将模拟数据作为真实结论"],
    model: "demo-fallback:recursive",
  };
}

// ── Sherlock Search ───────────────────────────────────────────

export function buildSherlockSearchDemoFallback(claim: string): SherlockSearchResponse {
  return {
    controllerNote: `用户对"${claim}"发起 Sherlock 风格搜索。Demo 模式下返回模拟结果。`,
    runTitle: "Sherlock 多平台溯源搜索（模拟）",
    traceText: "模拟 Sherlock 搜索：已扫描多个信息源，整理出关键发现。",
    hits: [
      {
        sourceId: "demo-source-1",
        sourceName: "模拟平台",
        sourceIcon: "🔍",
        matchedUrl: "https://example.com/demo",
        detectionMethod: "demo",
        trustLevel: "medium",
        matchedKeywords: ["模拟"],
        factCheckResult: "partial",
        summary: "模拟搜索结果：该平台暂无针对此声明的直接核查记录。",
      },
    ],
    sourcesSearched: 20,
    sourcesMatched: 1,
    supportQueries: [`${claim} 证据 来源 官方说明`],
    contradictQueries: [`${claim} 辟谣 反例 无法证实`],
    supportingEvidence: [
      {
        sourceId: "demo-source-1",
        sourceName: "模拟平台",
        sourceIcon: "🔍",
        matchedUrl: "https://example.com/demo",
        detectionMethod: "demo",
        trustLevel: "medium",
        matchedKeywords: ["模拟"],
        factCheckResult: "partial",
        evidenceRole: "限定",
        summary: "模拟搜索结果：该平台暂无针对此声明的直接核查记录。",
      },
    ],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: ["Demo 模式未找到明确反证。"],
    canSay: ["Sherlock 搜索返回了模拟线索"],
    cannotSay: ["不能将模拟数据作为真实结论"],
    model: "demo-fallback:sherlock",
  };
}
