/**
 * 独立 Design Exploration Playground 唯一真实案例数据契约
 * 三个模式（Mode 1, Mode 2, Mode 3）严格消费完全相同的真实调查数据。
 * 禁止通过改变信息量让某个方案显得更漂亮。
 */

export const INVESTIGATION_CASE = {
  id: "case-vc-cold-001",
  originalQuote: "维生素 C 能治感冒，而且每次感冒都应该输液。",
  quoteTokens: [
    { text: "维生素 C 能治感冒", claimId: "claim-01", isSpan: true },
    { text: "，而且", isSpan: false },
    { text: "每次感冒都应该输液", claimId: "claim-02", isSpan: true },
    { text: "。", isSpan: false }
  ],
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
      originalSpan: [0, 9],
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
          status: "settled",
          note: "支持轻微缩短病程"
        },
        {
          sourceId: "src-02",
          role: "contradict",
          roleLabel: "反驳",
          status: "settled",
          note: "反驳维C能直接治愈普通感冒"
        },
        {
          sourceId: "src-03",
          role: "context-only",
          roleLabel: "仅相关",
          status: "settled",
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
      originalSpan: [12, 22],
      conflict: null,
      evidenceGaps: [
        "该原子定向检索无任何正向支持结果，无公开临床指南支持感冒常规输液。"
      ],
      evidenceLinks: [
        {
          sourceId: "src-04",
          role: "contradict",
          roleLabel: "反驳",
          status: "settled",
          note: "临床指南明确规定无指征不得静脉输液"
        },
        {
          sourceId: "src-05",
          role: "context-only",
          roleLabel: "仅相关",
          status: "settled",
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
