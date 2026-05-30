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
  contract: AgentContract;
  systemPrompt: string;
  responseSchema: object;
  maxTokens: number;
}

export type AgentToolKind = "llm" | "search" | "memory" | "canvas" | "report";

export interface AgentToolCapability {
  id: string;
  name: string;
  kind: AgentToolKind;
  description: string;
  external?: boolean;
}

export interface AgentMemoryContract {
  reads: string[];
  writes: string[];
}

export interface AgentUiTraceContract {
  start: string[];
  running: string[];
  complete: string[];
}

export interface AgentContract {
  id: string;
  name: string;
  icon: string;
  roleTitle: string;
  mission: string;
  nonGoals: string[];
  tools: AgentToolCapability[];
  memory: AgentMemoryContract;
  inputContract: string[];
  outputContract: string[];
  handoffRules: string[];
  uiTrace: AgentUiTraceContract;
  failurePolicy: string;
  evaluationChecks: string[];
}

export interface HandoffStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  agentContract?: AgentContract;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  evidenceBundle?: import("./schemas").AgentEvidenceBundle;
  error?: string;
}

export interface HandoffResult {
  claim: string;
  steps: HandoffStep[];
  finalReport?: ReportComposerOutput;
}

// Agent 专用输出类型
export interface RumorDetectorOutput {
  claimAtoms: string[];
  rumorTypes: string[];
  rumorIndicators: string[];
  severity: "low" | "medium" | "high";
  analysis: string;
  detectedPatterns: string[];
  neededEvidence: string[];
  handoffTargets: string[];
}

export interface FactCheckerOutput {
  factCheckResult: "true" | "false" | "partial" | "unverified";
  confidence: "low" | "medium" | "high";
  sources: string[];
  supportingEvidence: string[];
  contradictingSources: string[];
  keyFindings: string[];
  counterEvidence: string[];
  unresolvedEvidenceGaps: string[];
  logicRisks?: string[];
}

export interface SourceValidatorOutput {
  sourceReliability: "high" | "medium" | "low" | "unverified";
  verifiedSources: string[];
  questionableSources: string[];
  missingSources: string[];
  verificationNotes: string;
}

