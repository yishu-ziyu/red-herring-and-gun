/**
 * evaluation/goldenDataset.ts
 *
 * Golden cases for AgentRuntime benchmarking.
 * Each case specifies: claim, expected routing, expected verdict,
 * golden rationale, difficulty, domain, and known failure traps.
 *
 * This is the product's source of truth for "what correct looks like."
 * Must be readable by domain experts, not just engineers.
 *
 * NOTE: These cases are REAL rumors with official fact-check conclusions,
 * sourced from 贵州辟谣《2024年度朋友圈热度谣言》
 * (http://m.toutiao.com/group/7454156788359774720/),
 * backed by 人民日报 / 人社部 / 人民网 / 中国互联网辟谣平台 / 新华社 etc.
 * The verdict/credibility fields are our product's expected mapping of the
 * official conclusion; the official sources only state true/false.
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
  // ── Real rumors, official fact-check conclusions ────────────

  {
    id: "RUMOR-001",
    claim: "数字人民币平台正在发放数字资产红利",
    category: "event",
    difficulty: "medium",
    domain: "finance",
    description: "冒充央行数字货币研究所名义的虚假公告，涉及数字资产红利发放",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "所谓'公告'和'平台'系不法分子冒用中国人民银行数字货币研究所名义伪造，该所从未发布此类信息，也未曾组织任何数字资产登记、认购或发放所谓'数字资产红利'。应判定为完全虚假。",
    traps: ["把'经国家审批'等看似权威的措辞当作可信证据", "把伪造的官方名义当成官方来源", "不核实是否真的在央行官方渠道发布"],
  },
  {
    id: "RUMOR-002",
    claim: "扫码可领2024年个人劳动补贴，逾期视为弃权",
    category: "event",
    difficulty: "medium",
    domain: "social",
    description: "伪造官方小程序实施诈骗的邮件，诱导扫码领取不存在的补贴",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "人社部官方从未发放过'个人劳动补贴'，此类邮件系不法分子伪造官方小程序实施的诈骗，信息来源伪造，应判定为虚假。",
    traps: ["看见'官方小程序'字样就采信", "把诈骗邮件当成官方通知", "不验证二维码对应的真实域名与官方渠道"],
  },
  {
    id: "RUMOR-003",
    claim: "车票退票不再收手续费了",
    category: "event",
    difficulty: "easy",
    domain: "policy",
    description: "网络流传的退票规则变化，实际无新规出台",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 20],
    goldenRationale: "官方明确退票手续费仍按现行退票费标准执行，目前没有新规出台。'开车前10分钟退票未扣费'属单次特例或误传，不代表政策变化。",
    traps: ["把单次特例当成普遍政策", "不查证官方现行退票规则", "把'某次不扣费'与'新规'混淆"],
  },
  {
    id: "RUMOR-004",
    claim: "京沪高速公路停止收费了",
    category: "event",
    difficulty: "medium",
    domain: "policy",
    description: "以拼接图片虚构的高速停止收费消息",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "京沪高速公路并未停止收费，该消息配图实为广州北环高速公路停止收费新闻图片的编辑剪裁，属虚构事实，应判定为虚假。",
    traps: ["被拼接图片误导", "把个别路段停止收费推广到所有高速", "不经官方核实就采信图片"],
  },
  {
    id: "RUMOR-005",
    claim: "点早安晚安图片手机会中毒，个人信息会被盗",
    category: "event",
    difficulty: "easy",
    domain: "tech",
    description: "流传多年的技术类老谣言，图片本身不会导致中毒",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 10],
    goldenRationale: "这是流传多年的陈年老谣言，接收图片本身不会导致手机中毒或个人信息被盗，多地网信、网警部门已多次辟谣，应判定为虚假。",
    traps: ["把涉警警告当作可信安全提示", "被'个人信息被盗'的恐惧话术影响", "不查证是否已有官方辟谣记录"],
  },
  {
    id: "RUMOR-006",
    claim: "浙大研究发现：冷冻馒头不能吃，冷冻超过两天会长黄曲霉素",
    category: "causal",
    difficulty: "medium",
    domain: "health",
    description: "误引权威机构研究名义的健康因果谣言",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "浙江大学从未做过'冷冻馒头产生黄曲霉毒素'的研究，正常冷冻保存面食并短期食用是安全的。该说法误引权威机构名义，属虚假，应判定为 false。",
    traps: ["把'某某高校研究'当作权威背书", "混淆黄曲霉毒素的产生条件（需特定温湿度）", "不核实研究是否真实存在"],
  },
  {
    id: "RUMOR-007",
    claim: "张华银，你的录取通知书丢了，爱心接力请转发",
    category: "event",
    difficulty: "easy",
    domain: "social",
    description: "旧谣新传的失物寻人转发，同文案多省市反复出现",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 10],
    goldenRationale: "该谣言样本2022年已出现，考生姓名、文案一字不差，在浙江、湖北等多地反复传播且均被辟谣，属'旧谣新传'，应判定为虚假。",
    traps: ["把'爱心接力'话术当作可信倡议", "忽视同文案多地名复现的传播模式", "不搜索历史辟谣记录"],
  },
  {
    id: "RUMOR-008",
    claim: "中国体育代表团出征奥运会自带300多个空调和床垫",
    category: "event",
    difficulty: "hard",
    domain: "social",
    description: "部分属实的社会事件，需区分'全队自带'与'个别自备'的层级差异",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 30],
    goldenRationale: "官方回应：奥运村楼房由组委会统一分配，可提供移动空调租赁，代表团未自带空调；但个别运动员或工作人员因睡眠习惯自备床垫。'全队自带空调和床垫'属夸大，应判定为部分属实而非全假。",
    traps: ["把'个别自备床垫'全盘否定为假", "把'可租空调'说成'自带空调'", "不区分'全队'与'个别'的层级差异"],
  },
  {
    id: "RUMOR-009",
    claim: "春运抢票可提前90天预约",
    category: "event",
    difficulty: "easy",
    domain: "policy",
    description: "第三方平台营销话术，非官方发售规则",
    expectedClaimType: "event",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "铁路官方从未授权第三方平台发售火车票，春运火车票按提前15天发售。'可提前90天预约'是第三方平台营销话术，非官方规定，应判定为虚假。",
    traps: ["把第三方平台宣传当成官方规则", "不区分'预约'与'发售'", "忽视官方授权渠道的声明"],
  },
  {
    id: "RUMOR-010",
    claim: "常穿黑色内衣易患癌",
    category: "causal",
    difficulty: "medium",
    domain: "health",
    description: "把颜色与致癌直接挂钩的健康因果谣言",
    expectedClaimType: "causal",
    expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "alternative_explanation_searcher", "counter_evidence_grader", "report_composer"],
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    goldenRationale: "黑色是纺织服装产品最常见的颜色之一，符合《国家纺织产品基本安全技术规范》A/B类要求的织物均可安全穿着。'常穿黑色内衣易患癌'无科学依据，应判定为虚假。",
    traps: ["把'颜色'与'致癌'直接挂钩", "忽视国标对直接接触皮肤产品的安全要求", "把偶发案例或传闻当普遍结论"],
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