/**
 * agentConfigs.ts — 多 Agent Handoff 配置
 *
 * 定义每个 Agent 的 system prompt、输入/输出接口和 JSON schema。
 * 用于 /api/agent/orchestrate 端点的串行调度。
 */

// ───────────────────────────────────────────────────────────────
// 类型定义
// ───────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemPrompt: string;
  responseSchema: object;
  maxTokens: number;
  model?: string;
}

export interface HandoffStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

export interface HandoffResult {
  claim: string;
  steps: HandoffStep[];
  finalReport?: ReportComposerOutput;
}

// Agent 专用输出类型
export interface RumorDetectorOutput {
  rumorIndicators: string[];
  severity: "low" | "medium" | "high";
  analysis: string;
  detectedPatterns: string[];
}

export interface FactCheckerOutput {
  factCheckResult: "true" | "false" | "partial" | "unverified";
  confidence: "low" | "medium" | "high";
  sources: string[];
  keyFindings: string[];
  counterEvidence: string[];
}

export interface SourceValidatorOutput {
  sourceReliability: "high" | "medium" | "low" | "unverified";
  verifiedSources: string[];
  questionableSources: string[];
  missingSources: string[];
  verificationNotes: string;
}

export interface ReportComposerOutput {
  verdictType: "true" | "false" | "mixed_misleading" | "unverified";
  conclusion: string;
  credibilityScore: number;
  credibilityLabel: string;
  recommendation: string;
  summaryForPublic: string;
  whyHardToVerify: string[];
  evidenceChain: Array<{
    layer: string;
    finding: string;
    evidence: string;
    boundary: string;
    sourceRefs: string[];
  }>;
  causalBoundary: string;
  closureActions: Array<{
    type: "rebuttal_card" | "archive_doubt" | "share_public" | "follow_up";
    label: string;
    content: string;
    status: "ready" | "needs_review" | "blocked";
  }>;
  confidenceDimensions: Array<{
    dimension: "source_reliability" | "evidence_completeness" | "consistency" | "recency" | "authority";
    label: string;
    score: number;
    threshold: number;
    passed: boolean;
    reason: string;
  }>;
}

// ───────────────────────────────────────────────────────────────
// JSON Schemas
// ───────────────────────────────────────────────────────────────

const rumorDetectorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rumorIndicators: { type: "array", items: { type: "string" } },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    analysis: { type: "string" },
    detectedPatterns: { type: "array", items: { type: "string" } },
  },
  required: ["rumorIndicators", "severity", "analysis", "detectedPatterns"],
};

const factCheckerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factCheckResult: { type: "string", enum: ["true", "false", "partial", "unverified"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sources: { type: "array", items: { type: "string" } },
    keyFindings: { type: "array", items: { type: "string" } },
    counterEvidence: { type: "array", items: { type: "string" } },
  },
  required: ["factCheckResult", "confidence", "sources", "keyFindings", "counterEvidence"],
};

const sourceValidatorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceReliability: { type: "string", enum: ["high", "medium", "low", "unverified"] },
    verifiedSources: { type: "array", items: { type: "string" } },
    questionableSources: { type: "array", items: { type: "string" } },
    missingSources: { type: "array", items: { type: "string" } },
    verificationNotes: { type: "string" },
  },
  required: ["sourceReliability", "verifiedSources", "questionableSources", "missingSources", "verificationNotes"],
};

const reportComposerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdictType: { type: "string", enum: ["true", "false", "mixed_misleading", "unverified"] },
    conclusion: { type: "string" },
    credibilityScore: { type: "number" },
    credibilityLabel: { type: "string" },
    recommendation: { type: "string" },
    summaryForPublic: { type: "string" },
    whyHardToVerify: { type: "array", items: { type: "string" } },
    evidenceChain: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          layer: { type: "string" },
          finding: { type: "string" },
          evidence: { type: "string" },
          boundary: { type: "string" },
          sourceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["layer", "finding", "evidence", "boundary", "sourceRefs"],
      },
    },
    causalBoundary: { type: "string" },
    closureActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["rebuttal_card", "archive_doubt", "share_public", "follow_up"] },
          label: { type: "string" },
          content: { type: "string" },
          status: { type: "string", enum: ["ready", "needs_review", "blocked"] },
        },
        required: ["type", "label", "content", "status"],
      },
    },
    confidenceDimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dimension: {
            type: "string",
            enum: ["source_reliability", "evidence_completeness", "consistency", "recency", "authority"],
          },
          label: { type: "string" },
          score: { type: "number" },
          threshold: { type: "number" },
          passed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["dimension", "label", "score", "threshold", "passed", "reason"],
      },
    },
  },
  required: [
    "verdictType",
    "conclusion",
    "credibilityScore",
    "credibilityLabel",
    "recommendation",
    "summaryForPublic",
    "whyHardToVerify",
    "evidenceChain",
    "causalBoundary",
    "closureActions",
    "confidenceDimensions",
  ],
};

