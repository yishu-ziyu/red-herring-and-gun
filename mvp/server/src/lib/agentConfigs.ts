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
export interface VerdictSource {
  url: string;
  title: string;
  snippet: string;
}

export interface SubclaimVerdict {
  claimAtom: string;
  verdict: "true" | "false" | "partial" | "unverified" | "exaggerated";
  evidence: string;
  boundary: string;
  // 判定可追溯：逐条定罪绑定结构化来源（可展开依据卡）；三个新字段可选，兜底为空数组
  supportingSources?: VerdictSource[];
  contradictingSources?: VerdictSource[];
  evidenceGaps?: string[];
}

export type ClaimAtomType =
  | "fact"
  | "causal"
  | "comparison"
  | "concept"
  | "value"
  | "prediction"
  | "normative"
  | "personal";

export interface RumorDetectorOutput {
  claimAtoms: string[];
  claimAtomTypes: Array<{
    text: string;
    verifiable: boolean;
    type: ClaimAtomType;
  }>;
  // 整句判定字段（与系统既有 claimType/ExecutionDagClaimType 区分），命名 stanceClaimType
  stanceClaimType: {
    verifiable: boolean;
    type: ClaimAtomType | "mixed";
    reason: string;
  };
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
  subclaimVerdicts: SubclaimVerdict[];
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
  subclaimVerdicts: SubclaimVerdict[];
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
    claimAtoms: { type: "array", items: { type: "string" } },
    claimAtomTypes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          verifiable: { type: "boolean" },
          type: {
            type: "string",
            enum: ["fact", "causal", "comparison", "concept", "value", "prediction", "normative", "personal"],
          },
        },
        required: ["text", "verifiable", "type"],
      },
    },
    stanceClaimType: {
      type: "object",
      additionalProperties: false,
      properties: {
        verifiable: { type: "boolean" },
        type: {
          type: "string",
          enum: ["fact", "causal", "comparison", "concept", "value", "prediction", "normative", "personal", "mixed"],
        },
        reason: { type: "string" },
      },
      required: ["verifiable", "type", "reason"],
    },
    rumorIndicators: { type: "array", items: { type: "string" } },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    analysis: { type: "string" },
    detectedPatterns: { type: "array", items: { type: "string" } },
  },
  required: ["claimAtoms", "claimAtomTypes", "stanceClaimType", "rumorIndicators", "severity", "analysis", "detectedPatterns"],
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

const subclaimVerdictsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      claimAtom: { type: "string" },
      verdict: { type: "string", enum: ["true", "false", "partial", "unverified", "exaggerated"] },
      evidence: { type: "string" },
      boundary: { type: "string" },
      // 判定可追溯：三个新字段不强制（兜底可为空数组），但结构明确
      supportingSources: { type: "array", items: verdictSourceSchema },
      contradictingSources: { type: "array", items: verdictSourceSchema },
      evidenceGaps: { type: "array", items: { type: "string" } },
    },
    required: ["claimAtom", "verdict", "evidence", "boundary"],
  },
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
    subclaimVerdicts: subclaimVerdictsSchema,
  },
  required: ["factCheckResult", "confidence", "sources", "keyFindings", "counterEvidence", "subclaimVerdicts"],
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
    subclaimVerdicts: subclaimVerdictsSchema,
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
    "subclaimVerdicts",
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
      "你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题（claimAtoms），再识别其中可能存在的谣言特征。",
      "",
      "原子命题的判定标准（拆分时严格遵循）：",
      "1. 每个原子命题必须是一个独立、可单独核查的判断——要么是某个个体/对象的性质，要么是两个个体/对象之间的关系。",
      "2. 每个 claimAtom 必须能回溯到原句，只能由用户提供的 claim 直接支持，不得引入原句未声称的信息、补全上下文或加入你自己的常识。",
      "3. 若原句含独立判断（如「药能治失眠」「药已获批准」），必须拆成多个原子命题，不得合并成一条。",
      "4. 拆分完成后，把 claimAtoms 拼接回读一遍，确认每条都能回溯到原句——不能回溯的删掉。",
      "",
      "【拆解忠实性硬约束 / 原句自证 — 强制】",
      "- 每个 claimAtom 必须能被原句直接支持；原句未声称的信息、补全的上下文、模型常识一律不得写入。",
      "- 拆解不得删除原句的限定条件（「某种情况下 X」不得拆成「X」）。",
      "- 不得产出无独立含义的碎片；能合并进同一判断的不要拆成多条。",
      "- 拆分完成后把 claimAtoms 拼接回读，逐条对照原句自证，不能自证的删掉。",
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
      "【可核查性判定 / claimAtomTypes 与 stanceClaimType — 强制】",
      "对每个 claimAtoms 原子，必须用 claimAtomTypes 逐条给出 verifiable（是否可核查）与 type（类型）。",
      "硬不可核查（verifiable=false，不进入事实核查范畴，只会被原位灰标标注为立场型，不订真/假）：",
      "- value 价值判断：对事物价值的评价（\"有意义/无意义\"\"好/坏\"\"应该/不应该\"）。示例如\"文科教育正在失去意义\"若指价值立场。",
      "- prediction 预测/未来命题：断言指向未来、无法用当前证据判定（\"未来三年就业会恶化\"）。",
      "- normative 规范命题：主张某人/某机构应当如何（\"政府应该禁止 X\"）。",
      "可核查（verifiable=true，正常进入逐命题定罪）：",
      "- fact 事实陈述、causal 因果推断、comparison 比较命题、concept 概念定义。",
      "",
      "灰度区判定规则（按断言形态，不硬性归集）：",
      "- 个人经验 personal：凡断言形态是\"某人/某群体 报告/声称 某种经验或反应\"，可核查（去查是否有这些报告），verifiable=true；凡属说话者第一人称主观体验或未经证实的普遍化主观判断，不可核查，verifiable=false。示例：\"大量患者报告服用 X 后出现失眠\"→可核查（查是否有这些报告）；\"这药对我失眠很有效\"→不可核查。注意：即使机制未知（可能是安慰剂效应），只要形态是\"患者报告了反应\"就可核查\"是否有报告\"，但绝不能核查为\"该反应是药理作用\"（那是 causal，另判）。",
      "- 概念定义 concept：凡断言是\"某个概念定义是什么、出自哪里、不同语境如何被使用\"，可核查（查定义出处、语境、不同解释），verifiable=true；凡断言是\"这个概念（根本）没有意义/不应该存在\"这类立场宣泄或规范判断，不可核查，verifiable=false。",
      "",
      "整句判定 stanceClaimType：对整条 claim 判 type、verifiable 与 reason。若整句为纯价值/预测/规范型说法，verifiable=false（报告顶部会标注\"立场型\"横幅），但仍会走完整核查流程，可核查部分照常定罪。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"claimAtoms\": [\"可核查原子命题1\", \"可核查原子命题2\"],\n  \"claimAtomTypes\": [\n    {\"text\": \"可核查原子命题1\", \"verifiable\": true, \"type\": \"fact\"},\n    {\"text\": \"可核查原子命题2\", \"verifiable\": false, \"type\": \"value\"}\n  ],\n  \"stanceClaimType\": {\"verifiable\": false, \"type\": \"value\", \"reason\": \"整句为价值判断，不适用于事实核查\"},\n  \"rumorIndicators\": [\"谣言特征1\", \"谣言特征2\"],\n  \"severity\": \"medium\",\n  \"analysis\": \"详细分析说明\",\n  \"detectedPatterns\": [\"匹配的模式1\", \"匹配的模式2\"]\n}",
      "",
      "severity 必须是 'low'、'medium'、'high' 之一。",
      "claimAtomTypes 的 text 必须与 claimAtoms 逐一对应；value/prediction/normative 的 verifiable 必须为 false，fact/causal/comparison/concept 的 verifiable 必须为 true。",
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
      "【Grounding 硬约束 / Plan P0-1 — 强制】",
      "1. 你必须优先采纳同行评审（peer-reviewed）或权威机构发布的证据；对单一来源、营销号或匿名信源保持批判态度。",
      "2. counterEvidence 数组必须包含至少 1 条反对意见或同行评审质疑；如果搜不到反证，必须在 keyFindings 里明确写出「暂无可靠反证」。",
      "3. 如果 claim 的核心事实无法找到任何可靠证据支持或反驳，必须把 factCheckResult 设为 unverified，并在 keyFindings 首句写「暂无可靠证据支持这一说法」。",
      "4. 禁止用「据传」「一般情况下」等模糊措辞替代具体来源；禁止编造来源、日期、专家名。",
      "",
      "confidence 判定标准：",
      "- high：有多个独立权威来源证实/证伪",
      "- medium：有部分证据，但不够充分或存在争议",
      "- low：证据稀少或来源单一",
      "",
      "【逐命题定罪 / subclaimVerdicts — 强制】",
      "1. subclaimVerdicts 必须覆盖输入 claimAtoms 中的每个原子命题，逐条给出 verdict。",
      "2. 每条 claimAtom 必须能回溯到原句，只能取输入 claimAtoms 中真实存在的原子，不得引入原句未声称的信息或编造不存在的原子。",
      "3. verdict 五值：true（证据支持）、false（证据否定）、partial（部分成立）、exaggerated（夸大/断章取义）、unverified（无法判定，待补证）。",
      "4. 每条必须写 evidence（证据）与 boundary（边界/不能推出的部分）。",
      "",
      "【逐条定罪来源绑定 / 判定可追溯 — 强制】",
      "1. 对每个 claimAtom，对应 item 的 supportingSources / contradictingSources 必须引用输入 search360.sources 中真实存在的来源，逐条给出 url / title / snippet 三项，不得编造不存在的 URL 或来源。",
      "2. 某来源若不在 search360.sources 中，不得写入；宁可留空数组，也不编造。",
      "3. item 的 url 必须能精确匹配到 search360.sources 中某个 url，title 与 snippet 取自该来源原文。",
      "4. evidenceGaps 列出该条定罪尚未找到的证据（如缺少官方 / 原始 / 权威来源），没有则给空数组。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"factCheckResult\": \"partial\",\n  \"confidence\": \"medium\",\n  \"sources\": [\"来源1\", \"来源2\"],\n  \"keyFindings\": [\"发现1\", \"发现2\"],\n  \"counterEvidence\": [\"反驳证据1\", \"反驳证据2\"],\n  \"subclaimVerdicts\": [\n    {\"claimAtom\": \"原子命题1\", \"verdict\": \"true\", \"evidence\": \"证据\", \"boundary\": \"边界\", \"supportingSources\": [{\"url\": \"https://example.com/a\", \"title\": \"来源标题\", \"snippet\": \"摘要\"}], \"contradictingSources\": [], \"evidenceGaps\": []},\n    {\"claimAtom\": \"原子命题2\", \"verdict\": \"unverified\", \"evidence\": \"\", \"boundary\": \"暂无可靠证据\", \"supportingSources\": [], \"contradictingSources\": [], \"evidenceGaps\": [\"缺少官方公告\"]}\n  ]\n}",
      "",
      "factCheckResult 必须是 'true'、'false'、'partial'、'unverified' 之一。",
      "confidence 必须是 'low'、'medium'、'high' 之一。",
      "subclaimVerdicts 的 verdict 必须是 'true'、'false'、'partial'、'unverified'、'exaggerated' 之一。",
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
      "【Grounding 硬约束 / Plan P0-1 — 强制】",
      "1. 优先评估信源是否经过同行评审、官方发布或多家独立媒体交叉验证；对单一渠道、自媒体、匿名爆料一律按 unverified 计入。",
      "2. verificationNotes 首句必须给出明确判断；如果确实找不到可靠来源，必须以「暂无可靠证据支持这一说法」开头。",
      "3. 禁止把可疑来源（营销号、匿名信源、AI 生成内容未署名）记入 verifiedSources；必须放进 questionableSources。",
      "4. missingSources 应主动列出关键缺口（原始数据、官方公告、原始论文 DOI 等），不要默认 placeholder。",
      "5. 禁止编造来源 URL、发布日期、机构署名；不在输入中出现的证据不得计入 verifiedSources。",
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
      "- factCheck.subclaimVerdicts：逐命题定罪清单（claimAtom/verdict/evidence/boundary）",
      "",
      "【逐命题定罪清单渲染 / subclaimVerdicts — 强制】",
      "把 subclaimVerdicts 作为报告的一部分渲染，逐条列出每个 claimAtom 的判定（verdict）、证据与边界，不得遗漏、不得编造输入中不存在的原子。",
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

