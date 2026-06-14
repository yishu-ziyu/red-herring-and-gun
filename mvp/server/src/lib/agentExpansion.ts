import type { SherlockSearchRequest, SherlockSearchResponse } from "./sherlockStyleSearch";
export type { SherlockSearchResponse } from "./sherlockStyleSearch";

type CanvasNodeStatus = "risk" | "active" | "supported" | "limited" | "blocked" | "rewrite";

interface CanvasNodeSummary {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  status?: CanvasNodeStatus;
}

export type ExpansionMode = "search" | "evidence_audit" | "counter" | "rewrite" | "rumor_check";

export interface AgentExpansionRequest {
  claim: string;
  node: Pick<CanvasNodeSummary, "id" | "type" | "title" | "subtitle" | "status">;
  mode: ExpansionMode;
  prompt: string;
  visibleNodeTitles: string[];
}

export interface AgentExpansionResponse {
  controllerNote: string;
  agentTitle: string;
  agentSubtitle: string;
  resultTitle: string;
  resultSubtitle: string;
  resultStatus: CanvasNodeStatus;
  traceText: string;
  inspectorSummary: string;
  canSay: string[];
  cannotSay: string[];
  sources: string[];
  model: string;
  agentType?: "rumor_detector" | "fact_checker" | "source_validator" | "evidence_grader" | "report_composer";
  rumorIndicators?: string[];
}

export interface EvidenceClue {
  id: string;
  title: string;
  summary: string;
  source: string;
  role: "support" | "limit" | "counter" | "context" | "lead";
  confidence: "low" | "medium" | "high";
}

export interface SearchFrontierItem {
  id: string;
  title: string;
  reasonToContinue: string;
  nextQuestion: string;
  estimatedValue: "low" | "medium" | "high";
}

export interface SearchStoppedItem {
  id: string;
  title: string;
  reason: "duplicate" | "budget" | "low_confidence" | "out_of_scope";
}

export interface RecursiveSearchRequest {
  claim: string;
  seedNode: Pick<CanvasNodeSummary, "id" | "type" | "title" | "subtitle" | "status">;
  question: string;
  depthLimit: number;
  budgetLimit: number;
  visibleNodeTitles: string[];
  existingSources: string[];
}

export interface RecursiveSearchResponse {
  controllerNote: string;
  runTitle: string;
  traceText: string;
  clues: EvidenceClue[];
  frontier: SearchFrontierItem[];
  stopped: SearchStoppedItem[];
  canSay: string[];
  cannotSay: string[];
  model: string;
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

export interface OrchestrateResponse {
  claim: string;
  steps: HandoffStep[];
  finalReport?: Record<string, unknown>;
}

export async function requestAgentExpansion(payload: AgentExpansionRequest): Promise<AgentExpansionResponse> {
  return {
    controllerNote: "Server fallback: no external expansion provider is configured.",
    agentTitle: "保守核查节点",
    agentSubtitle: payload.mode,
    resultTitle: payload.node.title || "待核查节点",
    resultSubtitle: "需要补充可靠来源后再判断。",
    resultStatus: "limited",
    traceText: "独立 server 使用保守 fallback，未调用浏览器端模块。",
    inspectorSummary: "当前 server 路径未配置外部扩展 provider。",
    canSay: ["可以继续收集来源", "可以标记为待核查"],
    cannotSay: ["不能仅凭当前材料下结论"],
    sources: [],
    model: "server-fallback",
  };
}

export async function requestRecursiveSearch(payload: RecursiveSearchRequest): Promise<RecursiveSearchResponse> {
  return {
    controllerNote: "Server fallback: recursive search provider is not configured.",
    runTitle: "保守递归搜索",
    traceText: `对「${payload.claim}」保守停止，等待真实搜索 provider。`,
    clues: [],
    frontier: [],
    stopped: [
      {
        id: "server-fallback",
        title: "缺少真实搜索 provider",
        reason: "out_of_scope",
      },
    ],
    canSay: ["可以继续配置搜索 provider"],
    cannotSay: ["不能把 fallback 当作事实证据"],
    model: "server-fallback",
  };
}

export async function requestSherlockSearch(payload: SherlockSearchRequest): Promise<SherlockSearchResponse> {
  return {
    controllerNote: "Server fallback: Sherlock search provider is not configured.",
    runTitle: "保守多平台搜索",
    traceText: `未对「${payload.claim}」执行真实平台搜索。`,
    hits: [],
    sourcesSearched: 0,
    sourcesMatched: 0,
    canSay: ["可以配置真实搜索 provider 后重试"],
    cannotSay: ["不能引用 fallback 作为来源"],
    model: "server-fallback",
  };
}
