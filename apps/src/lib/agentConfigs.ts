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
  finalReport?: FinalReportOutput;
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

export interface FinalReportOutput {
  verdictType: "true" | "false" | "mixed_misleading" | "unverified";
  conclusion: string;
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
  canSay: string[];
  cannotSay: string[];
  closureActions: Array<{
    type: "rebuttal_card" | "archive_doubt" | "share_public" | "follow_up";
    label: string;
    content: string;
    status: "ready" | "needs_review" | "blocked";
  }>;
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
    roleTitle: "拆题与类型识别",
    mission: "把用户输入改写成可核查的原子命题，识别谣言类型、风险信号和后续证据需求，但不直接判断真假。",
    nonGoals: ["不生成最终结论", "不把语言风险等同于事实为假", "不补充没有证据的背景解释", "不使用模型常识判断人物状态、死因、政策、时间等外部事实"],
    tools: [
      { id: "llm_claim_triage", name: "拆题", kind: "llm", description: "用国产大模型理解 claim、拆分原子命题并识别谣言类型。" },
      { id: "memory_search", name: "谣言类型知识库", kind: "memory", description: "读取健康、社会、科技、财经、政治、娱乐等类型的风险模式。" },
      { id: "memory_search", name: "历史案例检索", kind: "memory", description: "检索相似 claim 的历史拆题和有效核查路径。" },
    ],
    memory: {
      reads: ["历史谣言类型", "相似 claim 拆题记录", "高风险表达模式"],
      writes: ["原子命题", "谣言类型标签", "证据需求", "下游 handoff 目标"],
    },
    inputContract: ["原始 claim", "可选历史相似案例", "可选用户场景"],
    outputContract: ["claimAtoms", "rumorTypes", "rumorIndicators", "severity", "neededEvidence", "handoffTargets"],
    handoffRules: ["必须把 neededEvidence 交给 FactChecker", "必须把可疑信源线索交给 SourceValidator", "不得跳过后续核查直接写报告"],
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
    roleTitle: "事实核查",
    mission: "围绕原子命题寻找支持、反驳和限定证据，用多搜索源一致性判断事实状态。",
    nonGoals: ["不审判信源身份本身", "不把单一搜索摘要当作最终事实", "不把未找到反证等同于真实"],
    tools: [
      { id: "llm_fact_reasoning", name: "LLM 事实推理", kind: "llm", description: "把搜索结果转成可核查发现、反证和证据缺口。" },
      { id: "search360", name: "360 AI Search", kind: "search", description: "调用 360 生态搜索获得国产大模型搜索线索。", external: true },
      { id: "parallel_search", name: "多搜索交叉验证", kind: "search", description: "对支持和反驳 query 做结果一致性比较。" },
    ],
    memory: {
      reads: ["RumorDetector 的证据需求", "历史有效 query", "相似 claim 的已验证证据"],
      writes: ["支持证据", "反驳证据", "未解决缺口", "有效/无效 query 记忆"],
    },
    inputContract: ["claim", "claimAtoms", "rumorIndicators", "多搜索引擎证据包"],
    outputContract: ["factCheckResult", "confidence", "supportingEvidence", "counterEvidence", "unresolvedEvidenceGaps"],
    handoffRules: ["必须把 sources 和 unresolvedEvidenceGaps 交给报告", "发现来源疑点时交给 SourceValidator 复核"],
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
    roleTitle: "溯源",
    mission: "验证来源是否存在、是否权威、是否被断章取义，并在画布节点上提供递归证据搜索能力。",
    nonGoals: ["不替 FactChecker 判断核心事实", "不自动无限展开 frontier", "不把聚合搜索结果包装成原始出处"],
    tools: [
      { id: "source_quality_audit", name: "信源质量审计", kind: "llm", description: "评估来源类型、权威性、时效性、可追溯性和独立性。" },
      { id: "recursive_evidence_search", name: "递归证据搜索", kind: "canvas", description: "从用户选中的节点出发，一轮生成 clues/frontier/stopped，不自动继续。", external: true },
      { id: "search360", name: "360 来源溯源", kind: "search", description: "用 360 搜索结果辅助识别原始来源和传播链。", external: true },
    ],
    memory: {
      reads: ["候选来源库", "历史高质量域名", "已停止 frontier"],
      writes: ["来源可信度", "证据可追溯性", "递归搜索 clues/frontier/stopped"],
    },
    inputContract: ["claim", "candidate sources", "RumorDetector 风险信号", "FactChecker 证据列表"],
    outputContract: ["sourceReliability", "verifiedSources", "questionableSources", "missingSources", "verificationNotes"],
    handoffRules: ["必须把 verified/questionable/missing sources 交给报告", "递归搜索结果只进入 Canvas，等待用户选择下一轮"],
    uiTrace: {
      start: ["读取候选来源", "检查可追溯性"],
      running: ["区分原始来源和传播来源", "审计权威性与独立性", "必要时开放递归搜索入口"],
      complete: ["交付信源可靠性和缺失来源"],
    },
    failurePolicy: "如果来源无法验证，sourceReliability 必须是 unverified，并说明缺失来源，不得补写虚假来源。",
    evaluationChecks: ["是否区分原始出处和二次传播", "是否说明 missingSources", "是否保留递归搜索的用户控制权"],
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
    `- 职责: ${contract.mission}`,
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

const verdictSourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    url: { type: "string" },
    title: { type: "string" },
    snippet: { type: "string" },
  },
  required: ["url", "title", "snippet"],
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
    subclaimVerdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimAtom: { type: "string" },
          verdict: { type: "string", enum: ["true", "false", "partial", "unverified", "exaggerated"] },
          evidence: {
            type: "string",
            description:
              "Evidence prose for this atom. [n] is 1-based over supportingSources then contradictingSources. If supportingSources is empty and contradictingSources is not, [1] is the first contradicting source. Do not invent numbers.",
          },
          boundary: { type: "string" },
          supportingSources: {
            type: "array",
            items: verdictSourceSchema,
            description:
              "Sources that support this claim atom (the atom is true according to this source). Do not put sources that refute the atom here.",
          },
          contradictingSources: {
            type: "array",
            items: verdictSourceSchema,
            description:
              "Sources that refute this claim atom (the atom is false according to this source). When verdict=false, cited sources belong here.",
          },
          evidenceGaps: { type: "array", items: { type: "string" } },
        },
        required: ["claimAtom", "verdict", "evidence", "boundary"],
      },
    },
  },
  required: ["factCheckResult", "confidence", "sources", "supportingEvidence", "contradictingSources", "keyFindings", "counterEvidence", "unresolvedEvidenceGaps", "subclaimVerdicts"],
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

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "rumor_detector",
    name: "RumorDetector",
    icon: "🚨",
    description: "谣言特征检测",
    contract: AGENT_CONTRACTS.rumor_detector,
    maxTokens: 800,
    systemPrompt: withAgentContract("rumor_detector", [
      "你是红鲱鱼与枪的 RumorDetector。",
      "先观察语言痕迹，拆出可验证命题，只记录证据需求，不凭常识补事实。",
      "你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题，再识别其中可能存在的谣言特征和谣言类型。",
      "",
      "原子命题的判定标准（拆分时严格遵循）：",
      "1. 每个原子命题必须是一个独立、可单独核查的判断——要么是某个个体/对象的性质，要么是两个个体/对象之间的关系。",
      "2. 原子命题必须能被原句自证：每个 claimAtom 都只能由用户提供的 claim 直接支持，不得引入原句未声称的信息、补全上下文或加入你自己的常识。",
      "3. 不要求原子命题彼此独立，但每个原子命题都必须被原句明确声称；宁可少而均，不要多而碎。",
      "4. 若原句含独立判断（如「药能治失眠」「药已获批准」），必须拆成多个原子命题，不得合并成一条。",
      "5. 拆分完成后，把 claimAtoms 拼接回读一遍，确认每条都能回溯到原句——不能回溯的删掉。",
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
      "handoffTargets 只能包含 fact_checker、source_validator。",
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
      "你是红鲱鱼与枪的 FactChecker。",
      "每个判断都必须追到材料、反证或未解缺口，不把搜索摘要当最终事实。",
      "只根据输入里的 search360、前序 Agent 输出和用户材料做事实核查，不得调用模型记忆补事实。",
      "当 search360._source 为 tool-error 或 sources 为空：factCheckResult=unverified，证据数组为空。",
      "搜索摘要只能当线索。必须区分：支持证据、反驳证据、仍缺少的官方/原始/医学/公告来源。",
      "",
      "判定：true=核心成立；false=核心不成立；partial=有真实片段但夸大/偷换/缺上下文；unverified=证据不足。",
      "confidence：high=多独立权威来源；medium=有证据但有限；low=证据稀少或来源弱。",
      "健康/医学 claim 要特别标出：观察性相关不能证明因果，成分机制不能等于真实健康收益。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "字段：factCheckResult, confidence, sources, supportingEvidence, contradictingSources, keyFindings, counterEvidence, unresolvedEvidenceGaps, logicRisks, subclaimVerdicts。",
      "数组每项不超过 80 个中文字符；keyFindings 2-4 条；counterEvidence 1-3 条；unresolvedEvidenceGaps 1-3 条。",
      "",
      "factCheckResult 必须是 'true'、'false'、'partial'、'unverified' 之一。",
      "confidence 必须是 'low'、'medium'、'high' 之一。",
      "subclaimVerdicts 必须覆盖输入 claimAtoms 中的每个原子命题，且每条 claimAtom 必须能回溯到原句；不得引入原句未声称的信息。",
      "verdict 取值：true=该原子命题成立；false=该原子命题不成立；partial=有真实片段但夸大/偷换；exaggerated=被夸大；unverified=证据不足。",
      "每条 subclaimVerdicts 可含 supportingSources / contradictingSources / evidenceGaps（url/title/snippet 必须来自输入真实来源）。",
      "supportingSources 只放支持该原子命题的来源；contradictingSources 只放反驳该原子命题的来源。verdict=false 时引用必须写入 contradictingSources，不得为了 [n] 把反驳材料写入 supportingSources。",
      "【句内引用编号】[n] 按 supportingSources 再 contradictingSources 的合并顺序；supporting 为空时 [1] 对应 contradictingSources 第 1 条；两桶都空不得写 [n]；禁止编造编号。",
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
      "你是红鲱鱼与枪的 SourceValidator。",
      "先问来源是谁、是否原始、是否可追溯，再决定能不能进入证据链。",
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
];

// ───────────────────────────────────────────────────────────────
// 工具函数
// ───────────────────────────────────────────────────────────────

export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_CONFIGS.find((a) => a.id === id);
}