function compactStrings(value: unknown, limit = 5, maxLength = 260): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, limit)
        .map((item) => (item.length > maxLength ? `${item.slice(0, maxLength)}…` : item))
    : [];
}

function compactText(value: unknown, maxLength = 420): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

// 统一原子键：全角空格规范化 + 截断到 maxLength（超长加省略号）。
// 自证闸门改写（去重/规范化）后，split/merge/claimItems 都复用同一键，保证键匹配一致，
// 消除"自证改写后 split 失配 → 立场原子漏网"的漂移风险。
// 与 compactStrings(claimAtoms, 6, 180) 对 claimAtom 的截断规则保持一致，避免超长原子失配。
export function claimAtomKey(value: string, maxLength = 180): string {
  const norm = value.replace(/\u3000/g, " ");
  return norm.length > maxLength ? `${norm.slice(0, maxLength)}…` : norm;
}

const SUBCLAIM_VERDICTS = ["true", "false", "partial", "unverified", "exaggerated"];

// 判定可追溯：per-verdict 来源结构清洗 + URL 幻觉拦截。
// searchSources 提供时（落库闸门/兜底），仅保留真实存在于搜索结果中的 URL，
// 编造的 URL 丢弃；未提供时只做结构清洗（透传，供 report_composer 渲染）。
function sanitizeVerdictSources(
  value: unknown,
  searchSources?: Array<{ url?: unknown }>
): VerdictSource[] {
  if (!Array.isArray(value)) return [];
  const knownUrls = searchSources
    ? new Set(searchSources.map((s) => String(s?.url ?? "").trim()).filter(Boolean))
    : null;
  const out: VerdictSource[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const rec = candidate as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!url) continue;
    if (knownUrls && !knownUrls.has(url)) continue; // URL 幻觉拦截
    out.push({
      url,
      title: typeof rec.title === "string" ? rec.title.slice(0, 200) : "",
      snippet: typeof rec.snippet === "string" ? rec.snippet.slice(0, 320) : "",
    });
  }
  return out.slice(0, 5);
}