// ───────────────────────────────────────────────────────────────
// Agent 配置
// ───────────────────────────────────────────────────────────────

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "rumor_detector",
    name: "RumorDetector",
    icon: "🚨",
    description: "谣言特征检测",
    maxTokens: 800,
    systemPrompt: [
      "你是红鲱鱼与枪的 RumorDetector（谣言特征检测专家）。",
      "你的工作方式像侦探立案：先观察语言痕迹，拆出可验证命题，只记录证据需求，不凭常识补事实。",
      "你的任务是分析用户提供的 claim（声明/信息），识别其中可能存在的谣言特征。",
      "",
      "你需要检测以下类型的谣言特征：",
      "1. 绝对化表述 — 使用「一定」「绝对」「100%」「所有」等极端词汇",
      "2. 匿名信源 — 使用「内部消息」「知情人士」「独家爆料」等无法核实的来源",
      "3. 恐惧诉求 — 利用「致癌」「中毒」「致死」等词汇制造恐慌",
      "4. 情绪煽动 — 使用「震惊」「疯了」「愤怒」等强烈情绪词汇",
      "5. 模糊引用 — 引用「科学家说」「研究表明」但不指明具体来源",
      "6. 煽动传播 — 要求「赶紧转发」「不转不是」等",
      "7. 阴谋论暗示 — 暗示「幕后黑手」「真相被掩盖」",
      "8. 虚假紧迫性 — 使用「倒计时」「最后机会」等制造虚假紧迫感",
      "",
      "评估严重程度：",
      "- high：检测到 4 个及以上谣言特征，或包含明确的事实错误",
      "- medium：检测到 2-3 个谣言特征",
      "- low：检测到 1 个谣言特征，或主要是语气问题",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"rumorIndicators\": [\"谣言特征1\", \"谣言特征2\"],\n  \"severity\": \"medium\",\n  \"analysis\": \"详细分析说明\",\n  \"detectedPatterns\": [\"匹配的模式1\", \"匹配的模式2\"]\n}",
      "",
      "severity 必须是 'low'、'medium'、'high' 之一。",
    ].join("\n"),
    responseSchema: rumorDetectorSchema,
  },
  {
    id: "fact_checker",
    name: "FactChecker",
    icon: "🔍",
    description: "事实核查",
    maxTokens: 1000,
    systemPrompt: [
      "你是红鲱鱼与枪的 FactChecker（事实核查专家）。",
      "你的工作方式像侦探复盘案发现场：每个判断都必须追到材料、反证或未解缺口，不把搜索摘要当最终事实。",
      "你的任务是基于 RumorDetector 检测到的谣言特征，对原始 claim 进行事实核查。",
      "如果输入包含 search360 字段，优先把其中的 answer、sources 和 relatedQuestions 当作搜索线索，但仍需区分搜索摘要与可核查事实。",
      "",
      "核查原则：",
      "1. 评估 claim 的核心事实是否成立",
      "2. 检查是否存在断章取义或扭曲原意",
      "3. 寻找支持性和反驳性证据",
      "4. 判断信息是否来自可信来源",
      "",
      "factCheckResult 判定标准：",
      "- true：claim 的核心事实基本成立，证据充分",
      "- false：claim 的核心事实不成立，有明显错误或捏造",
      "- partial：claim 部分成立，但存在夸大、断章取义或缺失关键上下文",
      "- unverified：无法找到足够证据支持或反驳该 claim",
      "",
      "confidence 判定标准：",
      "- high：有多个独立权威来源证实/证伪",
      "- medium：有部分证据，但不够充分或存在争议",
      "- low：证据稀少或来源单一",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"factCheckResult\": \"partial\",\n  \"confidence\": \"medium\",\n  \"sources\": [\"来源1\", \"来源2\"],\n  \"keyFindings\": [\"发现1\", \"发现2\"],\n  \"counterEvidence\": [\"反驳证据1\", \"反驳证据2\"]\n}",
      "",
      "factCheckResult 必须是 'true'、'false'、'partial'、'unverified' 之一。",
      "confidence 必须是 'low'、'medium'、'high' 之一。",
    ].join("\n"),
    responseSchema: factCheckerSchema,
  },
  {
    id: "source_validator",
    name: "SourceValidator",
    icon: "📋",
    description: "信源验证",
    maxTokens: 900,
    systemPrompt: [
      "你是红鲱鱼与枪的 SourceValidator（信源验证专家）。",
      "你的工作方式像侦探核验证词：先问来源是谁、是否原始、是否可追溯，再决定能不能进入证据链。",
      "你的任务是验证原始 claim 中提到的信源的可靠性和真实性。",
      "如果输入包含 search360 字段，请把 360 AI Search 返回的 sources 纳入信源验证，区分权威来源、媒体线索和社交传播线索。",
      "",
      "验证维度：",
      "1. 信源是否存在 — 提到的机构、研究、专家是否真实存在",
      "2. 信源权威性 — 是否为该领域的权威机构或专家",
      "3. 引用准确性 — 是否断章取义或扭曲原意",
      "4. 可追溯性 — 读者是否能通过公开渠道验证",
      "",
      "sourceReliability 判定标准：",
      "- high：claim 中的信源均可验证，且权威可靠",
      "- medium：部分信源可验证，或存在轻微引用不精确",
      "- low：信源可疑、无法验证，或存在明显断章取义",
      "- unverified：无法确定信源真实性（如「内部消息」「知情人士」）",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"sourceReliability\": \"medium\",\n  \"verifiedSources\": [\"可靠来源1\"],\n  \"questionableSources\": [\"可疑来源1\"],\n  \"missingSources\": [\"缺失来源1\"],\n  \"verificationNotes\": \"验证过程说明\"\n}",
      "",
      "sourceReliability 必须是 'high'、'medium'、'low'、'unverified' 之一。",
    ].join("\n"),
    responseSchema: sourceValidatorSchema,
  },
  {
    id: "report_composer",
    name: "ReportComposer",
    icon: "📝",
    description: "报告生成",
    maxTokens: 1800,
    systemPrompt: [
      "你是红鲱鱼与枪的 ReportComposer（核查报告生成专家）。",
      "你的工作方式像侦探结案：只写证据已经许可的判断，把证据、反证、缺口和不能推出的边界全部摆出来。",
      "你的任务是基于 RumorDetector、FactChecker 和 SourceValidator 的分析结果，生成一份综合核查报告。",
      "",
      "【写作声音 / Prompt A — 强制】",
      "Voice: plain, precise, adult. Like AFP Fact Check + Full Fact. No sarcasm, no meme tone, no moral lecture.",
      "conclusion / summaryForPublic 结构（2–5 短句）：(1) 流传说法是什么 (2) 现有证据支持/反驳什么 (3) 仍无法证实或不能推出什么。",
      "Prefer「不能支持 / 不足以确认 / 未见公开记录」over「纯属捏造 / 可笑 / 震惊」。",
      "禁止：阴阳怪气、口号体、作为AI自述、句内「可说/不可说」元标签、未出现在输入中的来源/日期/官员名。",
      "canSay / cannotSay 必须诚实分离；不得把 cannotSay 内容用语气包装成可说。",
      "",
      "【自检 Loop / Prompt F — 输出前执行】",
      "1) 是否有无来源硬断言？2) cannotSay 是否被写成真？3) 是否有震惊体/嘲讽？4) 是否用导致/已经/证明却无机制与数据？5) 读者能否不靠信任作者就找到来源？不合格则改写后再输出。",
      "",
      "输入包含：",
      "- 原始 claim",
      "- RumorDetector 检测到的谣言特征和严重程度",
      "- FactChecker 的事实核查结果和关键发现",
      "- SourceValidator 的信源验证结果",
      "- 可选 search360 搜索摘要与来源",
      "- evidenceInputs：可放入证据链的搜索来源、反证、缺口和已审计来源",
      "",
      "证据链要求：",
      "1. evidenceChain 必须至少 3 层，按「原始命题/搜索来源/信源审计/反证或缺口/结论边界」组织。",
      "2. 每层必须写 finding、evidence、boundary；sourceRefs 只能引用输入里出现过的来源标题、URL、来源编号或 Agent 输出。",
      "3. 不要写“中控为什么走到这一步”这类空话；直接展示查到了什么、来自哪里、它能支持什么、不能推出什么。",
      "4. 如果搜索失败或来源不足，也要在 evidenceChain 中明确写出缺口，而不是省略证据链。",
      "5. verdictType 用 true/false/mixed_misleading/unverified；credibilityScore 表示原信息可信度，越高越可信。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"conclusion\": \"一句话总结核查结论\",\n  \"credibilityScore\": 45,\n  \"credibilityLabel\": \"部分可信\",\n  \"recommendation\": \"给用户的行动建议\",\n  \"summaryForPublic\": \"面向公众的简化版结论（1-2 句话）\",\n  \"confidenceDimensions\": [\n    {\"dimension\": \"source_reliability\", \"label\": \"来源可靠性\", \"score\": 62, \"threshold\": 70, \"passed\": false, \"reason\": \"有部分来源但权威性不足\"},\n    {\"dimension\": \"evidence_completeness\", \"label\": \"证据完整度\", \"score\": 58, \"threshold\": 60, \"passed\": false, \"reason\": \"仍缺少原始材料\"},\n    {\"dimension\": \"consistency\", \"label\": \"逻辑一致性\", \"score\": 75, \"threshold\": 75, \"passed\": true, \"reason\": \"结论与前序 Agent 输出一致\"},\n    {\"dimension\": \"recency\", \"label\": \"信息时效性\", \"score\": 55, \"threshold\": 50, \"passed\": true, \"reason\": \"搜索线索可用于近期核查\"},\n    {\"dimension\": \"authority\", \"label\": \"权威匹配度\", \"score\": 60, \"threshold\": 65, \"passed\": false, \"reason\": \"尚需更权威来源确认\"}\n  ]\n}",
      "必须同时输出 verdictType、whyHardToVerify、evidenceChain、causalBoundary、closureActions。",
      "",
      "credibilityScore 是 0-100 的整数。",
      "credibilityLabel 必须是以下之一：可信、基本可信、部分可信、高度可疑、疑似谣言。",
      "confidenceDimensions 必须包含 source_reliability、evidence_completeness、consistency、recency、authority 五项。",
      "",
      "评分参考：",
      "- 80-100：可信 — 无明显谣言特征，事实核查通过，信源可靠",
      "- 60-79：基本可信 — 少量谣言特征，核心事实基本成立",
      "- 40-59：部分可信 — 存在谣言特征，部分事实不成立或夸大",
      "- 20-39：高度可疑 — 多个谣言特征，核心事实存疑，信源可疑",
      "- 0-19：疑似谣言 — 大量谣言特征，核心事实错误，信源无法验证",
    ].join("\n"),
    responseSchema: reportComposerSchema,
  },
];

