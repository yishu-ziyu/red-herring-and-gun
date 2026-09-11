/*
 * 原型内容：与 mvp/src/goldenPath/devFixture.ts 同一题材、同一口径。
 * 数字、出处、摘录都是示意，但形状与 InvestigationSnapshotV1 一致：
 * 命题 / 证据关系 / 争点双方 / 缺口 / 追索记录。
 * 不出现实现层词汇。
 */
window.RHG_DATA = {
  originalClaim: "隔夜菜会致癌，吃了等于吃毒药。",
  meta: "命题 2 条 · 来源 5 条 · 今天 09:30 完成",

  contextClaim: {
    num: "01",
    text: "隔夜菜会直接致癌",
    chip: "证据反驳",
    chipTone: "negative",
  },

  claim: {
    num: "02",
    text: "隔夜菜会产生大量有害物质，等于吃毒药",
    chip: "有对有错",
    chipTone: "mixed",
    boundary: "即使证据充分，也不能推出「只要冷藏过就一定安全」——冷藏超过三天或反复回热仍是另一回事。",
  },

  sources: {
    cdc: {
      id: "cdc",
      title: "疾控中心：家庭食品储存与致病菌预防",
      domain: "cdc.example.cn",
      url: "https://cdc.example.cn/storage-safety",
      excerpt: "不当储存可能滋生致病菌，冷藏并及时回热可显著降低风险。",
    },
    course: {
      id: "course",
      title: "科普：什么是「毒药」——剂量决定毒性",
      domain: "course.example.org",
      url: "https://course.example.org/poison-terms",
      excerpt: "脱离剂量的毒性表述不成立；常规冷藏隔夜菜的亚硝酸盐含量远低于危害剂量。",
    },
    nutrition: {
      id: "nutrition",
      title: "食品科学解读：亚硝酸盐与致癌的量效关系",
      domain: "nutrition.example.cn",
      url: "https://nutrition.example.cn/nitrite-facts",
      excerpt: "正常冷藏隔夜菜的亚硝酸盐水平远低于中毒剂量，讨论风险需要给出具体储存条件。",
    },
    market: {
      id: "market",
      title: "某市市场监管局：2024 年熟制菜品抽检报告",
      domain: "market.example.gov.cn",
      url: "https://market.example.gov.cn/2024-cooked-sampling",
      excerpt: "抽检样本均为 4℃ 冷藏保存，报告未覆盖常温放置组。",
    },
    lab: {
      id: "lab",
      title: "高校食品科学实验室：室温放置 24 小时亚硝酸盐含量测定",
      domain: "lab.example.edu.cn",
      url: "https://lab.example.edu.cn/room-temp-24h",
      excerpt: "室温放置 24 小时的样本亚硝酸盐约为 3.2 mg/kg，仍远低于危害剂量的常见参考值。",
    },
  },

  /** 证据分组按产品顺序：反驳在前，支持其次，相关材料在后。 */
  groups: [
    {
      role: "contradict",
      label: "反驳",
      glyph: "●",
      items: [{ sourceId: "course", relation: "contradict", relationLabel: "反驳" }],
    },
    {
      role: "support",
      label: "支持",
      glyph: "●",
      items: [{ sourceId: "cdc", relation: "support", relationLabel: "支持" }],
    },
    {
      role: "context-only",
      label: "相关材料",
      glyph: "○",
      items: [{ sourceId: "nutrition", relation: "context-only", relationLabel: "相关" }],
    },
  ],

  conflict: {
    /** 原型展示用的人话摘要（真实 builder 目前生成的是计数句，见 summaryMachine）。 */
    summary: "「不当储存可能有风险」和「吃了等于吃毒药」不是同一件事，两边的材料各有一份出处。",
    /** 现行 builder 的真实口径，保留作对照。 */
    summaryMachine: "同一命题同时存在支持与反驳证据：支持 1 条、反驳 1 条",
    sides: [
      { position: "support", label: "支持这条说法", sourceIds: ["cdc"] },
      { position: "contradict", label: "反驳这条说法", sourceIds: ["course"] },
    ],
    reasonStatus: "known",
    reason: "分歧来自剂量与储存条件：疾控提醒的是不当储存风险；常温短存放不构成「毒药」级危害。",
  },

  /** 「立场」变体用：每边一句主张。真实快照的 sides 没有这个字段，属待建内容。 */
  sideClaims: {
    support: "不当储存确实会滋生致病菌，风险真实存在。",
    contradict: "风险远不到「吃毒药」的程度，剂量和储存条件才是关键。",
  },

  gap: {
    description: "缺少对常温存放 24 小时以上样本的定向检测数据",
    consequence: "没有这组数据，就无法判断常温久放是否达到「大量有害物质」的程度。",
  },

  /** 追索记录：为这个缺口实际查过什么（V2 的空位里摊开）。 */
  pursuits: [
    {
      round: "第 1 轮",
      goal: "找常温久放样本的检测数据",
      query: "隔夜菜 常温 24小时 检测",
      result: "没找到直接检测数据。",
      missed: true,
    },
    {
      round: "第 2 轮",
      goal: "换官方抽检与原始数据",
      query: "市场监管 抽检 隔夜菜 亚硝酸盐",
      result: "只找到冷藏样本的抽检报告，没有常温组。",
      missed: true,
    },
  ],
  pursuitNote: "换了两轮查询方式，仍然没有常温组的直接数据。",

  /** V3 的补查剧本：两轮，第二轮把缺口关上。 */
  recheck: {
    searchingMs: 1400,
    rounds: [
      {
        query: "熟制菜品 室温 放置 检测报告",
        log: "只找到冷藏样本的抽检报告，报告没有覆盖常温组。",
        missed: true,
        budgetAfter: 1,
        add: { sourceId: "market", relation: "context-only", relationLabel: "相关", group: "context-only" },
      },
      {
        query: "室温 放置 亚硝酸盐 含量 测定",
        log: "找到常温组的直接测定数据：未达危害剂量的常见参考值。",
        missed: false,
        budgetAfter: 0,
        add: { sourceId: "lab", relation: "contradict", relationLabel: "反驳", group: "contradict" },
        resolveNote: "缺口已补上 · 补查 2 轮 · 新增来源 2 条",
      },
    ],
  },
};
