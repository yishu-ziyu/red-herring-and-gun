/**
 * eval/golden.ts — 生产评测基准数据。
 *
 * 这里是 casePipeline 评测的唯一 golden source of truth；客户端旧评测已关停，
 * 因此不再维护另一份需要同步的标准答案集。
 */

export interface ScoreCaseGolden {
  id: string;
  claim: string;
  category: "concept" | "causal" | "event" | "mixed";
  difficulty: "easy" | "medium" | "hard" | "trap";
  domain: string;
  expectedVerdictType: "true" | "false" | "mixed_misleading" | "unverified";
  expectedCredibilityRange: [number, number];
  traps: string[];
  /** 口语说法与官方口径词表错位，期望 evidenceLoop 补查被触发（ADR-004） */
  expectsEvidenceLoop?: boolean;
  /** 半真半假按条期望；缺省则不按条打分 */
  expectedAtoms?: ExpectedAtom[];
  /** 必须出现在 atomSearchBundle.atomsSearched；不读拆题 verifiable */
  mustSearch?: string[];
}

export type ExpectedAtomVerdict = "true" | "false" | "partial" | "unverified" | "exaggerated";

export interface ExpectedAtom {
  atom: string;
  expectedVerdict: ExpectedAtomVerdict;
  requireBoundUrl?: boolean;
}

