/**
 * evaluation/goldenDataset.ts
 *
 * Golden cases for AgentRuntime benchmarking.
 * Each case specifies: claim, expected routing, expected verdict,
 * golden rationale, difficulty, domain, and known failure traps.
 *
 * This is the product's source of truth for "what correct looks like."
 * Must be readable by domain experts, not just engineers.
 */

export type ClaimCategory = "concept" | "causal" | "event" | "mixed";
export type Difficulty = "easy" | "medium" | "hard" | "trap";
export type Domain = "health" | "science" | "politics" | "tech" | "finance" | "social" | "policy";

export interface GoldenCase {
  id: string;
  claim: string;
  category: ClaimCategory;
  difficulty: Difficulty;
  domain: Domain;
  description: string;

  // Expected execution
  expectedClaimType: ClaimCategory;
  expectedAgentSequence: string[];

  // Expected report output
  expectedVerdictType: "true" | "false" | "mixed_misleading" | "unverified";
  expectedCredibilityRange: [number, number];

  // Quality bar
  goldenRationale: string;
  traps: string[];
}

export const goldenDataset: GoldenCase[] = [
  // ── Concept claims ──────────────────────────────────────────

  {
    id: "CONCEPT-001",
    claim: "什么是量子纠缠",
    category: "concept",
    difficulty: "easy",
    domain: "science",
    description: "纯粹的物理概念解释，无事实核查必要",
    expectedClaimType: "concept",
    expectedAgentSequence: ["report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [40, 70],
    goldenRationale: "概念解释任务，直接进行语义边界和语境映射。不应进入事实搜证流水线。",
    traps: ["错误地触发 rumor_detector", "试图'验证'一个概念定义"],
  },
  {
    id: "CONCEPT-002",
    claim: "如何理解通货膨胀",
    category: "concept",
    difficulty: "easy",
    domain: "finance",
    description: "经济学概念，可能涉及不同学派的定义差异",
    expectedClaimType: "concept",
    expectedAgentSequence: ["report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [40, 70],
    goldenRationale: "经济学核心概念，需解释不同语境下的定义差异。不应判定真假。",
    traps: ["试图验证某个通胀率'对不对'", "把概念解释变成事实核查"],
  },
  {
    id: "CONCEPT-003",
    claim: "人工智能的定义是什么",
    category: "concept",
    difficulty: "medium",
    domain: "tech",
    description: "概念有多个定义层次（技术/哲学/商业）",
    expectedClaimType: "concept",
    expectedAgentSequence: ["report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [40, 70],
    goldenRationale: "AI 定义因视角而异（图灵测试、机器学习、AGI），需呈现定义光谱而非判定真假。",
    traps: ["只给一个定义并声称是'正确的'", "触发事实核查搜索"],
  },

  // ── Event claims ────────────────────────────────────────────

  {
    id: "EVENT-001",
    claim: "网传某地发生食品安全事件",
    category: "event",
    difficulty: "medium",
    domain: "social",
    description: "网络流传的食品安全事件，需要核查是否真实发生",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [20, 50],
    goldenRationale: "食品安全事件需要权威来源确认。无具体时间地点，信息不足时判定为 unverified。",
    traps: ["未核实就判定为 true", "忽略来源验证", "把搜索摘要当成事实"],
  },
  {
    id: "EVENT-002",
    claim: "某公司宣布发布新一代芯片",
    category: "event",
    difficulty: "easy",
    domain: "tech",
    description: "公司公告类事件，可通过官方渠道核实",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [40, 70],
    goldenRationale: "公司公告可通过官网/新闻稿核实。信息源充分时应可验证。",
    traps: ["未区分官方发布和媒体转述", "忽略发布时间", "来源可靠性判断错误"],
  },
  {
    id: "EVENT-003",
    claim: "报道称某城市将建设新的地铁线路",
    category: "event",
    difficulty: "medium",
    domain: "policy",
    description: "政府规划类报道，需区分规划阶段和正式批准",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [30, 60],
    goldenRationale: "新闻报道 ≠ 已批准。需核实政府部门的正式批复。不能把媒体报道等同于事实。",
    traps: ["把媒体报道当成已确认事实", "混淆规划提案和正式批准", "忽略信源层级"],
  },

  // ── Causal claims ───────────────────────────────────────────

  {
    id: "CAUSAL-001",
    claim: "喝咖啡会导致癌症",
    category: "causal",
    difficulty: "hard",
    domain: "health",
    description: "强因果断言，需要替代解释和反证评估",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 30],
    goldenRationale: "强因果断言。观察性研究不能证明因果。需要替代解释（遗传因素、生活方式混杂）和反证评分。结论应降级表达。",
    traps: ["把相关性当成因果", "忽略 IARC 分级 nuance（Group 2A = probably carcinogenic）", "不做替代解释就下结论"],
  },
  {
    id: "CAUSAL-002",
    claim: "使用手机会导致脑瘤",
    category: "causal",
    difficulty: "hard",
    domain: "health",
    description: "因果断言，大量研究但结论不一致",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [20, 40],
    goldenRationale: "手机辐射与脑瘤的关系是长期争议。流行病学研究结果不一致，替代解释（检测偏倚）需要评估。",
    traps: ["忽视研究类型差异（病例对照 vs 队列 vs 动物实验）", "把'可能'当成'确定'", "不做反证评估"],
  },
  {
    id: "CAUSAL-003",
    claim: "某政策出台导致房价下跌",
    category: "causal",
    difficulty: "hard",
    domain: "finance",
    description: "经济政策因果归因，需要排除其他因素",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [15, 35],
    goldenRationale: "房价受多因素影响（利率、经济周期、供需）。单一政策归因需排除替代解释。",
    traps: ["把时间先后当成因果", "忽略同期其他经济因素", "把局部市场表现推广到全国"],
  },

  // ── Mixed claims ────────────────────────────────────────────

  {
    id: "MIXED-001",
    claim: "某保健品说吃了能降血压，这究竟是科学还是营销话术",
    category: "mixed",
    difficulty: "medium",
    domain: "health",
    description: "混合了事实核查（能不能降）和概念判断（科学 vs 营销）",
    expectedClaimType: "mixed",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [15, 35],
    goldenRationale: "保健品降血压声明需事实核查，同时需要判断是否有夸大营销。可能部分成分有研究支持但剂量/效果被夸大。",
    traps: ["只做概念分析忽略事实核查", "全盘否定或全盘接受", "混淆保健品和药品监管标准"],
  },
  {
    id: "MIXED-002",
    claim: "网传某名人在海外去世，这个消息是真的吗",
    category: "mixed",
    difficulty: "easy",
    domain: "social",
    description: "社会事件 + 人物状态（需绕过常识偏见）",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [5, 20],
    goldenRationale: "人物状态类信息易被模型常识影响。需依赖搜索验证，不得用模型记忆判断。",
    traps: ["模型用自己的训练数据'知道'答案", "不搜索就给出真假判断", "把谣言特征当成事实"],
  },

  // ── Trap cases (designed to catch common failure modes) ────

  {
    id: "TRAP-001",
    claim: "研究表明某食物成分能抗癌",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    description: "典型的观察性研究被误读为因果",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 25],
    goldenRationale: "体外实验/动物实验/观察性研究 ≠ 人体抗癌效果。这是健康谣言最高频的偷换模式。",
    traps: ["把体外实验当人体证据", "把相关性当因果", "忽略剂量/浓度现实", "旧研究当最新结论"],
  },
  {
    id: "TRAP-002",
    claim: "喝红酒软化血管，每天一杯有益心脏",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    description: "被广泛传播但有因果错误的健康建议",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 30],
    goldenRationale: "红酒软化血管是长期传播的错误关联。即使有相关性，也需排除替代解释（生活方式、社会经济因素）。",
    traps: ["接受'适量饮酒有益'的默认叙事", "不寻找反证", "混淆关联和因果", "忽略酒精的其他健康风险"],
  },
  {
    id: "TRAP-003",
    claim: "5G 基站会导致新冠传播",
    category: "causal",
    difficulty: "trap",
    domain: "social",
    description: "阴谋论式因果断言，完全缺乏科学依据",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 10],
    goldenRationale: "病毒传播与无线电波无任何已知物理机制。应判定为 false，不应给过多'平衡空间'。",
    traps: ["对阴谋论过度'平衡'", "花费过多资源搜索不存在的关系", "在 false 和 unverified 之间摇摆"],
  },
];

/** Get a case by ID */
export function getCase(id: string): GoldenCase | undefined {
  return goldenDataset.find((c) => c.id === id);
}

/** Get cases by category */
export function getCasesByCategory(category: ClaimCategory): GoldenCase[] {
  return goldenDataset.filter((c) => c.category === category);
}

/** Get cases by difficulty */
export function getCasesByDifficulty(difficulty: Difficulty): GoldenCase[] {
  return goldenDataset.filter((c) => c.difficulty === difficulty);
}
