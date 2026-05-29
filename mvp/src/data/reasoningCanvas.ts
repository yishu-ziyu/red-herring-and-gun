export type CanvasNodeType =
  | "claim"
  | "judgment"
  | "subclaim"
  | "evidence_need"
  | "candidate_evidence"
  | "agent_task"
  | "evidence_clue"
  | "search_frontier"
  | "search_stopped"
  | "inference_license"
  | "rewrite";

export type CanvasNodeStatus =
  | "risk"
  | "active"
  | "supported"
  | "limited"
  | "blocked"
  | "rewrite"
  | "clue"
  | "frontier"
  | "stopped"
  | "controller"
  | "handoff";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  status?: CanvasNodeStatus;
  handoffState?: "pending" | "running" | "completed" | "failed";
  sourceRef?: {
    subclaimId?: string;
    candidateId?: string;
    recursiveRunId?: string;
    clueId?: string;
    frontierId?: string;
    stoppedId?: string;
  };
  revealStage: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  revealStage: number;
  animated?: boolean;
  style?: "parallel_split" | "parallel_join" | "default";
}

export interface ReasoningStep {
  id: string;
  text: string;
  nodeIds: string[];
  revealStage: number;
}

export const maxRevealStage = 5;
export const guidedRevealLimit = 3;

export const canvasNodes: CanvasNode[] = [
  {
    id: "claim-root",
    type: "claim",
    title: "AI 导致初级内容岗位减少",
    subtitle: "中心观点：一句高强度因果断言",
    x: 46,
    y: 45,
    status: "risk",
    revealStage: 1,
  },
  {
    id: "judgment-concept",
    type: "judgment",
    title: "概念不明",
    subtitle: "初级内容岗位指什么？",
    x: 14,
    y: 17,
    status: "limited",
    sourceRef: { subclaimId: "C1" },
    revealStage: 2,
  },
  {
    id: "judgment-quantity",
    type: "judgment",
    title: "数量事实",
    subtitle: "岗位需求是否真的下降？",
    x: 35,
    y: 15,
    status: "supported",
    sourceRef: { subclaimId: "C2" },
    revealStage: 2,
  },
  {
    id: "judgment-mechanism",
    type: "judgment",
    title: "机制判断",
    subtitle: "AI 是否改变任务结构？",
    x: 72,
    y: 17,
    status: "supported",
    sourceRef: { subclaimId: "C3" },
    revealStage: 2,
  },
  {
    id: "judgment-causal",
    type: "judgment",
    title: "因果判断",
    subtitle: "能不能说“导致”？",
    x: 31,
    y: 64,
    status: "risk",
    sourceRef: { subclaimId: "C4" },
    revealStage: 2,
  },
  {
    id: "judgment-counter",
    type: "judgment",
    title: "反证路径",
    subtitle: "是否存在新岗位或互补效应？",
    x: 79,
    y: 78,
    status: "limited",
    sourceRef: { subclaimId: "C5" },
    revealStage: 2,
  },
  {
    id: "need-time",
    type: "evidence_need",
    title: "时间顺序",
    subtitle: "AI 采用必须早于岗位变化",
    x: 13,
    y: 48,
    status: "active",
    sourceRef: { subclaimId: "C4" },
    revealStage: 3,
  },
  {
    id: "need-mechanism",
    type: "evidence_need",
    title: "机制链",
    subtitle: "从任务替代到招聘变化",
    x: 13,
    y: 84,
    status: "active",
    sourceRef: { subclaimId: "C4" },
    revealStage: 3,
  },
  {
    id: "need-alternative",
    type: "evidence_need",
    title: "替代解释",
    subtitle: "行业周期、降本、平台变化",
    x: 58,
    y: 91,
    status: "active",
    sourceRef: { subclaimId: "C4" },
    revealStage: 3,
  },
  {
    id: "need-counterfactual",
    type: "evidence_need",
    title: "反事实",
    subtitle: "没有 AI 时是否仍会下降？",
    x: 58,
    y: 68,
    status: "active",
    sourceRef: { subclaimId: "C4" },
    revealStage: 3,
  },
  {
    id: "evidence-exposure",
    type: "candidate_evidence",
    title: "写作职业暴露度研究",
    subtitle: "支持机制可能性，不能推出岗位减少",
    x: 90,
    y: 28,
    status: "limited",
    sourceRef: { subclaimId: "C3", candidateId: "E1" },
    revealStage: 4,
  },
  {
    id: "evidence-postings",
    type: "candidate_evidence",
    title: "招聘时间序列",
    subtitle: "可支持某口径下降，不能说明原因",
    x: 17,
    y: 36,
    status: "supported",
    sourceRef: { subclaimId: "C2", candidateId: "E2" },
    revealStage: 4,
  },
  {
    id: "evidence-case",
    type: "candidate_evidence",
    title: "企业 AI 案例",
    subtitle: "个案线索，不能代表行业",
    x: 9,
    y: 68,
    status: "limited",
    sourceRef: { subclaimId: "C4", candidateId: "E3" },
    revealStage: 4,
  },
  {
    id: "evidence-commentary",
    type: "candidate_evidence",
    title: "行业评论",
    subtitle: "只能作背景，不能作因果证据",
    x: 35,
    y: 93,
    status: "blocked",
    sourceRef: { subclaimId: "C4", candidateId: "E4" },
    revealStage: 4,
  },
  {
    id: "evidence-counter",
    type: "candidate_evidence",
    title: "AI 新岗位报告",
    subtitle: "提示互补效应和反证路径",
    x: 91,
    y: 90,
    status: "limited",
    sourceRef: { subclaimId: "C5", candidateId: "E5" },
    revealStage: 4,
  },
  {
    id: "license-causal",
    type: "inference_license",
    title: "推理许可",
    subtitle: "证据不足，不能说“导致”",
    x: 73,
    y: 55,
    status: "blocked",
    sourceRef: { subclaimId: "C4" },
    revealStage: 5,
  },
  {
    id: "rewrite-final",
    type: "rewrite",
    title: "降强度改写",
    subtitle: "从“导致”降为“可能正在改变”",
    x: 88,
    y: 65,
    status: "rewrite",
    revealStage: 5,
  },
];

