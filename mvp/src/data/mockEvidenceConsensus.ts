/**
 * mockEvidenceConsensus.ts — 多搜索引擎交叉验证 MVP Demo Mock 数据
 *
 * 场景：清华大学食堂推出"AI营养师"配餐系统
 * 用于演示 EvidenceMatrix、EvidenceDetailDrawer、ConsensusProgressPanel
 */

import type {
  ClaimDecompositionResult,
  MultiSearchJob,
  EvidenceConsensusReport,
} from "../lib/schemas";

// ── 1. Claim 拆解结果 ──────────────────────────────────────────

export const MOCK_CLAIM =
  "清华大学食堂推出\"AI营养师\"配餐系统，学生使用后营养不良率下降30%";

export const mockClaimDecomposition: ClaimDecompositionResult = {
  originalClaim: MOCK_CLAIM,
  decompositionReasoning:
    "该 claim 包含三个可独立验证的事实断言：1）系统是否存在；2）技术属性；3）效果数据。将复杂 claim 拆解为原子命题，便于分别检索和验证。",
  atomicPropositions: [
    {
      id: "prop-a",
      text: "清华大学食堂是否推出了\"AI营养师\"配餐系统",
      type: "事实陈述",
      verifiability: "可直接验证",
    },
    {
      id: "prop-b",
      text: "该配餐系统是否使用了 AI 技术",
      type: "归因断言",
      verifiability: "可直接验证",
    },
    {
      id: "prop-c",
      text: "使用该系统的学生营养不良率是否下降了 30%",
      type: "数值断言",
      verifiability: "需间接推断",
    },
  ],
};

// ── 2. 多搜索任务结果 ──────────────────────────────────────────