// ───────────────────────────────────────────────────────────────
// 声明式 Agent 注册表
// ───────────────────────────────────────────────────────────────

export interface AgentRegistry {
  /** 按 id 获取 AgentConfig；未注册返回 undefined */
  getAgent(id: string): AgentConfig | undefined;
  /** 判断某 Agent 真实模型调用失败后是否可继续（不阻断收束） */
  canContinueAfterFailure(id: string): boolean;
}

// 拆题、核查、信源审计失败后可继续检索与收束（未完成 + 保留已检索材料），
// 而不是让整轮抛错、用户等完后一无所得（eval 260814-1206 首轮三 case 均因此中断）。
const CONTINUE_AFTER_FAILURE_AGENTS = new Set([
  "rumor_detector",
  "fact_checker",
  "source_validator",
]);

function createAgentRegistry(configs: AgentConfig[]): AgentRegistry {
  const byId = new Map<string, AgentConfig>(configs.map((config) => [config.id, config]));
  return {
    getAgent: (id) => byId.get(id),
    canContinueAfterFailure: (id) => CONTINUE_AFTER_FAILURE_AGENTS.has(id),
  };
}

const agentRegistry = createAgentRegistry(AGENT_CONFIGS);

export function getAgentRegistry(): AgentRegistry {
  return agentRegistry;
}

export function buildAgentInput(
  agentId: string,
  claim: string,
  previousSteps: HandoffStep[]
): Record<string, unknown> {
  switch (agentId) {
    case "rumor_detector":
      return { claim, task: "拆开 claim、标出可核查判断、识别谣言类型与后续证据需求" };

    case "fact_checker": {
      const prev = previousSteps.find((s) => s.agent === "rumor_detector");
      return {
        claim,
        task: "对该 claim 进行事实核查",
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
        claimAtoms: prev?.output?.claimAtoms ?? [],
        rumorTypes: prev?.output?.rumorTypes ?? [],
        rumorIndicators: prev?.output?.rumorIndicators ?? [],
        neededEvidence: prev?.output?.neededEvidence ?? [],
      };
    }

    default:
      return { claim };
  }
}
