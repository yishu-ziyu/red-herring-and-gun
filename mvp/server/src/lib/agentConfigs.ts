/**
 * agentConfigs.ts — Agent registry (prompts + schemas + handoff I/O).
 *
 * Claim-atom domain (key / merge / split / self-proof) lives in ./claimAtom.
 * This module re-exports domain symbols for backward-compatible imports.
 */

import {
  mergeSubclaimVerdicts,
  splitVerifiableAtoms,
  type ClaimAtomType,
  type SubclaimVerdict,
  type VerdictSource,
} from "./claimAtom/index.js";

export type { ClaimAtomType, SubclaimVerdict, VerdictSource };
export {
  claimAtomKey,
  mergeSubclaimVerdicts,
  splitVerifiableAtoms,
  prefilterClaimAtoms,
  parseSelfProofResults,
  applySelfProof,
  runClaimAtomSelfProof,
  SELF_PROOF_SYSTEM_PROMPT,
  selfProofSchema,
  buildSelfProofUserContent,
  type ClaimAtomDropped,
} from "./claimAtom/index.js";

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
      evidence: {
        type: "string",
        description:
          "Evidence prose for this atom. When supportingSources is non-empty, insert [n] after the claim it supports; n is 1-based and matches this item's supportingSources order (first source → [1]). No [n] when supportingSources is empty. Do not invent numbers outside that array.",
      },
      boundary: { type: "string" },
      crossExamResponse: { type: "string", description: "收到 crossExam 时，直接回应该命题的具体质询；未收到时省略。" },
      // 判定可追溯：三个新字段不强制（兜底可为空数组），但结构明确
      supportingSources: {
        type: "array",
        items: verdictSourceSchema,
        description:
          "Sources that support this atom, in citation order. evidence [n] maps to the n-th entry (1-based).",
      },
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
    conclusion: {
      type: "string",
      description:
        "Verdict prose. When the report has supporting web sources, insert [n] markers for claims that rely on them. n is 1-based global order: unique URLs from subclaimVerdicts.supportingSources in claim order (first-seen). No [n] without a matching source.",
    },
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
          evidence: {
            type: "string",
            description:
              "Layer evidence prose. When sourceRefs is non-empty, insert [n] for claims backed by those refs; n matches this layer's sourceRefs order (1-based). Prefer full URLs in sourceRefs.",
          },
          boundary: { type: "string" },
          sourceRefs: {
            type: "array",
            items: { type: "string" },
            description:
              "Citation list for this layer, preferably full http(s) URLs in the same order as [n] in evidence.",
          },
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

// 因果分支 schema（与前端 AGENT_CONFIGS 对齐；服务端为纯 schema，无 contract 包装）
const alternativeExplanationSearcherSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    alternativeExplanations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          hypothesis: { type: "string" },
          mechanism: { type: "string" },
          requiredAssumptions: { type: "array", items: { type: "string" } },
          compatibilityWithEvidence: { type: "string" },
          plausibility: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["hypothesis", "mechanism", "compatibilityWithEvidence", "plausibility"],
      },
    },
    conclusion: { type: "string" },
  },
  required: ["alternativeExplanations", "conclusion"],
};

const counterEvidenceGraderSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    counterEvidenceScore: { type: "number" },
    evidenceGapScore: { type: "number" },
    overallConfidenceAdjustment: { type: "number" },
    breakdown: {
      type: "object",
      additionalProperties: false,
      properties: {
        counterEvidenceStrength: { type: "string" },
        gapImpact: { type: "string" },
        causalInferenceStrength: { type: "string" },
      },
      required: ["counterEvidenceStrength", "gapImpact", "causalInferenceStrength"],
    },
    recommendation: { type: "string", enum: ["strengthen", "maintain", "weaken", "block"] },
  },
  required: [
    "counterEvidenceScore",
    "evidenceGapScore",
    "overallConfidenceAdjustment",
    "breakdown",
    "recommendation",
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
    maxTokens: 1000,
    systemPrompt: [
      "你是红鲱鱼与枪的 RumorDetector。",
      "先观察语言痕迹，拆出可验证命题，只记录证据需求，不凭常识补事实。",
      "你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题（claimAtoms），再识别其中可能存在的谣言特征。",
      "",
      "【流传短句 / 微博级谣言 — 强制】",
      "网传一句、群聊转述、截图配文、谁给谁打电话、某地免票、某地要建地铁、打架、P图、偷车至境外——只要原句作出了可核对的判断，就是可核查命题。",
      "不得因「太琐碎」「像八卦」「像个人纠纷」「没有大政策」把 verifiable 标 false，也不得整句丢掉。",
      "查的是流传句子是否属实，不是有没有人被处罚；警方处罚新闻仍对应一条待核的流传说法。",
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
      "- normative 规范命题：主张某人/某机构应当如何（\"政府应该禁止 X\"）。",
      "可核查（verifiable=true，正常进入逐条判定）：",
      "- fact 事实陈述、causal 因果推断、comparison 比较命题、concept 概念定义。",
      "",
      "灰度区判定规则（按断言形态，不硬性归集）：",
      "- 个人经验 personal：凡断言形态是\"某人/某群体 报告/声称 某种经验或反应\"，可核查（去查是否有这些报告），verifiable=true；凡属说话者第一人称主观体验或未经证实的普遍化主观判断，不可核查，verifiable=false。示例：\"大量患者报告服用 X 后出现失眠\"→可核查（查是否有这些报告）；\"这药对我失眠很有效\"→不可核查。注意：即使机制未知（可能是安慰剂效应），只要形态是\"患者报告了反应\"就可核查\"是否有报告\"，但绝不能核查为\"该反应是药理作用\"（那是 causal，另判）。",
      "- 概念定义 concept：凡断言是\"某个概念定义是什么、出自哪里、不同语境如何被使用\"，可核查（查定义出处、语境、不同解释），verifiable=true；凡断言是\"这个概念（根本）没有意义/不应该存在\"这类立场宣泄或规范判断，不可核查，verifiable=false。",
      "- 预测 prediction：先找现在能点开的出处，再标明出处撑不到哪。凡有公开承诺、正式文件、已发布预测、已经作出的决定、规划/批复/立项等现在时抓手，verifiable=true（去查抓手在不在；不能把未来写成已经发生）。示例：\"某公司未来三年营收将增长十倍\"→可核查（追有没有公开承诺）；\"某项政策已经正式确定并将立即实施\"→可核查（追有没有正式文件）；\"某地要建地铁\"→可核查（追有没有规划/批复，不要因为动词是「将/要」就跳过）。凡无现在时抓手、只是对世界的裸预测（\"未来三年就业会恶化\"），verifiable=false。不得把原子改写成「作出过承诺」等原句未声称的命题。",
      "",
      "整句判定 stanceClaimType：对整条 claim 判 type、verifiable 与 reason。若整句为纯价值/规范型说法，verifiable=false（报告顶部会标注\"立场型\"横幅），但仍会走完整核查流程，可核查部分照常判定。整句为预测时：有现在时抓手则 verifiable=true，不要因为动词是「将」就整句标立场型。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"claimAtoms\": [\"可核查原子命题1\", \"可核查原子命题2\"],\n  \"claimAtomTypes\": [\n    {\"text\": \"可核查原子命题1\", \"verifiable\": true, \"type\": \"fact\"},\n    {\"text\": \"可核查原子命题2\", \"verifiable\": false, \"type\": \"value\"}\n  ],\n  \"stanceClaimType\": {\"verifiable\": false, \"type\": \"value\", \"reason\": \"整句为价值判断，不适用于事实核查\"},\n  \"rumorIndicators\": [\"谣言特征1\", \"谣言特征2\"],\n  \"severity\": \"medium\",\n  \"analysis\": \"详细分析说明\",\n  \"detectedPatterns\": [\"匹配的模式1\", \"匹配的模式2\"]\n}",
      "",
      "severity 必须是 'low'、'medium'、'high' 之一。",
      "claimAtomTypes 的 text 必须与 claimAtoms 逐一对应；value/normative 的 verifiable 必须为 false；fact/causal/comparison/concept 的 verifiable 必须为 true；prediction/personal 按上方灰度规则，不得一律标 false。",
    ].join("\n"),
    responseSchema: rumorDetectorSchema,
  },
  {
    id: "fact_checker",
    name: "FactChecker",
    icon: "🔍",
    description: "事实核查",
    maxTokens: 1400,
    systemPrompt: [
      "你是红鲱鱼与枪的 FactChecker。",
      "每个判断都必须追到材料、反证或未解缺口，不把搜索摘要当最终事实。",
      "你的任务是基于 RumorDetector 检测到的谣言特征，对原始 claim 进行事实核查。",
      "如果输入包含 search360 字段，优先把其中的 answer、sources 和 relatedQuestions 当作搜索线索，但仍需区分搜索摘要与可核查事实。",
      "",
      "【Search-first — 强制】",
      "只根据输入里的 search360 / atomSearches、前序 Agent 输出和用户材料做事实核查。模型记忆不是核查。",
      "没有可点开的检索来源时，不得把 factCheckResult 写成 true 或 false；写 unverified。",
      "已有公开辟谣、涉事机构声明、警方通报或权威媒体时，必须把该 URL 写入 supportingSources 或 contradictingSources，不得只写流畅解释。",
      "无证据 ≠ 假。定向检索无结果 → unverified / 未能证实，禁止仅因没搜到就判 false。",
      "查的是流传句子是否属实，不是「后来有没有人被罚」。",
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
      "- 复合句（如「真观察 + 假因果」：某现象属实，但推出的结论不成立）必须给 partial，",
      "  不得因核心断言假就把整体写成 false——句子中属实的那部分仍然是属实的。",
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
      "【逐条判定 / subclaimVerdicts — 强制】",
      "1. subclaimVerdicts 必须覆盖输入 claimAtoms 中的每个原子命题，逐条给出 verdict。",
      "2. 每条 claimAtom 必须能回溯到原句，只能取输入 claimAtoms 中真实存在的原子，不得引入原句未声称的信息或编造不存在的原子。",
      "3. verdict 五值：true（证据支持）、false（证据否定）、partial（部分成立）、exaggerated（夸大/断章取义）、unverified（无法判定，待补证）。",
      "4. 每条必须写 evidence（证据）与 boundary（边界/不能推出的部分）。",
      "若输入含 crossExam，针对其中具体 challenge 在相应 subclaimVerdicts.crossExamResponse 中回应一次。使用本轮实际材料，可保留或修改原判词；必须仍输出所有命题。补查未运行或无新增时不得声称已补查成功，不按第二意见票数改结论。",
      "5. verdict 为 true / partial / exaggerated 时，supportingSources 必须给出真实 URL（来自该原子检索结果）；",
      "   给不出 URL 的不得判肯定值，改判 unverified 并在 evidenceGaps 写明待补证。",
      "",
      "【逐条判定来源绑定 / 判定可追溯 — 强制】",
      "1. 输入可能含 atomSearches：每项 { claimAtom, sources[] }，表示该原子定向检索结果。优先从对应 claimAtom 的 sources 中引用 supportingSources / contradictingSources。",
      "2. 若无 atomSearches，则回退到 search360.sources。url / title / snippet 必须来自输入中真实存在的来源，不得编造。",
      "3. 某来源若不在该原子 sources（或 search360.sources）中，不得写入；宁可留空数组，也不编造。",
      "4. evidenceGaps 列出该条尚未找到的证据；该原子检索为空时须在 boundary 或 evidenceGaps 写明未能证实/待补证，禁止仅因无结果就判 false。",
      "",
      "【预测原子 / 现在时抓手 — 强制】",
      "若某 claimAtom 指向未来（type 为 prediction，或断言含将/会/未来）：只核查当下能点开的出处——公开承诺、正式文件、已发布预测、已经作出的决定。",
      "有抓手：verdict 最多覆盖「说过 / 有文件」；boundary 必须写明不能推出未来一定发生。不得把「将发生」判成已经发生的 true/false。",
      "无抓手：verdict=unverified，禁止仅因尚未发生就判 false。不得把原子改写成「作出过承诺」等原句未声称的命题。",
      "",
      "【句内引用编号 / Inline citations — 强制】",
      "1. 当本条 supportingSources 非空时，evidence 必须在对应论断后插入 [n]；n 从 1 起，与本条 supportingSources 数组顺序一一对应（第 1 条 → [1]，第 2 条 → [2]）。",
      "2. 不得使用本条 supportingSources 长度之外的编号；禁止用 †、*、「见来源1」、脚注列表替代 [n]。",
      "3. supportingSources 为空时，evidence 不得出现任何 [n]。",
      "4. contradictingSources 不参与本条 evidence 的 [n] 编号。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"factCheckResult\": \"partial\",\n  \"confidence\": \"medium\",\n  \"sources\": [\"来源1\", \"来源2\"],\n  \"keyFindings\": [\"发现1\", \"发现2\"],\n  \"counterEvidence\": [\"反驳证据1\", \"反驳证据2\"],\n  \"subclaimVerdicts\": [\n    {\"claimAtom\": \"原子命题1\", \"verdict\": \"true\", \"evidence\": \"官方通报不支持该绝对化表述[1]。\", \"boundary\": \"边界\", \"supportingSources\": [{\"url\": \"https://example.com/a\", \"title\": \"来源标题\", \"snippet\": \"摘要\"}], \"contradictingSources\": [], \"evidenceGaps\": []},\n    {\"claimAtom\": \"原子命题2\", \"verdict\": \"unverified\", \"evidence\": \"\", \"boundary\": \"暂无可靠证据\", \"supportingSources\": [], \"contradictingSources\": [], \"evidenceGaps\": [\"缺少官方公告\"]}\n  ]\n}",
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
      "你是红鲱鱼与枪的 SourceValidator。",
      "先问来源是谁、是否原始、是否可追溯，再决定能不能进入证据链。",
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
      "你是红鲱鱼与枪的 ReportComposer。",
      "只写证据已经许可的判断，把证据、反证、缺口和不能推出的边界全部摆出来。",
      "你的任务是基于 RumorDetector、FactChecker 和 SourceValidator 的分析结果，生成一份综合核查报告。",
      "",
      "写作要求：",
      "用平实、准确的中文。不要阴阳怪气、口号、道德训诫。",
      "conclusion 第一句直接回答原问题（会不会、是不是、哪一层成立），不要用「能信 / 不能信 / 只能信一部分 / 还查不清」当第一句。那四个词是内部类型，只写在 verdictType：true / false / mixed_misleading / unverified。",
      "conclusion / summaryForPublic 按同一骨架写，一句一事，2–5 句：",
      "1. 直接回答：原句站不站得住、会不会发生、哪一层成立。有来源时带 [n]（引最强支撑或反证）。",
      "2. 对象：原句在断言什么。",
      "3. 材料：现有出处支持或反驳了什么，带 [n]。",
      "4. 边界：仍不能推出什么，或还缺哪条出处。",
      "先给答案，再给对象，再给材料，最后给边界。不要用「然而」「截至目前」「总的来说」起句。不要写建议用户做什么。不要写「我们检索了」。",
      "recommendation 只重复答案，不要写转不转、先别转发、行动建议，也不要盖「能信」四字章。",
      "用户看见的字只能来自输入里的检索来源和前序判定。模型记忆不是出处。",
      "用户看见的字禁止出现：FactChecker、ReportComposer、search360、Tavily、MiniMax、工具调用、Agent、智能体。只说判断、问题、出处。",
      "Prefer「不能支持 / 不足以确认 / 未见公开记录」over「纯属捏造 / 可笑 / 震惊」。",
      "来源里有具体数字、日期、数量时保留原值，不改写成「很多 / 大量 / 一些 / 不少」。",
      "禁止：阴阳怪气、口号体、作为AI自述、句内元标签、未出现在输入中的来源/日期/官员名。",
      "canSay / cannotSay 必须诚实分离；不得把 cannotSay 用语气包装成能信。",
      "",
      "输出前自检：",
      "1) 是否有无来源硬断言？2) cannotSay 是否被写成真？3) 是否有震惊体/嘲讽？4) 是否用导致/已经/证明却无机制与数据？5) 读者能否不靠信任作者就找到来源？不合格则改写后再输出。",
      "",
      "输入包含：",
      "- 原始 claim",
      "- RumorDetector 检测到的谣言特征和严重程度",
      "- FactChecker 的事实核查结果和关键发现",
      "- SourceValidator 的信源验证结果",
      "- 可选 search360 搜索摘要与来源",
      "- evidenceInputs：可放入证据链的搜索来源、反证、缺口和已审计来源",
      "- factCheck.subclaimVerdicts：逐条判定清单（claimAtom/verdict/evidence/boundary）",
      "",
      "【逐条判定清单渲染 / subclaimVerdicts — 强制】",
      "把 subclaimVerdicts 作为报告的一部分渲染，逐条列出每个 claimAtom 的判定（verdict）、证据与边界，不得遗漏、不得编造输入中不存在的原子。",
      "若输入 FactChecker 已给出 supportingSources / evidence 中的 [n]，应保留可点击来源，并保证本条 evidence 的 [n] 仍对本条 supportingSources 顺序有效。",
      "预测类原子：结论只能写现在能点开的出处撑到哪；不得把未来写成已经发生；没有公开承诺或正式文件时写还查不清，不写假。",
      "",
      "【句内引用编号 / Inline citations — 强制】",
      "1. 全局编号：按 subclaimVerdicts 顺序，对 supportingSources 的 URL 去重，首次出现依次为 [1][2]…；conclusion 中引用这些来源时必须用该全局编号。",
      "2. 逐条 evidence：本条 supportingSources 非空时，evidence 用本条局部编号 [1]…[k]（对本条数组顺序）；不要把全局编号误用到另一条的 supportingSources 上。",
      "3. evidenceChain 每层：sourceRefs 优先写完整 URL；该层 evidence 中的 [n] 与本层 sourceRefs 顺序一一对应。",
      "4. 无来源的句子不要插 [n]；禁止编造 URL 或编号；禁止用 Markdown 链接替代 [n]。",
      "",
      "证据链要求：",
      "1. evidenceChain 必须至少 3 层，按「原始命题/搜索来源/信源审计/反证或缺口/结论边界」组织。",
      "2. 每层必须写 finding、evidence、boundary；sourceRefs 只能引用输入里出现过的来源标题、URL、来源编号或 Agent 输出。",
      "3. 不要写调度过程空话；直接展示查到了什么、来自哪里、它能支持什么、不能推出什么。",
      "4. 如果搜索失败或来源不足，也要在 evidenceChain 中明确写出缺口，而不是省略证据链。",
      "5. verdictType 用 true/false/mixed_misleading/unverified；credibilityScore 表示原信息可信度，越高越可信。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"conclusion\": \"该说法部分成立：A 有公开记录支持[1]，B 仍无法证实。\",\n  \"credibilityScore\": 45,\n  \"credibilityLabel\": \"部分可信\",\n  \"recommendation\": \"给用户的行动建议\",\n  \"summaryForPublic\": \"面向公众的简化版结论（1-2 句话）\",\n  \"subclaimVerdicts\": [\n    {\"claimAtom\": \"原子A\", \"verdict\": \"true\", \"evidence\": \"公开记录支持该点[1]。\", \"boundary\": \"不能推出全局\", \"supportingSources\": [{\"url\": \"https://example.com/a\", \"title\": \"来源A\", \"snippet\": \"摘要\"}], \"contradictingSources\": [], \"evidenceGaps\": []}\n  ],\n  \"evidenceChain\": [\n    {\"layer\": \"搜索来源\", \"finding\": \"找到公开记录\", \"evidence\": \"材料支持原子A[1]。\", \"boundary\": \"不能推出B\", \"sourceRefs\": [\"https://example.com/a\"]}\n  ],\n  \"confidenceDimensions\": [\n    {\"dimension\": \"source_reliability\", \"label\": \"来源可靠性\", \"score\": 62, \"threshold\": 70, \"passed\": false, \"reason\": \"有部分来源但权威性不足\"},\n    {\"dimension\": \"evidence_completeness\", \"label\": \"证据完整度\", \"score\": 58, \"threshold\": 60, \"passed\": false, \"reason\": \"仍缺少原始材料\"},\n    {\"dimension\": \"consistency\", \"label\": \"逻辑一致性\", \"score\": 75, \"threshold\": 75, \"passed\": true, \"reason\": \"结论与前序 Agent 输出一致\"},\n    {\"dimension\": \"recency\", \"label\": \"信息时效性\", \"score\": 55, \"threshold\": 50, \"passed\": true, \"reason\": \"搜索线索可用于近期核查\"},\n    {\"dimension\": \"authority\", \"label\": \"权威匹配度\", \"score\": 60, \"threshold\": 65, \"passed\": false, \"reason\": \"尚需更权威来源确认\"}\n  ]\n}",
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
  {
    id: "alternative_explanation_searcher",
    name: "AlternativeExplanationSearcher",
    icon: "🔎",
    description: "替代解释搜索",
    maxTokens: 900,
    systemPrompt: [
      "你是红鲱鱼与枪的 AlternativeExplanationSearcher。",
      "不否定现有证据，但主动寻找其他同样能解释观察结果的因果链。",
      "你的任务是针对当前 claim 的因果断言，生成 2-4 条合理的替代解释。",
      "每条替代解释必须：说明它能如何解释观察到的现象、指出它需要的额外前提、评估它与现有证据的兼容度。",
      "不得捏造不存在的证据来支持替代解释；替代解释的价值在于它的逻辑合理性，不在于它已被证明。",
      "如果找不到合理的替代解释，明确说明为什么现有因果链目前没有有力的竞争者。",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"alternativeExplanations\": [\n    {\n      \"hypothesis\": \"替代解释概述\",\n      \"mechanism\": \"如何解释观察现象\",\n      \"requiredAssumptions\": [\"前提1\"],\n      \"compatibilityWithEvidence\": \"与现有证据的兼容程度\",\n      \"plausibility\": \"high/medium/low\"\n    }\n  ],\n  \"conclusion\": \"综合评估：当前因果链是否排他\"\n}",
      "alternativeExplanations 数组每项 2-4 条；plausibility 必须是 'high'、'medium' 或 'low'。",
    ].join("\n"),
    responseSchema: alternativeExplanationSearcherSchema,
  },
  {
    id: "counter_evidence_grader",
    name: "CounterEvidenceGrader",
    icon: "⚖️",
    description: "反证评分",
    maxTokens: 800,
    systemPrompt: [
      "你是红鲱鱼与枪的 CounterEvidenceGrader。",
      "不预设立场，只评估现有证据对当前结论的支持度和反证力度。",
      "你的任务是评估 FactChecker 和搜索结果的证据强度，对反证和证据缺口做降权评分。",
      "",
      "评估维度：",
      "1. 反证强度 — 反证的数量、质量和来源权威性",
      "2. 证据缺口 — 缺少哪些关键证据，这些缺口对结论的影响",
      "3. 因果推断强度 — 现有证据是支持因果还是仅支持相关",
      "4. 结论稳健性 — 如果新增证据，结论有多大可能改变",
      "",
      "输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：",
      "{\n  \"counterEvidenceScore\": -25,\n  \"evidenceGapScore\": -15,\n  \"overallConfidenceAdjustment\": -18,\n  \"breakdown\": {\n    \"counterEvidenceStrength\": \"评估说明\",\n    \"gapImpact\": \"缺口影响说明\",\n    \"causalInferenceStrength\": \"因果推断强度说明\"\n  },\n  \"recommendation\": \"建议的结论表达强度\"\n}",
      "overallConfidenceAdjustment 是 -100 到 +20 的整数，负数表示反证/缺口需要降权。",
      "recommendation 必须是 'strengthen'、'maintain'、'weaken' 或 'block' 之一。",
    ].join("\n"),
    responseSchema: counterEvidenceGraderSchema,
  },
];

// ───────────────────────────────────────────────────────────────
// 工具函数（registry only；claim-atom domain → ./claimAtom）
// ───────────────────────────────────────────────────────────────

export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_CONFIGS.find((a) => a.id === id);
}

