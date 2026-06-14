import type { DemoCase } from "../../lib/schemas";

export const healthRumorCase: DemoCase = {
  originalClaim: "隔夜菜会致癌，吃了等于吃毒药",
  rumorType: "健康",
  useContext: "微信群传播",
  diagnosis: {
    mixedJudgments: ["因果", "数量事实", "概念"],
    ambiguousTerms: ["隔夜菜", "致癌", "毒药"],
    risk: "将日常饮食行为与严重疾病进行强因果关联，使用极端比喻制造恐慌，是典型的健康类谣言特征。",
    whyNotDirectFactCheck: "需要区分亚硝酸盐含量、储存条件、摄入量与致癌风险的关系，不能简单断言隔夜菜等于毒药。",
    rumorIndicators: ["绝对化表述", "恐惧诉求", "简单归因", "极端比喻"],
  },
  subclaims: [
    { id: "C1", text: "隔夜菜中的亚硝酸盐含量是否达到危险水平？", type: "数量事实", roleInArgument: "需要验证隔夜菜中亚硝酸盐的实际含量数据。" },
    { id: "C2", text: "亚硝酸盐摄入量达到多少才可能致癌？", type: "数量事实", roleInArgument: "需要明确安全剂量和致癌剂量之间的阈值。" },
    { id: "C3", text: "正常食用隔夜菜是否会达到致癌剂量？", type: "因果", roleInArgument: "核心因果判断：日常食用量与致癌风险之间的关系。" },
    { id: "C4", text: "隔夜菜与毒药的类比是否恰当？", type: "概念", roleInArgument: "修辞分析：极端比喻是否扭曲了科学事实。" },
    { id: "C5", text: "是否存在反驳证据？", type: "反证", roleInArgument: "寻找权威机构或研究对隔夜菜安全性的评估。" },
  ],
  routes: [
    { subclaimId: "C1", neededEvidence: ["隔夜菜中亚硝酸盐含量的实测数据", "不同储存条件下的含量变化", "不同菜品种类的差异"], notAcceptable: ["单一案例", "没有检测数据的说法", "自媒体文章"], minimumOutputRule: "没有找到实测数据时，只能说含量未知，不能推断危险。" },
    { subclaimId: "C2", neededEvidence: ["WHO或国家食品安全标准中的亚硝酸盐限量", "致癌剂量的毒理学研究"], notAcceptable: ["没有标准依据的说法", "脱离剂量谈毒性"], minimumOutputRule: "没有找到安全标准时，不能说超标。" },
    { subclaimId: "C3", neededEvidence: ["流行病学研究", "摄入量与癌症发病率的相关性", "替代解释（如吸烟、饮酒等其他因素）"], notAcceptable: ["动物实验直接外推到人类", "体外实验结果"], minimumOutputRule: "没有人群研究时，不能说导致癌症。" },
    { subclaimId: "C4", neededEvidence: ["毒物定义标准", "隔夜菜的实际毒性评估"], notAcceptable: ["比喻代替证据"], minimumOutputRule: "没有毒性评估时，不能说等于毒药。" },
    { subclaimId: "C5", neededEvidence: ["权威机构（如国家食品安全风险评估中心）的评估", "主流科学界的共识"], notAcceptable: ["单一反对意见", "未经同行评审的说法"], minimumOutputRule: "没有找到权威评估时，不能说已被科学界否定。" },
  ],
  searchPlans: [
    { subclaimId: "C1", searchPlan: ["检测数据", "储存条件影响", "菜品种类差异"], querySets: { academic: ["nitrite content overnight vegetables", "leftover food nitrite levels storage"], data: ["隔夜菜 亚硝酸盐 检测数据", "剩菜 亚硝酸盐含量 标准"], counter: ["隔夜菜安全 辟谣", "亚硝酸盐 安全剂量"] }, counterQueries: ["隔夜菜亚硝酸盐超标 案例", "亚硝酸盐中毒 剂量"], mustNotInfer: ["不能用单一检测结果推断所有隔夜菜", "不能用动物实验推断人类风险"], evidenceGaps: ["需要更多常温储存条件下的检测数据"] },
    { subclaimId: "C2", searchPlan: ["安全标准", "致癌剂量", "毒理学研究"], querySets: { academic: ["nitrite ADI WHO", "nitrosamine carcinogenic dose"], data: ["亚硝酸盐 每日允许摄入量 国家标准", "亚硝胺 致癌 剂量"], counter: ["亚硝酸盐 安全 剂量"] }, counterQueries: ["亚硝酸盐 致癌 证据不足"], mustNotInfer: ["不能用LD50推断致癌风险", "不能用急性毒性推断慢性风险"], evidenceGaps: ["需要人群长期摄入研究"] },
    { subclaimId: "C3", searchPlan: ["流行病学研究", "摄入量评估", "替代解释"], querySets: { academic: ["dietary nitrite cancer risk cohort study", "leftover food cancer epidemiology"], data: ["隔夜菜 癌症 流行病学", "亚硝酸盐摄入 癌症风险"], counter: ["隔夜菜 安全 食用", "亚硝酸盐 并非 致癌物"] }, counterQueries: ["胃癌 亚硝酸盐 因果关系", "饮食因素 癌症 多重因素"], mustNotInfer: ["不能用相关性推断因果", "不能用单一因素解释复杂疾病"], evidenceGaps: ["缺乏前瞻性队列研究"] },
    { subclaimId: "C4", searchPlan: ["毒物定义", "毒性评估", "修辞分析"], querySets: { academic: ["poison definition toxicology", "food safety risk assessment"], data: ["毒药 定义 毒理学", "隔夜菜 毒性评估"], counter: ["隔夜菜 不等于 毒药"] }, counterQueries: ["食物安全 风险评估 标准"], mustNotInfer: ["不能用比喻代替科学评估"], evidenceGaps: ["缺乏系统的隔夜菜毒性评估"] },
    { subclaimId: "C5", searchPlan: ["权威机构评估", "科学共识", "官方指南"], querySets: { academic: ["food safety authority leftover food", "CFSA overnight vegetables"], data: ["国家食品安全风险评估中心 隔夜菜", "中国疾控中心 剩菜"], counter: ["隔夜菜 辟谣 官方"] }, counterQueries: ["隔夜菜 致癌 辟谣"], mustNotInfer: ["不能用单一机构意见代表全部", "不能用过去的评估否定最新研究"], evidenceGaps: ["需要最新的权威评估报告"] },
  ],
  candidates: [
    { id: "E1", title: "国家食品安全风险评估中心：隔夜菜亚硝酸盐含量评估", sourceType: "行业报告", targetSubclaimIds: ["C1", "C2"], matchedNeed: "权威机构对隔夜菜安全性的评估", summary: "评估显示，正常储存条件下隔夜菜亚硝酸盐含量远低于安全限量，不会对健康造成危害。", traceability: "高", contextFit: "高", independence: "高", limitations: ["评估基于特定储存条件", "未涵盖所有菜品种类"] },
    { id: "E2", title: "《食品科学》期刊：不同储存条件下蔬菜亚硝酸盐变化研究", sourceType: "学术论文", targetSubclaimIds: ["C1"], matchedNeed: "隔夜菜中亚硝酸盐含量的实测数据", summary: "实验数据显示，冷藏条件下隔夜菜亚硝酸盐含量增幅有限，室温储存则增幅较大。", traceability: "高", contextFit: "高", independence: "高", limitations: ["实验室条件与家庭环境有差异", "样本量有限"] },
    { id: "E3", title: "WHO：亚硝酸盐每日允许摄入量（ADI）标准", sourceType: "行业报告", targetSubclaimIds: ["C2"], matchedNeed: "亚硝酸盐的安全剂量标准", summary: "WHO设定亚硝酸盐ADI为0-0.07mg/kg体重，正常食用隔夜菜不会达到此限量。", traceability: "高", contextFit: "高", independence: "高", limitations: ["ADI基于动物实验外推", "个体差异未充分考虑"] },
    { id: "E4", title: "某健康自媒体：隔夜菜等于毒药文章", sourceType: "评论文章", targetSubclaimIds: ["C4"], matchedNeed: "谣言来源和传播路径", summary: "文章使用极端比喻，未提供具体检测数据，属于典型的健康类谣言。", traceability: "低", contextFit: "低", independence: "低", limitations: ["非专业来源", "缺乏数据支撑", "情绪化表达"] },
    { id: "E5", title: "《中华流行病学杂志》：胃癌与饮食习惯关联性研究", sourceType: "学术论文", targetSubclaimIds: ["C3", "C5"], matchedNeed: "隔夜菜与癌症的因果关联", summary: "研究显示胃癌与多种饮食习惯相关，但无法单独归因于隔夜菜摄入。", traceability: "高", contextFit: "中", independence: "中", limitations: ["观察性研究不能确定因果", "存在多种混杂因素"] },
  ],
};
