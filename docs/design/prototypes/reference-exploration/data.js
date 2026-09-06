/**
 * 《红鲱鱼与枪》 视觉研究与交互原型设计夹具 (Design Exploration Fixture)
 * 
 * 【Provenance & 数据性质声明】
 * 本数据并非生产管道在线实时导出的单一日志，而是一份「生产形态设计夹具（production-shaped design fixture）」。
 * 其数据结构与业务边界完全遵循生产 InvestigationSnapshotV1 数据契约，
 * 用于在完全相同的信息载荷下横向比较 Mode 1 (Editorial)、Mode 2 (Interactive) 与 Mode 3 (Hybrid) 的感知差异。
 * 
 * 核心事实源：
 * - 原始说法：originalQuote
 * - 命题原子拆分与原始切片：claims[].originalSpan
 * 严禁引入手写 token 映射作为第二事实源。
 */

export const PRODUCTION_SHAPED_FIXTURE = {
  id: "fixture-vc-cold-001",
  fixtureType: "production-shaped design fixture",
  provenance: "Constructed based on Production Snapshot Contract (InvestigationSnapshotV1) for multi-mode visual exploration",
  
  // 原始核查说法（唯一事实源文本）
  originalQuote: "维生素 C 能治感冒，而且每次感冒都应该输液。",
  checkedAt: "2026-09-06 12:00",
  
  conclusion: {
    directAnswer: "只有前半截有依据且被夸大；后半截站不住。",
    summary: "维生素 C 仅在极少数试验中表现出对普通感冒病程轻微缩短约 8% 的辅助效果，不具备治疗或阻断感冒的作用；而普通感冒多由病毒引起，无并发细菌感染指征时绝不应输液。",
    boundaries: "本调查只覆盖普通感冒（上呼吸道感染）常规病程，不涵盖重度脱水、休克或已发生继发性细菌性肺炎的重症急救情况。"
  },

  claims: [
    {
      id: "claim-01",
      num: "01",
      text: "维生素 C 能治感冒",
      type: "causal",
      typeLabel: "因果关系",
      checkability: "checkable",
      judgment: "partial",
      judgmentLabel: "部分成立（被夸大）",
      // 在 originalQuote 中严格对应 "维生素 C 能治感冒" (索引 0 到 10，end-exclusive)
      originalSpan: [0, 10],
      conflict: {
        id: "conflict-01",
        title: "试验统计差异争点",
        reason: "文献对病程缩短的统计学显著性存在分歧",
        detail: "部分试验观察到补充维C缩短病程约8%（支持轻微缓解），但大规模双盲循证评价指出其对发病率和治愈率无统计学意义（反驳治疗主张）。分歧原因已知：日常预防与发病后大剂量冲击的试验口径不一致。"
      },
      evidenceGaps: [
        "尚缺大剂量维C与安慰剂在大样本儿童群体中的双盲对照安全性数据。"
      ],
      evidenceLinks: [
        {
          sourceId: "src-01",
          role: "support",
          roleLabel: "支持",
          note: "支持轻微缩短病程"
        },
        {
          sourceId: "src-02",
          role: "contradict",
          roleLabel: "反驳",
          note: "反驳维C能直接治愈普通感冒"
        },
        {
          sourceId: "src-03",
          role: "context-only",
          roleLabel: "仅相关",
          note: "日常微量营养素推荐摄入指南"
        }
      ]
    },
    {
      id: "claim-02",
      num: "02",
      text: "每次感冒都应该输液",
      type: "fact",
      typeLabel: "事实判断 / 规范要求",
      checkability: "checkable",
      judgment: "false",
      judgmentLabel: "原句站不住",
      // 在 originalQuote 中严格对应 "每次感冒都应该输液" (索引 13 到 22，end-exclusive)
      originalSpan: [13, 22],
      conflict: null,
      evidenceGaps: [
        "该原子定向检索无任何正向支持结果，无公开临床指南支持感冒常规输液。"
      ],
      evidenceLinks: [
        {
          sourceId: "src-04",
          role: "contradict",
          roleLabel: "反驳",
          note: "临床指南明确规定无指征不得静脉输液"
        },
        {
          sourceId: "src-05",
          role: "context-only",
          roleLabel: "仅相关",
          note: "国家卫健委抗菌药物与输液管理规范"
        }
      ]
    }
  ],

  sources: {
    "src-01": {
      id: "src-01",
      title: "《营养学前沿》：大剂量维生素 C 补充与普通感冒病程的 Meta 分析",
      domain: "frontiersin.org",
      url: "https://www.frontiersin.org/articles/10.3389/fnut.2023.102/full",
      excerpt: "对 11,306 名受试者的随机对照试验显示：定期摄入维 C 未能减少感冒发生率；但在成年人中，高剂量补充可使感冒病程缩短约 8%（95% CI 3%–13%）。",
      targetClaim: "维生素 C 能治感冒",
      relevanceReason: "提供了维C对感冒症状时长有微弱辅助作用的试验数据，这是该说法被以偏概全的科学源头。",
      limitations: "试验仅表明在感冒初起时病程微弱缩短，完全不能证明维C具有杀灭感冒病毒或‘治愈感冒’的疗效。",
      reachable: true
    },
    "src-02": {
      id: "src-02",
      title: "Cochrane Database of Systematic Reviews: Vitamin C for preventing and treating the common cold",
      domain: "cochranelibrary.com",
      url: "https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD000980.pub4/full",
      excerpt: "The failure of vitamin C supplementation to reduce the incidence of colds in the general population indicates that routine vitamin C supplementation is not justified. Therapeutic trials showed no consistent effect on cold duration.",
      targetClaim: "维生素 C 能治感冒",
      relevanceReason: "Cochrane 是国际公认最高证据等级的循证医学数据库，直接评估了治疗感冒的有效性。",
      limitations: "只覆盖普通人群的常规感冒，不包含极寒环境马拉松运动员等极端应激状态人群。",
      reachable: true
    },
    "src-03": {
      id: "src-03",
      title: "中国居民膳食营养素参考摄入量（2023 版）",
      domain: "cnsoc.org",
      url: "https://www.cnsoc.org/reference-intakes/2023-vitamin-c",
      excerpt: "成人维生素 C 推荐摄入量（RNI）为 100 mg/d，预防非传染性慢性病建议摄入量为 200 mg/d，可耐受最高摄入量为 2000 mg/d。",
      targetClaim: "维生素 C 能治感冒",
      relevanceReason: "标定了人体每日正常的生理需求线与毒性边界，用于判断流传方中的摄入剂量是否合理。",
      limitations: "这是健康人群的膳食营养基准，不作为任何疾病的临床用药规范。",
      reachable: true
    },
    "src-04": {
      id: "src-04",
      title: "国家卫生健康委《常见呼吸道感染临床诊疗规范及合理用药指征》",
      domain: "nhc.gov.cn",
      url: "https://www.nhc.gov.cn/yzygj/s7659/202210/clinical-guideline.shtml",
      excerpt: "普通感冒具有自限性，病程通常为 7–10 天。严禁在无严重脱水、电解质紊乱或无法口服服药指征的情况下，对单纯感冒患者常规实施静脉滴注给药。",
      targetClaim: "每次感冒都应该输液",
      relevanceReason: "国家权威临床医疗规范，直接否定了‘每次感冒都应该输液’的错误做法。",
      limitations: "不适用于由流感合并重症心肌炎、或严重肺部感染出现循环衰竭的急救救治。",
      reachable: true
    },
    "src-05": {
      id: "src-05",
      title: "中华医学会呼吸病学分会：普通感冒规范化诊治专家共识",
      domain: "cmadrugs.org.cn",
      url: "https://www.cmadrugs.org.cn/expert-consensus/respiratory-cold",
      excerpt: "静脉输液并不能缩短普通感冒病程，相反增加了静脉炎、过敏反应及热原反应等医疗风险。临床倡导‘能口服不肌注，能肌注不输液’原则。",
      targetClaim: "每次感冒都应该输液",
      relevanceReason: "临床专家行业共识，详细阐述了感冒盲目输液的潜在危害与医学风险。",
      limitations: "仅作为诊疗原则指导，不作为个案法律纠纷责任裁定依据。",
      reachable: true
    }
  }
};