export const goldenDataset: ScoreCaseGolden[] = [
  {
    id: "RUMOR-001",
    claim: "数字人民币平台正在发放数字资产红利",
    category: "event",
    difficulty: "medium",
    domain: "finance",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["冒用央行名义", "伪造官方来源"],
  },
  {
    id: "RUMOR-002",
    claim: "扫码可领2024年个人劳动补贴，逾期视为弃权",
    category: "event",
    difficulty: "medium",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["伪造官方小程序", "诈骗邮件"],
  },
  {
    id: "RUMOR-003",
    claim: "车票退票不再收手续费了",
    category: "event",
    difficulty: "easy",
    domain: "policy",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 20],
    traps: ["单次特例当普遍政策"],
  },
  {
    id: "RUMOR-004",
    claim: "京沪高速公路停止收费了",
    category: "event",
    difficulty: "medium",
    domain: "policy",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["拼接图片误导"],
  },
  {
    id: "RUMOR-005",
    claim: "点早安晚安图片手机会中毒，个人信息会被盗",
    category: "event",
    difficulty: "easy",
    domain: "tech",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 10],
    traps: ["陈年老谣", "恐惧话术"],
  },
  {
    id: "RUMOR-006",
    claim: "浙大研究发现：冷冻馒头不能吃，冷冻超过两天会长黄曲霉素",
    category: "causal",
    difficulty: "medium",
    domain: "health",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["误引权威名义", "混淆黄曲霉毒素产生条件"],
  },
  {
    id: "RUMOR-007",
    claim: "张华银，你的录取通知书丢了，爱心接力请转发",
    category: "event",
    difficulty: "easy",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 10],
    traps: ["旧谣新传", "爱心话术"],
  },
  {
    id: "RUMOR-008",
    claim: "中国体育代表团出征奥运会自带300多个空调和床垫",
    category: "event",
    difficulty: "hard",
    domain: "social",
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 30],
    traps: ["全队/个别层级混淆"],
  },
  {
    id: "RUMOR-009",
    claim: "春运抢票可提前90天预约",
    category: "event",
    difficulty: "easy",
    domain: "policy",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["第三方营销话术当官方规则"],
  },
  {
    id: "RUMOR-010",
    claim: "常穿黑色内衣易患癌",
    category: "causal",
    difficulty: "medium",
    domain: "health",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["颜色与致癌挂钩"],
  },
  {
    id: "RUMOR-011",
    claim: "每天喝红酒可以预防心脏病，因为法国人喝红酒且心脏病少",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 35],
    traps: ["相关≠因果", "混杂因素"],
    expectedAtoms: [
      { atom: "每天喝红酒可以预防心脏病", expectedVerdict: "false" },
      { atom: "法国人喝红酒且心脏病少", expectedVerdict: "true", requireBoundUrl: true },
    ],
  },
  {
    id: "RUMOR-012",
    claim: "孩子打疫苗后发烧，说明疫苗导致了自闭症",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["时序当因果", "轶事当证据"],
  },
  {
    id: "RUMOR-013",
    claim: "某地推广某保健品后癌症死亡率下降，证明该保健品能防癌",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 35],
    traps: ["生态谬误", "时序当疗效"],
  },
  {
    id: "RUMOR-014",
    claim: "医院里死亡率比家里高，所以去医院看病反而更危险",
    category: "causal",
    difficulty: "trap",
    domain: "health",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 15],
    traps: ["选择偏倚", "基率谬误"],
  },
  {
    id: "TINY-001",
    claim: "甘南宣布重要通知，甘南所有景点一律免费，6月17日起至7月31日免票",
    category: "event",
    difficulty: "easy",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["旅行社营销当官方政策"],
  },
  {
    id: "TINY-002",
    claim: "新疆喀什要建地铁，喀什市域1号线南延段前期研究已启动",
    category: "event",
    difficulty: "medium",
    domain: "policy",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["将/要就跳过", "把规划改写成已经通车"],
  },
  {
    id: "TINY-003",
    claim: "上海车展上演全武行，展台前有人打架",
    category: "event",
    difficulty: "medium",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["移花接木视频", "只查有没有人被罚"],
  },
  {
    id: "TINY-004",
    claim: "台风天上海LV巨轮旁边洪水滔滔，船体漏水了",
    category: "event",
    difficulty: "easy",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["历史素材嫁接", "合成视频当现场"],
  },
  {
    id: "TINY-005",
    claim: "群里那张P图配的侮辱性文字说的是真的",
    category: "event",
    difficulty: "hard",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 35],
    traps: ["查判刑不查流传说法", "太琐碎丢掉"],
  },
  {
    id: "TINY-006",
    claim: "短视频里说的某某婚内出轨是真的",
    category: "event",
    difficulty: "hard",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 35],
    traps: ["把处罚新闻当成出轨属实"],
  },
  {
    id: "TINY-007",
    claim: "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
    category: "event",
    difficulty: "easy",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["P图当现场", "太琐碎丢掉"],
  },
  // ── evidenceLoop 翻案案例（ADR-004）：口语说法与官方口径词表错位，
  // 第一轮按原子原文检索常未命中，需换官方来源词/原文语境补查 ──
  {
    id: "LOOP-001",
    claim: "听说电动车都被集中拉去国外销毁了，一批一批装船运走",
    category: "event",
    difficulty: "hard",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["口语「拉去销毁」≠官方「回收处置/以旧换新」", "词表错位一轮未命中"],
    expectsEvidenceLoop: true,
  },
  {
    id: "LOOP-002",
    claim: "网上那张公安局发的悬赏公告图片说是真的，扫码就能领线索费",
    category: "event",
    difficulty: "hard",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["合成公告", "「悬赏公告」口语检索未命中需换「警方通报」"],
    expectsEvidenceLoop: true,
  },
  {
    id: "LOOP-003",
    claim: "人社部发文说生育津贴直接打到个人卡里了，不用再走单位",
    category: "event",
    difficulty: "medium",
    domain: "policy",
    expectedVerdictType: "mixed_misleading",
    expectedCredibilityRange: [10, 35],
    traps: ["部分地方试点当全国政策", "「打到卡里」口语需换「生育津贴 直发」官方口径"],
    expectsEvidenceLoop: true,
  },
  {
    id: "EVAL-UNVERIFIED-001",
    claim: "同事群里说我们公司下周一会被收购，没有公告也没有监管披露",
    category: "event",
    difficulty: "hard",
    domain: "finance",
    expectedVerdictType: "unverified",
    expectedCredibilityRange: [10, 70],
    traps: ["没搜到不等于假", "无公开出处却写成能信或不能信"],
  },
  {
    id: "EVAL-TYPEGATE-001",
    claim: "隔夜菜会致癌",
    category: "causal",
    difficulty: "medium",
    domain: "health",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 25],
    traps: ["类型闸标成立场导致不检索"],
    mustSearch: ["隔夜菜会致癌"],
  },
];