export interface ReportComposerOutput {
  conclusion: string;
  credibilityScore: number;
  credibilityLabel: string;
  recommendation: string;
  summaryForPublic: string;
  logicRiskItems?: import("./schemas").BiasAuditFinding[];
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
// Agent Contract / Agent Card
// ───────────────────────────────────────────────────────────────

export const AGENT_CONTRACTS: Record<string, AgentContract> = {
  rumor_detector: {
    id: "rumor_detector",
    name: "RumorDetector",
    icon: "🚨",
    roleTitle: "声明分诊与谣言类型路由 Agent",
    mission: "把用户输入改写成可核查的原子命题，识别谣言类型、风险信号和后续证据需求，但不直接判断真假。",
    nonGoals: ["不生成最终结论", "不把语言风险等同于事实为假", "不补充没有证据的背景解释", "不使用模型常识判断人物状态、死因、政策、时间等外部事实"],
    tools: [
      { id: "llm_claim_triage", name: "LLM 声明分诊", kind: "llm", description: "用国产大模型理解 claim、拆分原子命题并识别谣言类型。" },
      { id: "rumor_pattern_knowledge", name: "谣言类型知识库", kind: "memory", description: "读取健康、社会、科技、财经、政治、娱乐等类型的风险模式。" },
      { id: "case_memory_lookup", name: "历史案例检索", kind: "memory", description: "检索相似 claim 的历史分诊和有效核查路径。" },
    ],
    memory: {
      reads: ["历史谣言类型", "相似 claim 分诊记录", "高风险表达模式"],
      writes: ["原子命题", "谣言类型标签", "证据需求", "下游 handoff 目标"],
    },
    inputContract: ["原始 claim", "可选历史相似案例", "可选用户场景"],
    outputContract: ["claimAtoms", "rumorTypes", "rumorIndicators", "severity", "neededEvidence", "handoffTargets"],
    handoffRules: ["必须把 neededEvidence 交给 FactChecker", "必须把可疑信源线索交给 SourceValidator", "不得跳过后续核查直接给 ReportComposer"],
    uiTrace: {
      start: ["读取原始声明", "检索相似谣言类型"],
      running: ["拆分可核查原子命题", "标注谣言类型和风险信号", "生成后续证据需求"],
      complete: ["交接给事实核查与信源验证 Agent"],
    },
    failurePolicy: "如果模型或记忆检索失败，只输出空数组和 unverified 边界，不生成猜测性分类。",
    evaluationChecks: ["是否拆出可核查命题", "是否区分语言风险和事实真假", "是否明确后续证据需求", "是否避免输出未经工具验证的外部事实"],
  },
  fact_checker: {
    id: "fact_checker",
    name: "FactChecker",
    icon: "🔍",
    roleTitle: "多源事实交叉验证 Agent",
    mission: "围绕原子命题寻找支持、反驳和限定证据，用多搜索源一致性判断事实状态。",
    nonGoals: ["不审判信源身份本身", "不把单一搜索摘要当作最终事实", "不把未找到反证等同于真实"],
    tools: [
      { id: "llm_fact_reasoning", name: "LLM 事实推理", kind: "llm", description: "把搜索结果转成可核查发现、反证和证据缺口。" },
      { id: "search360", name: "360 AI Search", kind: "search", description: "调用 360 生态搜索获得国产大模型搜索线索。", external: true },
      { id: "cross_search_consensus", name: "多搜索交叉验证", kind: "search", description: "对支持和反驳 query 做结果一致性比较。" },
    ],
    memory: {
      reads: ["RumorDetector 的证据需求", "历史有效 query", "相似 claim 的已验证证据"],
      writes: ["支持证据", "反驳证据", "未解决缺口", "有效/无效 query 记忆"],
    },
    inputContract: ["claim", "claimAtoms", "rumorIndicators", "多搜索引擎证据包"],
    outputContract: ["factCheckResult", "confidence", "supportingEvidence", "counterEvidence", "unresolvedEvidenceGaps"],
    handoffRules: ["必须把 sources 和 unresolvedEvidenceGaps 交给 ReportComposer", "发现来源疑点时交给 SourceValidator 复核"],
    uiTrace: {
      start: ["读取证据需求", "生成支持/反驳搜索 query"],
      running: ["调用 360 搜索", "比较多源结果一致性", "提取支持与反驳证据"],
      complete: ["输出事实状态和未解决缺口"],
    },
    failurePolicy: "如果搜索或模型不可用，factCheckResult 必须是 unverified，证据数组必须为空。",
    evaluationChecks: ["是否同时寻找支持和反驳", "是否标出未解决缺口", "是否避免单源定论"],
  },
  source_validator: {
    id: "source_validator",
    name: "SourceValidator",
    icon: "📋",
    roleTitle: "溯源与信源可靠性 Agent",
    mission: "验证来源是否存在、是否权威、是否被断章取义，并在画布节点上提供递归证据搜索能力。",
    nonGoals: ["不替 FactChecker 判断核心事实", "不自动无限展开 frontier", "不把聚合搜索结果包装成原始出处"],
    tools: [
      { id: "source_quality_audit", name: "信源质量审计", kind: "llm", description: "评估来源类型、权威性、时效性、可追溯性和独立性。" },
      { id: "recursive_evidence_search", name: "递归证据搜索", kind: "canvas", description: "从用户选中的节点出发，一轮生成 clues/frontier/stopped，不自动继续。", external: true },
      { id: "search360_source_trace", name: "360 来源溯源", kind: "search", description: "用 360 搜索结果辅助识别原始来源和传播链。", external: true },
    ],
    memory: {
      reads: ["候选来源库", "历史高质量域名", "已停止 frontier"],
      writes: ["来源可信度", "证据可追溯性", "递归搜索 clues/frontier/stopped"],
    },
    inputContract: ["claim", "candidate sources", "RumorDetector 风险信号", "FactChecker 证据列表"],
    outputContract: ["sourceReliability", "verifiedSources", "questionableSources", "missingSources", "verificationNotes"],
    handoffRules: ["必须把 verified/questionable/missing sources 交给 ReportComposer", "递归搜索结果只进入 Canvas，等待用户选择下一轮"],
    uiTrace: {
      start: ["读取候选来源", "检查可追溯性"],
      running: ["区分原始来源和传播来源", "审计权威性与独立性", "必要时开放递归搜索入口"],
      complete: ["交付信源可靠性和缺失来源"],
    },
    failurePolicy: "如果来源无法验证，sourceReliability 必须是 unverified，并说明缺失来源，不得补写虚假来源。",
    evaluationChecks: ["是否区分原始出处和二次传播", "是否说明 missingSources", "是否保留递归搜索的用户控制权"],
  },
  report_composer: {
    id: "report_composer",
    name: "ReportComposer",
    icon: "📝",
    roleTitle: "证据边界报告与闭环 Agent",
    mission: "只基于前序 Agent 的结构化输出生成结论、置信度维度、公众表达和闭环动作建议。",
    nonGoals: ["不新增未经前序 Agent 验证的事实", "不把未出结论包装成确定判断", "不隐藏证据缺口"],
    tools: [
      { id: "llm_report_synthesis", name: "LLM 报告合成", kind: "llm", description: "将多 Agent 输出合成为结构化核查报告。" },
      { id: "fire_confidence", name: "FIRE 置信度评估", kind: "report", description: "按来源、完整度、一致性、时效、权威五维调制置信度。" },
      { id: "closure_actions", name: "闭环动作生成", kind: "report", description: "生成辟谣卡片、存疑归档、分享表达等后续动作。" },
    ],
    memory: {
      reads: ["前序 Agent 输出", "相似案例结论", "证据质量摘要"],
      writes: ["最终报告", "置信度维度", "可复用案例记忆", "闭环动作记录"],
    },
    inputContract: ["RumorDetector 输出", "FactChecker 输出", "SourceValidator 输出", "多搜索引擎证据包"],
    outputContract: ["conclusion", "credibilityScore", "credibilityLabel", "summaryForPublic", "confidenceDimensions"],
    handoffRules: ["只在证据足够时给可发布结论", "证据不足时输出未出结论和 nextEvidenceNeeded", "结果必须写入 Agent Memory"],
    uiTrace: {
      start: ["读取三方 Agent 结果", "检查证据边界"],
      running: ["合成结论", "计算 FIRE 置信度", "生成公众版表达"],
      complete: ["写入报告和闭环动作"],
    },
    failurePolicy: "如果前序输出为空或来自 fallback，必须输出未出结论，不得生成补充性判断。",
    evaluationChecks: ["是否忠实引用前序证据", "是否暴露证据缺口", "是否生成闭环动作建议"],
  },
};

export function getAgentContract(id: string): AgentContract | undefined {
  return AGENT_CONTRACTS[id];
}

function summarizeAgentContract(contract: AgentContract) {
  return [
    "",
    "Agent Contract:",
    `- 身份: ${contract.roleTitle}`,
    `- 使命: ${contract.mission}`,
    `- 不能做: ${contract.nonGoals.join("；")}`,
    `- 可用工具: ${contract.tools.map((tool) => `${tool.name}(${tool.kind})`).join("；")}`,
    `- 读取记忆: ${contract.memory.reads.join("；")}`,
    `- 写入记忆: ${contract.memory.writes.join("；")}`,
    `- 输出契约: ${contract.outputContract.join("；")}`,
    `- 交接规则: ${contract.handoffRules.join("；")}`,
    `- 失败策略: ${contract.failurePolicy}`,
  ].join("\n");
}

function withAgentContract(agentId: string, prompt: string) {
  const contract = getAgentContract(agentId);
  return contract ? `${prompt}\n${summarizeAgentContract(contract)}` : prompt;
}

function buildRuntimeAgentContract(agentId: string) {
  const contract = getAgentContract(agentId);
  if (!contract) return undefined;
  return {
    roleTitle: contract.roleTitle,
    mission: contract.mission,
    tools: contract.tools.map((tool) => ({ id: tool.id, name: tool.name, kind: tool.kind })),
    memoryRead: contract.memory.reads,
    memoryWrite: contract.memory.writes,
    handoffRules: contract.handoffRules,
    failurePolicy: contract.failurePolicy,
  };
}

// ───────────────────────────────────────────────────────────────
// JSON Schemas
// ───────────────────────────────────────────────────────────────

const rumorDetectorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claimAtoms: { type: "array", items: { type: "string" } },
    rumorTypes: { type: "array", items: { type: "string" } },
    rumorIndicators: { type: "array", items: { type: "string" } },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    analysis: { type: "string" },
    detectedPatterns: { type: "array", items: { type: "string" } },
    neededEvidence: { type: "array", items: { type: "string" } },
    handoffTargets: { type: "array", items: { type: "string" } },
  },
  required: ["claimAtoms", "rumorTypes", "rumorIndicators", "severity", "analysis", "detectedPatterns", "neededEvidence", "handoffTargets"],
};

const factCheckerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factCheckResult: { type: "string", enum: ["true", "false", "partial", "unverified"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sources: { type: "array", items: { type: "string" } },
    supportingEvidence: { type: "array", items: { type: "string" } },
    contradictingSources: { type: "array", items: { type: "string" } },
    keyFindings: { type: "array", items: { type: "string" } },
    counterEvidence: { type: "array", items: { type: "string" } },
    unresolvedEvidenceGaps: { type: "array", items: { type: "string" } },
    logicRisks: { type: "array", items: { type: "string" } },
  },
  required: ["factCheckResult", "confidence", "sources", "supportingEvidence", "contradictingSources", "keyFindings", "counterEvidence", "unresolvedEvidenceGaps"],
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
    conclusion: { type: "string" },
    credibilityScore: { type: "number" },
    credibilityLabel: { type: "string" },
    recommendation: { type: "string" },
    summaryForPublic: { type: "string" },
    logicRiskItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          explanation: { type: "string" },
          affectedSubclaimId: { type: "string" },
          mitigation: { type: "string" },
        },
        required: ["id", "label", "severity", "explanation", "mitigation"],
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
  required: ["conclusion", "credibilityScore", "credibilityLabel", "recommendation", "summaryForPublic", "confidenceDimensions"],
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
    contract: AGENT_CONTRACTS.rumor_detector,
    maxTokens: 800,
    systemPrompt: withAgentContract("rumor_detector", [
      "你是红鲱鱼与枪的 RumorDetector（谣言特征检测专家）。",
      "你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题，再识别其中可能存在的谣言特征和谣言类型。",
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
      "谣言类型可从健康、社会、科技、财经、政治、娱乐中选择；如果无法确认，返回空数组并在 neededEvidence 说明缺少什么。",
      "关键边界：你此时没有联网搜索结果，也没有权威材料。不得写“已知事实”“实际上”“仍在世”“已经去世”“死因为”等外部事实判断；只能说“需要验证 X”。",
      "severity 的 high 只能来自文本风险或高危主题，不得因为你自认为 claim 事实错误而判 high。",
      "analysis 必须聚焦语言风险、命题结构和证据需求；不得补充 claim 之外的现实背景。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"claimAtoms\": [\"可核查原子命题1\"],\n  \"rumorTypes\": [\"社会\"],\n  \"rumorIndicators\": [\"谣言特征1\", \"谣言特征2\"],\n  \"severity\": \"medium\",\n  \"analysis\": \"详细分析说明\",\n  \"detectedPatterns\": [\"匹配的模式1\", \"匹配的模式2\"],\n  \"neededEvidence\": [\"需要查找的证据类型\"],\n  \"handoffTargets\": [\"fact_checker\", \"source_validator\"]\n}",
      "handoffTargets 可包含 fact_checker、source_validator、report_composer，但不得直接跳到 report_composer。",
      "",
      "severity 必须是 'low'、'medium'、'high' 之一。",
    ].join("\n")),
    responseSchema: rumorDetectorSchema,
  },
  {
    id: "fact_checker",
    name: "FactChecker",
    icon: "🔍",
    description: "事实核查",
    contract: AGENT_CONTRACTS.fact_checker,
    maxTokens: 1000,
    systemPrompt: withAgentContract("fact_checker", [
      "你是红鲱鱼与枪的 FactChecker（事实核查专家）。",
      "你的任务是基于 RumorDetector 检测到的谣言特征，对原始 claim 进行事实核查。",
      "如果输入包含 search360 字段，优先把其中的 answer、sources 和 relatedQuestions 当作搜索线索，但仍需区分搜索摘要与可核查事实。",
      "只能基于输入中的 search360.sources、前序 Agent 输出和明确给定材料写 keyFindings；不得引入模型记忆里的外部事实。",
      "当 search360._source 为 tool-error，或 sources 为空时，factCheckResult 必须是 unverified，sources/supportingEvidence/counterEvidence 必须为空数组。",
      "搜索摘要中的说法不能自动视为事实；必须在 unresolvedEvidenceGaps 说明是否缺少官方、原始、医学、公告等更高等级来源。",
      "",
      "核查原则：",
      "1. 评估 claim 的核心事实是否成立",
      "2. 检查是否存在断章取义或扭曲原意",
      "3. 寻找支持性和反驳性证据；如果没有找到反证，也必须明确写入 unresolvedEvidenceGaps",
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
      "必须额外返回 supportingEvidence、contradictingSources、unresolvedEvidenceGaps；contradictingSources 或 counterEvidence 没有命中时，写入空数组，并在 unresolvedEvidenceGaps 说明“未找到明确反证”。",
      "",
      "factCheckResult 必须是 'true'、'false'、'partial'、'unverified' 之一。",
      "confidence 必须是 'low'、'medium'、'high' 之一。",
    ].join("\n")),
    responseSchema: factCheckerSchema,
  },
  {
    id: "source_validator",
    name: "SourceValidator",
    icon: "📋",
    description: "信源验证",
    contract: AGENT_CONTRACTS.source_validator,
    maxTokens: 900,
    systemPrompt: withAgentContract("source_validator", [
      "你是红鲱鱼与枪的 SourceValidator（信源验证专家）。",
      "你的任务是验证原始 claim 中提到的信源的可靠性和真实性。",
      "如果输入包含 search360 字段，请把 360 AI Search 返回的 sources 纳入信源验证，区分权威来源、媒体线索和社交传播线索。",
      "不得把搜索聚合结果包装成原始出处；没有官方/原始链接时必须写入 missingSources。",
      "不得用模型常识补写某个来源存在或不存在，只能评价输入中实际提供的 URL、标题、摘要和缺失项。",
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
    ].join("\n")),
    responseSchema: sourceValidatorSchema,
  },
  {
    id: "report_composer",
    name: "ReportComposer",
    icon: "📝",
    description: "报告生成",
    contract: AGENT_CONTRACTS.report_composer,
    maxTokens: 1000,
    systemPrompt: withAgentContract("report_composer", [
      "你是红鲱鱼与枪的 ReportComposer（核查报告生成专家）。",
      "你的任务是基于 RumorDetector、FactChecker 和 SourceValidator 的分析结果，生成一份综合核查报告。",
      "硬约束：不得新增前序 Agent 和 search360.sources 中没有出现的事实；不得把搜索摘要中的未经核验说法改写成确定事实。",
      "如果 FactChecker 或 SourceValidator 标记缺少官方/原始/医学来源，summaryForPublic 必须保留这个证据边界。",
      "",
      "输入包含：",
      "- 原始 claim",
      "- RumorDetector 检测到的谣言特征和严重程度",
      "- FactChecker 的事实核查结果和关键发现",
      "- SourceValidator 的信源验证结果",
      "- 可选 search360 搜索摘要与来源",
      "- 可选 logicRisks / biasWarnings / doNotInfer，需要归入逻辑风险审计并反映到 consistency 分数",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"conclusion\": \"一句话总结核查结论\",\n  \"credibilityScore\": 45,\n  \"credibilityLabel\": \"部分可信\",\n  \"recommendation\": \"给用户的行动建议\",\n  \"summaryForPublic\": \"面向公众的简化版结论（1-2 句话）\",\n  \"confidenceDimensions\": [\n    {\"dimension\": \"source_reliability\", \"label\": \"来源可靠性\", \"score\": 62, \"threshold\": 70, \"passed\": false, \"reason\": \"有部分来源但权威性不足\"},\n    {\"dimension\": \"evidence_completeness\", \"label\": \"证据完整度\", \"score\": 58, \"threshold\": 60, \"passed\": false, \"reason\": \"仍缺少原始材料\"},\n    {\"dimension\": \"consistency\", \"label\": \"逻辑一致性\", \"score\": 75, \"threshold\": 75, \"passed\": true, \"reason\": \"结论与前序 Agent 输出一致\"},\n    {\"dimension\": \"recency\", \"label\": \"信息时效性\", \"score\": 55, \"threshold\": 50, \"passed\": true, \"reason\": \"搜索线索可用于近期核查\"},\n    {\"dimension\": \"authority\", \"label\": \"权威匹配度\", \"score\": 60, \"threshold\": 65, \"passed\": false, \"reason\": \"尚需更权威来源确认\"}\n  ]\n}",
      "",
      "credibilityScore 是 0-100 的整数。",
      "credibilityLabel 必须是以下之一：可信、基本可信、部分可信、高度可疑、疑似谣言。",
      "confidenceDimensions 必须包含 source_reliability、evidence_completeness、consistency、recency、authority 五项。",
      "如果存在逻辑风险，confidenceDimensions 中 consistency 的分数必须降低，并在 reason 中解释。",
      "",
      "评分参考：",
      "- 80-100：可信 — 无明显谣言特征，事实核查通过，信源可靠",
      "- 60-79：基本可信 — 少量谣言特征，核心事实基本成立",
      "- 40-59：部分可信 — 存在谣言特征，部分事实不成立或夸大",
      "- 20-39：高度可疑 — 多个谣言特征，核心事实存疑，信源可疑",
      "- 0-19：疑似谣言 — 大量谣言特征，核心事实错误，信源无法验证",
    ].join("\n")),
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
  const agentContract = buildRuntimeAgentContract(agentId);

  switch (agentId) {
    case "rumor_detector":
      return { claim, task: "分诊 claim、拆分原子命题、识别谣言类型与后续证据需求", agentContract };

    case "fact_checker": {
      const prev = previousSteps.find((s) => s.agent === "rumor_detector");
      return {
        claim,
        task: "对该 claim 进行事实核查",
        agentContract,
        claimAtoms: prev?.output?.claimAtoms ?? [],
        rumorTypes: prev?.output?.rumorTypes ?? [],
        rumorIndicators: prev?.output?.rumorIndicators ?? [],
        severity: prev?.output?.severity ?? "low",
        neededEvidence: prev?.output?.neededEvidence ?? [],
      };
    }

    case "source_validator": {
      const prev = previousSteps.find((s) => s.agent === "rumor_detector");
      return {
        claim,
        task: "验证该 claim 中提到的信源",
        agentContract,
        claimAtoms: prev?.output?.claimAtoms ?? [],
        rumorTypes: prev?.output?.rumorTypes ?? [],
        rumorIndicators: prev?.output?.rumorIndicators ?? [],
        neededEvidence: prev?.output?.neededEvidence ?? [],
      };
    }

    case "report_composer": {
      const rumorStep = previousSteps.find((s) => s.agent === "rumor_detector");
      const factStep = previousSteps.find((s) => s.agent === "fact_checker");
      const sourceStep = previousSteps.find((s) => s.agent === "source_validator");
      return {
        claim,
        task: "生成综合核查报告",
        agentContract,
        rumorAnalysis: {
          claimAtoms: rumorStep?.output?.claimAtoms ?? [],
          rumorTypes: rumorStep?.output?.rumorTypes ?? [],
          indicators: rumorStep?.output?.rumorIndicators ?? [],
          severity: rumorStep?.output?.severity ?? "low",
          analysis: rumorStep?.output?.analysis ?? "",
          neededEvidence: rumorStep?.output?.neededEvidence ?? [],
        },
        factCheck: {
          result: factStep?.output?.factCheckResult ?? "unverified",
          confidence: factStep?.output?.confidence ?? "low",
          sources: factStep?.output?.sources ?? [],
          supportingEvidence: factStep?.output?.supportingEvidence ?? [],
          contradictingSources: factStep?.output?.contradictingSources ?? [],
          keyFindings: factStep?.output?.keyFindings ?? [],
          counterEvidence: factStep?.output?.counterEvidence ?? [],
          unresolvedEvidenceGaps: factStep?.output?.unresolvedEvidenceGaps ?? [],
          logicRisks: factStep?.output?.logicRisks ?? [],
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