/**
 * 专用于自动化回归测试的边界 Claims 夹具
 * 包含缺失 originalSpan 的用例，坚决不进入用户可见的 PRODUCTION_SHAPED_FIXTURE 主设计夹具。
 */
export const TEST_ONLY_CLAIMS = [
  ...PRODUCTION_SHAPED_FIXTURE.claims,
  {
    id: "claim-03-missing-span",
    num: "03",
    text: "输液能让感冒好得更快是常识",
    type: "value_judgment",
    typeLabel: "流传常识型判断",
    checkability: "unverifiable",
    judgment: "unverified",
    judgmentLabel: "无公开依据支撑",
    // 故意提供 null，测试 Claim Trace 绝不产生高亮
    originalSpan: null,
    conflict: null,
    evidenceGaps: [
      "该原子属于民间习惯性断言，在原句中未直接出现具体词组，无法在原句中高亮回溯。"
    ],
    evidenceLinks: []
  }
];

// 夹具自洽性不变量检查 (Fixture Invariant Checks)
if (typeof console !== 'undefined' && console.assert) {
  console.assert(
    PRODUCTION_SHAPED_FIXTURE.claims.length === 2,
    "主设计夹具必须严格只有 2 个 Claim"
  );
  console.assert(
    PRODUCTION_SHAPED_FIXTURE.originalQuote.slice(
      PRODUCTION_SHAPED_FIXTURE.claims[0].originalSpan[0],
      PRODUCTION_SHAPED_FIXTURE.claims[0].originalSpan[1]
    ) === "维生素 C 能治感冒",
    "claim-01 originalSpan 切片必须严格等于 '维生素 C 能治感冒'"
  );
  console.assert(
    PRODUCTION_SHAPED_FIXTURE.originalQuote.slice(
      PRODUCTION_SHAPED_FIXTURE.claims[1].originalSpan[0],
      PRODUCTION_SHAPED_FIXTURE.claims[1].originalSpan[1]
    ) === "每次感冒都应该输液",
    "claim-02 originalSpan 切片必须严格等于 '每次感冒都应该输液'"
  );
}