export const canvasEdges: CanvasEdge[] = [
  { id: "edge-root-concept", from: "claim-root", to: "judgment-concept", label: "拆概念", revealStage: 2 },
  { id: "edge-root-quantity", from: "claim-root", to: "judgment-quantity", label: "先验前提", revealStage: 2 },
  { id: "edge-root-mechanism", from: "claim-root", to: "judgment-mechanism", label: "作用机制", revealStage: 2 },
  { id: "edge-root-causal", from: "claim-root", to: "judgment-causal", label: "最高风险", revealStage: 2 },
  { id: "edge-root-counter", from: "claim-root", to: "judgment-counter", label: "反证", revealStage: 2 },
  { id: "edge-causal-time", from: "judgment-causal", to: "need-time", revealStage: 3 },
  { id: "edge-causal-mechanism", from: "judgment-causal", to: "need-mechanism", revealStage: 3 },
  { id: "edge-causal-alternative", from: "judgment-causal", to: "need-alternative", revealStage: 3 },
  { id: "edge-causal-counterfactual", from: "judgment-causal", to: "need-counterfactual", revealStage: 3 },
  { id: "edge-postings-time", from: "evidence-postings", to: "need-time", label: "部分满足", revealStage: 4 },
  { id: "edge-exposure-mechanism", from: "evidence-exposure", to: "judgment-mechanism", label: "支持任务层", revealStage: 4 },
  { id: "edge-case-mechanism", from: "evidence-case", to: "need-mechanism", label: "个案线索", revealStage: 4 },
  { id: "edge-commentary-alternative", from: "evidence-commentary", to: "need-alternative", label: "不足", revealStage: 4 },
  { id: "edge-counter-counter", from: "evidence-counter", to: "judgment-counter", label: "反向材料", revealStage: 4 },
  { id: "edge-causal-license", from: "judgment-causal", to: "license-causal", label: "审计后", revealStage: 5 },
  { id: "edge-license-rewrite", from: "license-causal", to: "rewrite-final", label: "降强度", revealStage: 5 },
];

export const reasoningSteps: ReasoningStep[] = [
  {
    id: "step-1",
    text: "我先把原句作为中心观点，检查它是否能直接判真伪。",
    nodeIds: ["claim-root"],
    revealStage: 1,
  },
  {
    id: "step-2",
    text: "我发现它不是单一事实，而是混合了概念、数量、机制、因果和反证路径。",
    nodeIds: ["judgment-concept", "judgment-quantity", "judgment-mechanism", "judgment-causal", "judgment-counter"],
    revealStage: 2,
  },
  {
    id: "step-3",
    text: "我优先展开“导致”，因为它是原句最强、也最危险的断言。",
    nodeIds: ["judgment-causal", "need-time", "need-mechanism", "need-alternative", "need-counterfactual"],
    revealStage: 3,
  },
  {
    id: "step-4",
    text: "我把候选材料放到对应证据需求下，而不是直接把它们当作结论。",
    nodeIds: ["evidence-exposure", "evidence-postings", "evidence-case", "evidence-commentary", "evidence-counter"],
    revealStage: 4,
  },
  {
    id: "step-5",
    text: "我发现证据最多支持“可能影响”，不能支持“导致”，所以需要降强度。",
    nodeIds: ["license-causal", "rewrite-final"],
    revealStage: 5,
  },
];