function sanitizeEvidenceGaps(value: unknown): string[] {
  return compactStrings(value, 3, 120);
}

export function mergeSubclaimVerdicts(
  claimAtoms: unknown,
  verdicts: unknown,
  searchSources?: Array<{ url?: unknown }>
): SubclaimVerdict[] {
  const atoms = compactStrings(claimAtoms, 6, 180).map((s) => claimAtomKey(s));
  const raw = Array.isArray(verdicts) ? verdicts : [];
  const covered = new Set<string>();
  const result: SubclaimVerdict[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom : "";
    if (!atom) continue;
    const atomKey = claimAtomKey(atom);
    // 幻觉拦截：仅接受真实存在于输入 claimAtoms 中的原子，模型编造的原子不得进入报告
    if (!atoms.includes(atomKey)) continue;
    covered.add(atomKey);
    result.push({
      claimAtom: atom,
      verdict: (SUBCLAIM_VERDICTS.includes(String(rec.verdict)) ? String(rec.verdict) : "unverified") as SubclaimVerdict["verdict"],
      evidence: compactText(rec.evidence, 200),
      boundary: compactText(rec.boundary, 200),
      supportingSources: sanitizeVerdictSources(rec.supportingSources, searchSources),
      contradictingSources: sanitizeVerdictSources(rec.contradictingSources, searchSources),
      evidenceGaps: sanitizeEvidenceGaps(rec.evidenceGaps),
    });
  }
  for (const atom of atoms) {
    if (!covered.has(atom)) {
      result.push({
        claimAtom: atom,
        verdict: "unverified",
        evidence: "",
        boundary: "模型未覆盖，待补证",
        supportingSources: [],
        contradictingSources: [],
        evidenceGaps: [],
      });
    }
  }
  return result;
}