export const mockSearchJobs: MultiSearchJob[] = [
  {
    jobId: "job-prop-a",
    propositionId: "prop-a",
    propositionText: "清华大学食堂是否推出了\"AI营养师\"配餐系统",
    searchTasks: [
      {
        provider: "360_search",
        query: "清华大学食堂 AI营养师 配餐系统",
        status: "completed",
        result: {
          provider: "360_search",
          query: "清华大学食堂 AI营养师 配餐系统",
          latencyMs: 2300,
          answer:
            "清华大学饮食服务中心于 2024 年 3 月推出了\"智慧营养配餐系统\"，该系统利用 AI 算法根据学生的身体数据和饮食偏好推荐菜品。",
          sources: [
            {
              id: "src-a-360-1",
              title: "清华大学饮食服务中心推出智慧营养配餐系统",
              url: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
              snippet:
                "清华大学饮食服务中心于 2024 年 3 月 15 日正式上线\"智慧营养配餐系统\"...",
              domain: "tsinghua.edu.cn",
              publishedAt: "2024-03-15",
              sourceType: "官方",
            },
            {
              id: "src-a-360-2",
              title: "清华\"AI营养师\"引关注：高校食堂数字化转型新探索",
              url: "https://news.example.com/edu/2024/0316/tsinghua-ai-canteen",
              snippet:
                "清华大学近日推出的\"AI营养师\"配餐系统引发了广泛关注...",
              domain: "news.example.com",
              publishedAt: "2024-03-16",
              sourceType: "媒体",
            },
            {
              id: "src-a-360-3",
              title: "在清华食堂体验 AI 配餐，真的有用吗？",
              url: "https://zhuanlan.zhihu.com/p/12345678",
              snippet: "作为一名清华学生，我体验了学校新推出的 AI 配餐系统...",
              domain: "zhuanlan.zhihu.com",
              publishedAt: "2024-03-17",
              sourceType: "论坛",
            },
          ],
        },
      },
      {
        provider: "any_search",
        query: "清华大学食堂 AI营养师 配餐系统",
        status: "completed",
        result: {
          provider: "any_search",
          query: "清华大学食堂 AI营养师 配餐系统",
          latencyMs: 3100,
          answer:
            "多个来源证实清华大学确实推出了基于 AI 的营养配餐系统。",
          sources: [
            {
              id: "src-a-any-1",
              title: "清华\"智慧营养\"系统上线，高校食堂进入AI时代",
              url: "https://edu.another-news.com/2024/0316/tsinghua-smart-canteen",
              snippet:
                "据清华大学饮食服务中心公告，该校于 3 月 15 日推出智慧营养配餐系统...",
              domain: "edu.another-news.com",
              publishedAt: "2024-03-16",
              sourceType: "媒体",
            },
            {
              id: "src-a-any-2",
              title: "清华大学智慧营养配餐系统",
              url: "https://mp.weixin.qq.com/s/abcd1234",
              snippet:
                "清华饮食中心推出的 AI 配餐系统引发热议...",
              domain: "mp.weixin.qq.com",
              publishedAt: "2024-03-18",
              sourceType: "自媒体",
            },
          ],
        },
      },
      {
        provider: "metaso_search",
        query: "清华大学食堂 AI营养师 配餐系统",
        status: "failed",
      },
    ],
  },
  {
    jobId: "job-prop-b",
    propositionId: "prop-b",
    propositionText: "该配餐系统是否使用了 AI 技术",
    searchTasks: [
      {
        provider: "360_search",
        query: "清华大学 智慧营养配餐系统 AI技术 算法",
        status: "completed",
        result: {
          provider: "360_search",
          query: "清华大学 智慧营养配餐系统 AI技术 算法",
          latencyMs: 2100,
          answer:
            "官方公告称该系统\"利用 AI 算法\"，但技术细节未公开。",
          sources: [
            {
              id: "src-b-360-1",
              title: "清华大学饮食服务中心推出智慧营养配餐系统",
              url: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
              snippet:
                "...该系统利用 AI 算法根据学生的身体数据和饮食偏好进行智能推荐...",
              domain: "tsinghua.edu.cn",
              publishedAt: "2024-03-15",
              sourceType: "官方",
            },
            {
              id: "src-b-360-2",
              title: "清华\"AI营养师\"到底用了什么AI？",
              url: "https://zhuanlan.zhihu.com/p/12345679",
              snippet:
                "官方公告只提到\"AI算法\"，但没有说明具体使用了什么模型或技术...",
              domain: "zhuanlan.zhihu.com",
              publishedAt: "2024-03-20",
              sourceType: "论坛",
            },
          ],
        },
      },
      {
        provider: "any_search",
        query: "清华大学 智慧营养配餐系统 AI技术 算法",
        status: "completed",
        result: {
          provider: "any_search",
          query: "清华大学 智慧营养配餐系统 AI技术 算法",
          latencyMs: 2800,
          answer:
            "官方公告提到\"AI算法\"，但没有提供技术白皮书或详细说明。",
          sources: [
            {
              id: "src-b-any-1",
              title: "高校AI配餐系统的技术真相",
              url: "https://tech.blog.example.com/2024/0325/ai-canteen-tech",
              snippet:
                "...目前公开信息仅限于\"利用AI算法\"的笼统表述，缺乏技术细节...",
              domain: "tech.blog.example.com",
              publishedAt: "2024-03-25",
              sourceType: "自媒体",
            },
          ],
        },
      },
      {
        provider: "metaso_search",
        query: "清华大学 智慧营养配餐系统 AI技术 算法",
        status: "failed",
      },
    ],
  },
  {
    jobId: "job-prop-c",
    propositionId: "prop-c",
    propositionText: "使用该系统的学生营养不良率是否下降了 30%",
    searchTasks: [
      {
        provider: "360_search",
        query: "清华大学 营养不良率 下降30% 配餐系统 数据",
        status: "completed",
        result: {
          provider: "360_search",
          query: "清华大学 营养不良率 下降30% 配餐系统 数据",
          latencyMs: 2500,
          answer:
            "未找到官方发布的\"营养不良率下降30%\"的权威数据。",
          sources: [
            {
              id: "src-c-360-1",
              title: "清华食堂新系统获好评，但效果数据待验证",
              url: "https://news.example.com/health/2024/0320/tsinghua-canteen-data",
              snippet:
                "...虽然学生反馈积极，但校方尚未发布关于营养不良率变化的权威统计数据...",
              domain: "news.example.com",
              publishedAt: "2024-03-20",
              sourceType: "媒体",
            },
            {
              id: "src-c-360-2",
              title: "高校营养干预效果评估：一项队列研究",
              url: "https://journal.example.com/2019/0345/nutrition-intervention",
              snippet:
                "...某高校 2018-2019 年营养干预项目显示，参与学生营养不良率下降 28%...",
              domain: "journal.example.com",
              publishedAt: "2019-06-01",
              sourceType: "学术",
            },
          ],
        },
      },
      {
        provider: "any_search",
        query: "清华大学 营养不良率 下降30% 配餐系统 数据",
        status: "completed",
        result: {
          provider: "any_search",
          query: "清华大学 营养不良率 下降30% 配餐系统 数据",
          latencyMs: 3200,
          answer:
            "搜索未发现清华大学官方发布的\"营养不良率下降30%\"数据。",
          sources: [
            {
              id: "src-c-any-1",
              title: "清华\"AI营养师\"效果被夸大？数据溯源调查",
              url: "https://factcheck.example.com/2024/0322/tsinghua-data",
              snippet:
                "...经核查，\"下降30%\"的数据目前找不到原始出处，可能混淆了其他研究...",
              domain: "factcheck.example.com",
              publishedAt: "2024-03-22",
              sourceType: "媒体",
            },
          ],
        },
      },
      {
        provider: "metaso_search",
        query: "清华大学 营养不良率 下降30% 配餐系统 数据",
        status: "failed",
      },
    ],
  },
];