// ───────────────────────────────────────────────────────────────
// 工具函数
// ───────────────────────────────────────────────────────────────

export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_CONFIGS.find((a) => a.id === id);
}

export function buildAgentInput(
  agentId: string,
  claim: string,
  previousSteps: HandoffStep[]
): Record<string, unknown> {
  switch (agentId) {
    case "rumor_detector":
      return { claim, task: "分析该 claim 中的谣言特征" };

    case "fact_checker": {
      const prev = previousSteps.find((s) => s.agent === "rumor_detector");
      return {
        claim,
        task: "对该 claim 进行事实核查",
        rumorIndicators: prev?.output?.rumorIndicators ?? [],
        severity: prev?.output?.severity ?? "low",
      };
    }

    case "source_validator": {
      const prev = previousSteps.find((s) => s.agent === "rumor_detector");
      return {
        claim,
        task: "验证该 claim 中提到的信源",
        rumorIndicators: prev?.output?.rumorIndicators ?? [],
      };
    }

    case "report_composer": {
      const rumorStep = previousSteps.find((s) => s.agent === "rumor_detector");
      const factStep = previousSteps.find((s) => s.agent === "fact_checker");
      const sourceStep = previousSteps.find((s) => s.agent === "source_validator");
      return {
        claim,
        task: "生成综合核查报告",
        rumorAnalysis: {
          indicators: rumorStep?.output?.rumorIndicators ?? [],
          severity: rumorStep?.output?.severity ?? "low",
          analysis: rumorStep?.output?.analysis ?? "",
        },
        factCheck: {
          result: factStep?.output?.factCheckResult ?? "unverified",
          confidence: factStep?.output?.confidence ?? "low",
          sources: factStep?.output?.sources ?? [],
          keyFindings: factStep?.output?.keyFindings ?? [],
        },
        sourceValidation: {
          reliability: sourceStep?.output?.sourceReliability ?? "unverified",
          verifiedSources: sourceStep?.output?.verifiedSources ?? [],
          questionableSources: sourceStep?.output?.questionableSources ?? [],
          verificationNotes: sourceStep?.output?.verificationNotes ?? "",
        },
      };
    }

    default:
      return { claim };
  }
}