/**
 * 排除层：把 claimAtoms 按 claimAtomTypes 拆分为可核查 / 不可核查。
 * - 以 claimAtomTypes[i].text 与 claimAtoms 对齐（用与 mergeSubclaimVerdicts 相同的截断键保证不失配）；
 * - verifiable === false 的原子进 nonVerifiable，其余进 verifiable；
 * - 兜底：claimAtomTypes 缺失或某原子无对应条目时默认判为可核查（宁漏判，不误杀）。
 * - 纯确定性，不依赖模型二次判断；不变量：任何 verifiable=false 的原子绝不进入 verifiable。
 */
export function splitVerifiableAtoms(
  claimAtoms: unknown,
  claimAtomTypes: unknown
): { verifiable: string[]; nonVerifiable: Array<{ text: string; type: string }> } {
  const atoms = compactStrings(claimAtoms, 6, 180).map((s) => claimAtomKey(s));
  const typed = new Map<string, { verifiable: boolean; type: string }>();
  if (Array.isArray(claimAtomTypes)) {
    for (const item of claimAtomTypes) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === "string" ? rec.text : "";
      if (!text) continue;
      typed.set(claimAtomKey(text), {
        // 兜底：verifiable 缺失或非 false 一律视为可核查
        verifiable: rec.verifiable !== false,
        type: typeof rec.type === "string" ? rec.type.slice(0, 40) : "",
      });
    }
  }
  const verifiable: string[] = [];
  const nonVerifiable: Array<{ text: string; type: string }> = [];
  for (const atom of atoms) {
    const info = typed.get(atom);
    if (info && info.verifiable === false) {
      nonVerifiable.push({ text: atom, type: info.type });
    } else {
      verifiable.push(atom);
    }
  }
  return { verifiable, nonVerifiable };
}

// ───────────────────────────────────────────────────────────────
// 原句自证闸门（claim-atom self-proof gate）
// 校验 rumor_detector 拆出的 claimAtoms 是否忠实于原句，filter 掉
// 原句未声称 / 丢限定 / 无独立含义的碎片，再进入下游核查。
// ───────────────────────────────────────────────────────────────

export interface ClaimAtomDropped {
  text: string;
  reason: string;
}

// 确定性预过滤：去空、截断（与 mergeSubclaimVerdicts 同键）、规范化去重。
// 不做整句判别 / 语义去重（那是 LLM 自证的事）。
// 规范化：trim 首尾空白，把全角空格 U+3000 替换为普通空格；用规范化后的文本做去重键，保留原始文本。
export function prefilterClaimAtoms(
  claim: string,
  rawAtoms: unknown
): { atoms: string[]; dropped: ClaimAtomDropped[] } {
  void claim;
  const atoms: string[] = [];
  const dropped: ClaimAtomDropped[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawAtoms)) {
    for (const item of rawAtoms) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const normKey = claimAtomKey(trimmed);
      if (seen.has(normKey)) {
        dropped.push({ text: item, reason: "duplicate" });
        continue;
      }
      seen.add(normKey);
      // 写回规范化文本作 canonical 键，保证下游 merge/split 的键匹配一致（避免全角空格失配）
      atoms.push(normKey);
    }
  }
  return { atoms: atoms.slice(0, 6), dropped };
}

export const SELF_PROOF_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的原子命题自证校验器（原句自证闸门）。",
  "你的任务是对每条候选原子命题（claimAtom）逐条判断：它是否被原句（claim）直接支持，且作为独立可核查断言仍保有明确含义。",
  "判定标准（只有同时满足才 supported=true）：",
  "1. 原句直接支持：原子只能由原句直接支持，不得加入原句未声称的信息、不得补全上下文、不得注入模型常识。",
  "2. 独立含义：原子作为独立可核查断言仍保有明确含义——没有丢失原句的限定条件（如「某种情况下 X」不得拆成「X」）、不是截断到失去语义的碎片、也不与另一条被保留的原子冗余。",
  "3. 本闸门只判「忠实」（原句是否直接声称），不判「可核查性」。立场/价值/预测型原子若原句直接声称了该立场或断言，即使它本身不可核查，也应判 supported=true——是否可核查由后续排除层另行处置，不在本判断范围。",
  "输出严格 JSON（不要 Markdown，不要代码块）：{\n  \"results\": [\n    {\"atom\": \"原子文本\", \"supported\": true, \"reason\": \"判断依据\"}\n  ]\n}",
  "results 必须覆盖输入列出的每个原子；reason 用中文说明判断依据。",
].join("\n");