// ── 3. EvidenceConsensusReport ───────────────────────────────────

export const mockConsensusReport: EvidenceConsensusReport = {
  consensusId: "consensus-demo-001",
  timestamp: Date.now(),
  overallStats: {
    totalPropositions: 3,
    readyForReasoning: 1,
    doubtful: 1,
    needsManualReview: 1,
    totalIndependentSources: 4,
    totalDuplicateSources: 3,
    counterEvidenceSearchesPerformed: 3,
  },
  propositionResults: [
    {
      propositionId: "prop-a",
      propositionText: "清华大学食堂是否推出了\"AI营养师\"配餐系统",
      status: "可进入推理",
      statusReason:
        "多个 Provider 返回相关结果，存在官方原始来源（学校官网），反证搜索暂未发现反驳材料，来源独立性评分 80%。",
      evidenceIndependence: {
        totalSources: 5,
        independentSources: 3,
        duplicateSources: 2,
        independenceScore: 80,
        reasoning:
          "360 Search 和 AnySearch 都引用了同一官方公告，但知乎讨论为独立来源。去重后 3 个独立来源。",
      },
      sourceTierDistribution: {
        government: 0,
        academic: 0,
        media: 2,
        selfMedia: 1,
        forum: 1,
        unknown: 0,
        highestTierFound: "media",
      },
      counterEvidenceCoverage: {
        counterSearchPerformed: true,
        counterEvidenceFound: false,
        counterEvidenceCount: 0,
        counterEvidenceSources: [],
        verdict: "暂未发现反证",
      },
      providerResults: [
        {
          provider: "360_search",
          sourceCount: 3,
          relevantSources: 3,
          supportsProposition: true,
          contradictsProposition: false,
          topSourceUrl: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
        },
        {
          provider: "any_search",
          sourceCount: 2,
          relevantSources: 2,
          supportsProposition: true,
          contradictsProposition: false,
          topSourceUrl: "https://edu.another-news.com/2024/0316/tsinghua-smart-canteen",
        },
        {
          provider: "metaso_search",
          sourceCount: 0,
          relevantSources: 0,
          supportsProposition: null,
          contradictsProposition: null,
          topSourceUrl: "",
        },
      ],
      independentSources: [
        {
          id: "ind-src-a-1",
          title: "清华大学饮食服务中心推出智慧营养配餐系统",
          url: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
          domain: "tsinghua.edu.cn",
          sourceType: "官方",
          isOriginalSource: true,
          supports: true,
          contradicts: false,
          providerOrigins: ["360_search", "any_search"],
        },
        {
          id: "ind-src-a-2",
          title: "在清华食堂体验 AI 配餐，真的有用吗？",
          url: "https://zhuanlan.zhihu.com/p/12345678",
          domain: "zhuanlan.zhihu.com",
          sourceType: "论坛",
          isOriginalSource: false,
          supports: true,
          contradicts: false,
          providerOrigins: ["360_search"],
        },
        {
          id: "ind-src-a-3",
          title: "清华大学智慧营养配餐系统",
          url: "https://mp.weixin.qq.com/s/abcd1234",
          domain: "mp.weixin.qq.com",
          sourceType: "自媒体",
          isOriginalSource: false,
          originalSourceUrl: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
          supports: true,
          contradicts: false,
          providerOrigins: ["any_search"],
        },
      ],
      meetsMinimumCriteria: {
        criteria1_minProviders: true,
        criteria2_hasHighTierOrOriginal: true,
        criteria3_counterSearchDone: true,
        criteria4_duplicatesCountedOnce: true,
        allMet: true,
      },
    },
    {
      propositionId: "prop-b",
      propositionText: "该配餐系统是否使用了 AI 技术",
      status: "存疑",
      statusReason:
        "官方公告提到\"AI算法\"，但缺乏技术细节。无法独立验证是否真正使用了 AI 技术，还是仅为营销用语。",
      evidenceIndependence: {
        totalSources: 3,
        independentSources: 3,
        duplicateSources: 0,
        independenceScore: 100,
        reasoning:
          "三个来源各自独立讨论该技术问题，无转载关系。",
      },
      sourceTierDistribution: {
        government: 0,
        academic: 0,
        media: 0,
        selfMedia: 1,
        forum: 1,
        unknown: 0,
        highestTierFound: "media",
      },
      counterEvidenceCoverage: {
        counterSearchPerformed: true,
        counterEvidenceFound: false,
        counterEvidenceCount: 0,
        counterEvidenceSources: [],
        verdict: "暂未发现反证",
      },
      providerResults: [
        {
          provider: "360_search",
          sourceCount: 2,
          relevantSources: 2,
          supportsProposition: true,
          contradictsProposition: false,
          topSourceUrl: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
        },
        {
          provider: "any_search",
          sourceCount: 1,
          relevantSources: 1,
          supportsProposition: null,
          contradictsProposition: false,
          topSourceUrl: "https://tech.blog.example.com/2024/0325/ai-canteen-tech",
        },
        {
          provider: "metaso_search",
          sourceCount: 0,
          relevantSources: 0,
          supportsProposition: null,
          contradictsProposition: null,
          topSourceUrl: "",
        },
      ],
      independentSources: [
        {
          id: "ind-src-b-1",
          title: "清华大学饮食服务中心推出智慧营养配餐系统",
          url: "https://www.tsinghua.edu.cn/info/1234/5678.htm",
          domain: "tsinghua.edu.cn",
          sourceType: "官方",
          isOriginalSource: true,
          supports: true,
          contradicts: false,
          providerOrigins: ["360_search"],
        },
        {
          id: "ind-src-b-2",
          title: "清华\"AI营养师\"到底用了什么AI？",
          url: "https://zhuanlan.zhihu.com/p/12345679",
          domain: "zhuanlan.zhihu.com",
          sourceType: "论坛",
          isOriginalSource: false,
          supports: false,
          contradicts: false,
          providerOrigins: ["360_search"],
        },
        {
          id: "ind-src-b-3",
          title: "高校AI配餐系统的技术真相",
          url: "https://tech.blog.example.com/2024/0325/ai-canteen-tech",
          domain: "tech.blog.example.com",
          sourceType: "自媒体",
          isOriginalSource: false,
          supports: false,
          contradicts: false,
          providerOrigins: ["any_search"],
        },
      ],
      meetsMinimumCriteria: {
        criteria1_minProviders: true,
        criteria2_hasHighTierOrOriginal: false,
        criteria3_counterSearchDone: true,
        criteria4_duplicatesCountedOnce: true,
        allMet: false,
      },
    },
    {
      propositionId: "prop-c",
      propositionText: "使用该系统的学生营养不良率是否下降了 30%",
      status: "需人工复核",
      statusReason:
        "未找到官方发布的\"下降30%\"数据。AnySearch 发现事实核查文章指出该数据可能混淆了其他研究。360 Search 找到一篇 2019 年的学术论文显示下降 28%，但与清华当前系统无关且已过期。",
      evidenceIndependence: {
        totalSources: 3,
        independentSources: 3,
        duplicateSources: 0,
        independenceScore: 100,
        reasoning: "三个来源各自独立，无转载关系。",
      },
      sourceTierDistribution: {
        government: 0,
        academic: 1,
        media: 1,
        selfMedia: 0,
        forum: 0,
        unknown: 0,
        highestTierFound: "academic",
      },
      counterEvidenceCoverage: {
        counterSearchPerformed: true,
        counterEvidenceFound: true,
        counterEvidenceCount: 1,
        counterEvidenceSources: [
          "https://factcheck.example.com/2024/0322/tsinghua-data",
        ],
        verdict: "反证已覆盖",
      },
      providerResults: [
        {
          provider: "360_search",
          sourceCount: 2,
          relevantSources: 1,
          supportsProposition: false,
          contradictsProposition: false,
          topSourceUrl: "https://journal.example.com/2019/0345/nutrition-intervention",
        },
        {
          provider: "any_search",
          sourceCount: 1,
          relevantSources: 1,
          supportsProposition: false,
          contradictsProposition: true,
          topSourceUrl: "https://factcheck.example.com/2024/0322/tsinghua-data",
        },
        {
          provider: "metaso_search",
          sourceCount: 0,
          relevantSources: 0,
          supportsProposition: null,
          contradictsProposition: null,
          topSourceUrl: "",
        },
      ],
      independentSources: [
        {
          id: "ind-src-c-1",
          title: "高校营养干预效果评估：一项队列研究",
          url: "https://journal.example.com/2019/0345/nutrition-intervention",
          domain: "journal.example.com",
          sourceType: "学术",
          isOriginalSource: true,
          supports: false,
          contradicts: false,
          providerOrigins: ["360_search"],
        },
        {
          id: "ind-src-c-2",
          title: "清华\"AI营养师\"效果被夸大？数据溯源调查",
          url: "https://factcheck.example.com/2024/0322/tsinghua-data",
          domain: "factcheck.example.com",
          sourceType: "媒体",
          isOriginalSource: true,
          supports: false,
          contradicts: true,
          providerOrigins: ["any_search"],
        },
        {
          id: "ind-src-c-3",
          title: "清华食堂新系统获好评，但效果数据待验证",
          url: "https://news.example.com/health/2024/0320/tsinghua-canteen-data",
          domain: "news.example.com",
          sourceType: "媒体",
          isOriginalSource: false,
          supports: false,
          contradicts: false,
          providerOrigins: ["360_search"],
        },
      ],
      meetsMinimumCriteria: {
        criteria1_minProviders: true,
        criteria2_hasHighTierOrOriginal: false,
        criteria3_counterSearchDone: true,
        criteria4_duplicatesCountedOnce: true,
        allMet: false,
      },
    },
  ],
};

// ── 4. 导出完整 Demo 数据 ──────────────────────────────────────

export const mockCrossSearchDemo = {
  claim: MOCK_CLAIM,
  decomposition: mockClaimDecomposition,
  searchJobs: mockSearchJobs,
  consensusReport: mockConsensusReport,
};