/** Compact string arrays for handoff I/O (limit count + max length). */
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
      const crossExam = [...previousSteps].reverse().find((s) => s.agent === "cross_examiner");
      return {
        claim,
        task: "对该 claim 进行事实核查",
        ...(crossExam ? { crossExam: crossExam.output, previousFactCheck: [...previousSteps].reverse().find(s => s.agent === "fact_checker")?.output } : {}),
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

    // Causal enrichment agents (input builders ready; configs may land later on server)
    case "alternative_explanation_searcher": {
      const rumorStep = previousSteps.find((s) => s.agent === "rumor_detector");
      const factStep = [...previousSteps].reverse().find((s) => s.agent === "fact_checker");
      return {
        claim,
        task: "为当前因果断言生成替代解释",
        claimAtoms: rumorStep?.output?.claimAtoms ?? [],
        factCheckResult: factStep?.output?.factCheckResult,
        supportingEvidence: compactStrings(factStep?.output?.supportingEvidence, 4, 200),
        contradictingSources: compactStrings(factStep?.output?.contradictingSources, 4, 200),
      };
    }

    case "counter_evidence_grader": {
      const factStep = [...previousSteps].reverse().find((s) => s.agent === "fact_checker");
      return {
        claim,
        task: "评估反证和证据缺口对结论的影响",
        factCheckResult: factStep?.output?.factCheckResult,
        confidence: factStep?.output?.confidence,
        counterEvidence: compactStrings(factStep?.output?.counterEvidence, 5, 200),
        unresolvedEvidenceGaps: compactStrings(factStep?.output?.unresolvedEvidenceGaps, 4, 200),
        contradictingSources: compactStrings(factStep?.output?.contradictingSources, 4, 200),
      };
    }

    case "report_composer": {
      const rumorStep = previousSteps.find((s) => s.agent === "rumor_detector");
      const factStep = [...previousSteps].reverse().find((s) => s.agent === "fact_checker");
      const sourceStep = previousSteps.find((s) => s.agent === "source_validator");
      const altStep = previousSteps.find((s) => s.agent === "alternative_explanation_searcher");
      const graderStep = previousSteps.find((s) => s.agent === "counter_evidence_grader");
      return {
        claim,
        task: "生成综合核查报告",
        crossExam: [...previousSteps].reverse().find(s => s.agent === "cross_examiner")?.output,
        rumorAnalysis: {
          claimAtoms: compactStrings(rumorStep?.output?.claimAtoms, 12, 180),
          rumorTypes: compactStrings(rumorStep?.output?.rumorTypes, 4, 80),
          indicators: compactStrings(rumorStep?.output?.rumorIndicators, 5, 120),
          severity: rumorStep?.output?.severity ?? "low",
          analysis: compactText(rumorStep?.output?.analysis, 360),
          neededEvidence: compactStrings(rumorStep?.output?.neededEvidence, 5, 180),
        },
        factCheck: {
          result: factStep?.output?.factCheckResult ?? "unverified",
          confidence: factStep?.output?.confidence ?? "low",
          subclaimVerdicts: (() => {
            const split = splitVerifiableAtoms(
              rumorStep?.output?.claimAtoms,
              rumorStep?.output?.claimAtomTypes
            );
            return mergeSubclaimVerdicts(split.verifiable, factStep?.output?.subclaimVerdicts);
          })(),
          sources: compactStrings(factStep?.output?.sources, 6, 160),
          supportingEvidence: compactStrings(factStep?.output?.supportingEvidence, 4, 240),
          contradictingSources: compactStrings(factStep?.output?.contradictingSources, 5, 160),
          keyFindings: compactStrings(factStep?.output?.keyFindings, 5, 260),
          counterEvidence: compactStrings(factStep?.output?.counterEvidence, 5, 240),
          unresolvedEvidenceGaps: compactStrings(factStep?.output?.unresolvedEvidenceGaps, 4, 240),
          logicRisks: compactStrings(factStep?.output?.logicRisks, 4, 180),
        },
        sourceValidation: {
          reliability: sourceStep?.output?.sourceReliability ?? "unverified",
          verifiedSources: compactStrings(sourceStep?.output?.verifiedSources, 4, 220),
          questionableSources: compactStrings(sourceStep?.output?.questionableSources, 4, 220),
          missingSources: compactStrings(sourceStep?.output?.missingSources, 4, 220),
          verificationNotes: compactText(sourceStep?.output?.verificationNotes, 420),
        },
        // 因果分支：仅当 causal agent 已运行时注入其输出，供 ReportComposer 权衡替代解释与反证
        causalAnalysis: altStep?.output?.alternativeExplanations
          ? {
              alternativeExplanations: Array.isArray(altStep.output.alternativeExplanations)
                ? altStep.output.alternativeExplanations.slice(0, 4)
                : [],
              conclusion:
                typeof altStep.output.conclusion === "string"
                  ? altStep.output.conclusion.slice(0, 400)
                  : "",
            }
          : undefined,
        counterEvidenceAssessment: graderStep?.output
          ? {
              counterEvidenceScore: graderStep.output.counterEvidenceScore,
              evidenceGapScore: graderStep.output.evidenceGapScore,
              overallConfidenceAdjustment: graderStep.output.overallConfidenceAdjustment,
              breakdown: graderStep.output.breakdown,
              recommendation: graderStep.output.recommendation,
            }
          : undefined,
      };
    }

    default:
      return { claim };
  }
}