export const selfProofSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          atom: { type: "string" },
          supported: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["atom", "supported", "reason"],
      },
    },
  },
  required: ["results"],
};

export function buildSelfProofUserContent(claim: string, atoms: string[]): string {
  const lines = atoms.map((atom, i) => `${i + 1}. ${atom}`).join("\n");
  return [
    "原句（claim）：",
    claim,
    "",
    "待校验的候选原子命题（claimAtoms）：",
    lines,
    "",
    "请逐条判断每个原子是否被原句直接支持且保有独立含义，返回 results 数组。",
  ].join("\n");
}

// 解析 LLM 输出为 atom→supported 映射。fail-open：某原子在结果中缺失 → supported=true；
// 结果不可解析 / 非数组 → 返回所有原子都 supported=true 的映射。
export function parseSelfProofResults(atoms: string[], llmResults: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const atom of atoms) map.set(atom, true);
  if (llmResults && typeof llmResults === "object") {
    const results = (llmResults as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const atom = typeof rec.atom === "string" ? rec.atom : "";
        if (!atom) continue;
        const key = claimAtomKey(atom);
        if (map.has(key)) {
          map.set(key, rec.supported === true);
        }
      }
    }
  }
  return map;
}

function lookupSelfProofReason(atom: string, llmResults: unknown): string | undefined {
  if (llmResults && typeof llmResults === "object") {
    const results = (llmResults as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.atom === "string" && claimAtomKey(rec.atom) === atom) {
          return typeof rec.reason === "string" ? rec.reason : undefined;
        }
      }
    }
  }
  return undefined;
}

// 组合：先预过滤，再按 LLM 自证结果过滤 supported=false 的原子（进 dropped），
// supported=true 进 kept；kept 按输入顺序。fail-open 由 parseSelfProofResults 承担。
export function applySelfProof(
  claim: string,
  rawAtoms: unknown,
  llmResults: unknown
): { kept: string[]; dropped: ClaimAtomDropped[] } {
  const { atoms, dropped } = prefilterClaimAtoms(claim, rawAtoms);
  const supportedMap = parseSelfProofResults(atoms, llmResults);
  const kept: string[] = [];
  for (const atom of atoms) {
    if (supportedMap.get(atom) === true) {
      kept.push(atom);
    } else {
      dropped.push({ text: atom, reason: lookupSelfProofReason(atom, llmResults) ?? "unsupported" });
    }
  }
  return { kept, dropped };
}

// 完整网关：预过滤 → 批量单次 LLM 自证 → 按 supported 过滤。fail-open，绝不抛错、绝不误杀。
export async function runClaimAtomSelfProof(
  claim: string,
  rawAtoms: unknown,
  callModel: (input: {
    systemPrompt: string;
    userContent: string;
    responseSchema: object;
    maxTokens: number;
  }) => Promise<{ output: unknown; model: string }>
): Promise<{ kept: string[]; dropped: ClaimAtomDropped[]; model: string }> {
  const { atoms, dropped } = prefilterClaimAtoms(claim, rawAtoms);
  if (atoms.length === 0) {
    return { kept: [], dropped: [], model: "" };
  }
  try {
    const result = await callModel({
      systemPrompt: SELF_PROOF_SYSTEM_PROMPT,
      userContent: buildSelfProofUserContent(claim, atoms),
      responseSchema: selfProofSchema,
      maxTokens: 600,
    });
    const { kept, dropped: selfDropped } = applySelfProof(claim, atoms, result?.output);
    return { kept, dropped: [...dropped, ...selfDropped], model: result?.model ?? "" };
  } catch (error) {
    // fail-open：基础设施故障时保留全部原子，只保留确定性的 duplicate 丢弃信息
    return { kept: atoms, dropped, model: "" };
  }
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
        claimAtoms: prev?.output?.claimAtoms ?? [],
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
          subclaimVerdicts: mergeSubclaimVerdicts(rumorStep?.output?.claimAtoms, factStep?.output?.subclaimVerdicts),
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
