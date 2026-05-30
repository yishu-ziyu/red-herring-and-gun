/**
 * reasoningStore.ts — MVP v3 全局状态管理
 *
 * 设计决策：
 * - 使用 React Context + useReducer（不引入新依赖，保持轻量）
 * - 废弃旧版 revealStage 线性状态机，改用显式节点树 + 展开状态
 * - 所有状态更新遵循不可变原则（spread / map / filter）
 * - 评论和追加输入历史持久化到 LocalStorage
 */

import { createContext, useContext, useReducer, useEffect, type ReactNode } from "react";
import type {
  ClaimDiagnosis,
  FinalReport,
  DemoCase,
  ClaimDecompositionResult,
  MultiSearchJob,
  EvidenceConsensusReport,
} from "../lib/schemas";
import type { StreamingReasoningSession } from "../lib/streamingTypes";
import type { CanvasNode, CanvasEdge, ReasoningStep } from "../data/reasoningCanvas";
import type { EvidenceClue, ExpansionMode, SearchFrontierItem, SearchStoppedItem, HandoffStep } from "../lib/agentExpansion";
import type { VerificationResult } from "../lib/reportExporter";
import type { SourceHit } from "../lib/sherlockStyleSearch";

// ───────────────────────────────────────────────────────────────
// State Shape
// ───────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  nodeId: string;
  nodeTitle: string;
  mode: ExpansionMode;
  prompt: string;
  controllerNote: string;
  agents: string[];
  inspectorSummary: string;
  canSay: string[];
  cannotSay: string[];
  sources: string[];
  model: string;
  agentType?: "rumor_detector" | "fact_checker" | "source_validator" | "evidence_grader" | "report_composer";
}

export interface RecursiveSearchRun {
  id: string;
  nodeId: string;
  nodeTitle: string;
  question: string;
  depthLimit: number;
  budgetLimit: number;
  controllerNote: string;
  traceText: string;
  clues: EvidenceClue[];
  frontier: SearchFrontierItem[];
  stopped: SearchStoppedItem[];
  canSay: string[];
  cannotSay: string[];
  model: string;
}

export interface SherlockSearchRun {
  id: string;
  nodeId: string;
  nodeTitle: string;
  claim: string;
  controllerNote: string;
  traceText: string;
  hits: SourceHit[];
  sourcesSearched: number;
  sourcesMatched: number;
  canSay: string[];
  cannotSay: string[];
  model: string;
}

export interface HandoffRun {
  id: string;
  claim: string;
  steps: HandoffStep[];
  finalReport?: Record<string, unknown>;
  model: string;
  totalLatencyMs: number;
  timestamp: number;
}

export interface NodeComment {
  id: string;
  nodeId: string;
  text: string;
  createdAt: number;
}

export interface FollowUpEntry {
  id: string;
  text: string;
  nodeId: string;
  timestamp: number;
}

export interface ReasoningState {
  // 诊断
  diagnosis: ClaimDiagnosis | null;
  originalClaim: string;

  // 节点树（取代 revealStage 线性机）
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  expandedNodeIds: Set<string>;

  // 交互状态
  selectedNodeId: string | null;
  focusedNodeId: string | null; // 路径聚焦目标
  isFocusMode: boolean;

  // Agent 运行状态
  agentRuns: AgentRun[];
  recursiveSearchRuns: RecursiveSearchRun[];
  sherlockSearchRuns: SherlockSearchRun[];
  handoffRuns: HandoffRun[];
  currentHandoffRun: HandoffRun | null;
  isExpanding: boolean;
  agentError: string;
  expansionPrompt: string;
  expansionMode: ExpansionMode;
  recursiveSearchPrompt: string;
  recursiveDepthLimit: number;
  recursiveBudgetLimit: number;

  // Trace
  traceSteps: ReasoningStep[];
  activeStepId: string | null;

  // 结论（实时计算缓存）
  report: FinalReport | null;
  exploredSubclaimCount: number;
  totalSubclaimCount: number;

  // 评论系统
  comments: NodeComment[];

  // 追加输入历史
  followUps: FollowUpEntry[];

  // 核查结果标记
  verificationResult: VerificationResult | null;

  // 多搜索引擎交叉验证（新增）
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;

  // 流式推理过程（新增）
  streamingSession: StreamingReasoningSession | null;
  isStreaming: boolean;
}

// ───────────────────────────────────────────────────────────────
// Initial State
// ───────────────────────────────────────────────────────────────

export const initialState: ReasoningState = {
  diagnosis: null,
  originalClaim: "",
  nodes: [],
  edges: [],
  expandedNodeIds: new Set(),
  selectedNodeId: null,
  focusedNodeId: null,
  isFocusMode: false,
  agentRuns: [],
  recursiveSearchRuns: [],
  sherlockSearchRuns: [],
  handoffRuns: [],
  currentHandoffRun: null,
  isExpanding: false,
  agentError: "",
  expansionPrompt: "我想沿这个节点继续追问：它还需要哪些证据？",
  expansionMode: "evidence_audit",
  recursiveSearchPrompt: "从这个节点继续找证据线索，并给出下一批可选择的 frontier。",
  recursiveDepthLimit: 1,
  recursiveBudgetLimit: 4,
  traceSteps: [],
  activeStepId: null,
  report: null,
  exploredSubclaimCount: 0,
  totalSubclaimCount: 0,
  comments: [],
  followUps: [],
  verificationResult: null,

  // 多搜索引擎交叉验证（新增）
  claimDecomposition: null,
  searchJobs: [],
  consensusReport: null,

  // 流式推理过程（新增）
  streamingSession: null,
  isStreaming: false,
};

// ───────────────────────────────────────────────────────────────
// Actions
// ───────────────────────────────────────────────────────────────

export type ReasoningAction =
  | { type: "INIT_CASE"; payload: { caseData: DemoCase; report: FinalReport; nodes: CanvasNode[]; edges: CanvasEdge[]; steps: ReasoningStep[] } }
  | { type: "SELECT_NODE"; payload: { nodeId: string } }
  | { type: "TOGGLE_EXPAND_NODE"; payload: { nodeId: string } }
  | { type: "ENTER_FOCUS_MODE"; payload: { nodeId: string } }
  | { type: "EXIT_FOCUS_MODE" }
  | { type: "SET_FOCUS_TARGET"; payload: { nodeId: string | null } }
  | { type: "ADD_NODES"; payload: { nodes: CanvasNode[]; edges: CanvasEdge[]; run: AgentRun; step: ReasoningStep } }
  | { type: "ADD_RECURSIVE_NODES"; payload: { nodes: CanvasNode[]; edges: CanvasEdge[]; run: RecursiveSearchRun; step: ReasoningStep } }
  | { type: "ADD_SHERLOCK_RUN"; payload: { nodes: CanvasNode[]; edges: CanvasEdge[]; run: SherlockSearchRun; step: ReasoningStep } }
  | { type: "ADD_HANDOFF_RUN"; payload: { run: HandoffRun; nodes?: CanvasNode[]; edges?: CanvasEdge[]; step?: ReasoningStep } }
  | { type: "SET_EXPANSION_PROMPT"; payload: string }
  | { type: "SET_EXPANSION_MODE"; payload: ExpansionMode }
  | { type: "SET_RECURSIVE_SEARCH_PROMPT"; payload: string }
  | { type: "SET_RECURSIVE_DEPTH_LIMIT"; payload: number }
  | { type: "SET_RECURSIVE_BUDGET_LIMIT"; payload: number }
  | { type: "START_EXPANDING" }
  | { type: "FINISH_EXPANDING"; payload: { error?: string } }
  | { type: "SELECT_STEP"; payload: { stepId: string; nodeIds: string[] } }
  | { type: "ADD_COMMENT"; payload: NodeComment }
  | { type: "DELETE_COMMENT"; payload: { commentId: string } }
  | { type: "ADD_FOLLOW_UP"; payload: FollowUpEntry }
  | { type: "SET_VERIFICATION_RESULT"; payload: VerificationResult }
  | { type: "START_HANDOFF_STREAM"; payload: { claim: string } }
  | { type: "APPEND_HANDOFF_STEP"; payload: HandoffStep }
  | { type: "SET_HANDOFF_FINAL_REPORT"; payload: { finalReport?: Record<string, unknown>; totalLatencyMs: number; model: string } }
  | { type: "COMPLETE_HANDOFF_STREAM"; payload: { error?: string } }
  | { type: "RESET" }
  // 多搜索引擎交叉验证（新增）
  | { type: "SET_CLAIM_DECOMPOSITION"; payload: ClaimDecompositionResult }
  | { type: "SET_SEARCH_JOBS"; payload: MultiSearchJob[] }
  | { type: "UPDATE_SEARCH_TASK"; payload: { jobId: string; provider: string; result: import("../lib/schemas").SearchProviderResult } }
  | { type: "SET_CONSENSUS_REPORT"; payload: EvidenceConsensusReport }
  | { type: "LOAD_CONSENSUS_DEMO"; payload: { decomposition: ClaimDecompositionResult; searchJobs: MultiSearchJob[]; consensusReport: EvidenceConsensusReport } }
  | { type: "RESET_CONSENSUS" }
  // 流式推理过程（新增）
  | { type: "START_STREAMING_SESSION"; payload: StreamingReasoningSession }
  | { type: "UPDATE_STREAMING_STAGE"; payload: { stageId: string; status: import("../lib/streamingTypes").StageStatus } }
  | { type: "APPEND_STREAMING_CHUNK"; payload: { stageId: string; chunk: import("../lib/streamingTypes").StreamingChunk } }
  | { type: "END_STREAMING_SESSION" };

// ───────────────────────────────────────────────────────────────
// Reducer
// ───────────────────────────────────────────────────────────────

function reducer(state: ReasoningState, action: ReasoningAction): ReasoningState {
  switch (action.type) {
    case "INIT_CASE": {
      const { caseData, report, nodes, edges, steps } = action.payload;
      return {
        ...state,
        diagnosis: caseData.diagnosis,
        originalClaim: caseData.originalClaim,
        nodes,
        edges,
        traceSteps: steps,
        report,
        totalSubclaimCount: caseData.subclaims.length,
        exploredSubclaimCount: 0,
        selectedNodeId: nodes[0]?.id ?? null,
      };
    }

    case "SELECT_NODE": {
      return { ...state, selectedNodeId: action.payload.nodeId };
    }

    case "TOGGLE_EXPAND_NODE": {
      const next = new Set(state.expandedNodeIds);
      if (next.has(action.payload.nodeId)) {
        next.delete(action.payload.nodeId);
      } else {
        next.add(action.payload.nodeId);
      }
      return { ...state, expandedNodeIds: next };
    }

    case "ENTER_FOCUS_MODE": {
      return {
        ...state,
        isFocusMode: true,
        focusedNodeId: action.payload.nodeId,
        selectedNodeId: action.payload.nodeId,
      };
    }

    case "EXIT_FOCUS_MODE": {
      return { ...state, isFocusMode: false, focusedNodeId: null };
    }

    case "SET_FOCUS_TARGET": {
      return { ...state, focusedNodeId: action.payload.nodeId };
    }

    case "ADD_NODES": {
      const { nodes, edges, run, step } = action.payload;
      // Auto-select the last newly added node (typically the result node)
      const lastNewNode = nodes[nodes.length - 1];
      return {
        ...state,
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...edges],
        agentRuns: [...state.agentRuns, run],
        traceSteps: [...state.traceSteps, step],
        activeStepId: step.id,
        selectedNodeId: lastNewNode?.id ?? state.selectedNodeId,
        exploredSubclaimCount: state.exploredSubclaimCount + 1,
        isExpanding: false,
        agentError: "",
      };
    }

    case "ADD_RECURSIVE_NODES": {
      const { nodes, edges, run, step } = action.payload;
      const frontierNode = nodes.find((node) => node.type === "search_frontier");
      const lastNewNode = frontierNode ?? nodes[nodes.length - 1];
      return {
        ...state,
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...edges],
        recursiveSearchRuns: [...state.recursiveSearchRuns, run],
        traceSteps: [...state.traceSteps, step],
        activeStepId: step.id,
        selectedNodeId: lastNewNode?.id ?? state.selectedNodeId,
        exploredSubclaimCount: state.exploredSubclaimCount + 1,
        isExpanding: false,
        agentError: "",
      };
    }

    case "ADD_SHERLOCK_RUN": {
      const { nodes, edges, run, step } = action.payload;
      const lastNewNode = nodes[nodes.length - 1];
      return {
        ...state,
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...edges],
        sherlockSearchRuns: [...state.sherlockSearchRuns, run],
        traceSteps: [...state.traceSteps, step],
        activeStepId: step.id,
        selectedNodeId: lastNewNode?.id ?? state.selectedNodeId,
        exploredSubclaimCount: state.exploredSubclaimCount + 1,
        isExpanding: false,
        agentError: "",
      };
    }

    case "ADD_HANDOFF_RUN": {
      const { run, nodes = [], edges = [], step } = action.payload;
      const lastNewNode = nodes[nodes.length - 1];
      return {
        ...state,
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...edges],
        handoffRuns: [...state.handoffRuns, run],
        currentHandoffRun: null,
        traceSteps: step ? [...state.traceSteps, step] : state.traceSteps,
        activeStepId: step ? step.id : state.activeStepId,
        selectedNodeId: lastNewNode?.id ?? state.selectedNodeId,
        exploredSubclaimCount: state.exploredSubclaimCount + (nodes.length > 0 ? 1 : 0),
        isExpanding: false,
        agentError: "",
      };
    }

    case "SET_EXPANSION_PROMPT": {
      return { ...state, expansionPrompt: action.payload };
    }

    case "SET_EXPANSION_MODE": {
      return { ...state, expansionMode: action.payload };
    }

    case "SET_RECURSIVE_SEARCH_PROMPT": {
      return { ...state, recursiveSearchPrompt: action.payload };
    }

    case "SET_RECURSIVE_DEPTH_LIMIT": {
      return { ...state, recursiveDepthLimit: clampInteger(action.payload, 1, 3) };
    }

    case "SET_RECURSIVE_BUDGET_LIMIT": {
      return { ...state, recursiveBudgetLimit: clampInteger(action.payload, 1, 8) };
    }

    case "START_EXPANDING": {
      return { ...state, isExpanding: true, agentError: "" };
    }

    case "FINISH_EXPANDING": {
      return {
        ...state,
        isExpanding: false,
        agentError: action.payload.error ?? "",
      };
    }

    case "SELECT_STEP": {
      return {
        ...state,
        activeStepId: action.payload.stepId,
        selectedNodeId: action.payload.nodeIds[0] ?? state.selectedNodeId,
      };
    }

    case "ADD_COMMENT": {
      return { ...state, comments: [...state.comments, action.payload] };
    }

    case "DELETE_COMMENT": {
      return {
        ...state,
        comments: state.comments.filter((c) => c.id !== action.payload.commentId),
      };
    }

    case "ADD_FOLLOW_UP": {
      return { ...state, followUps: [...state.followUps, action.payload] };
    }

    case "SET_VERIFICATION_RESULT": {
      return { ...state, verificationResult: action.payload };
    }

    case "START_HANDOFF_STREAM": {
      return {
        ...state,
        isExpanding: true,
        agentError: "",
        currentHandoffRun: {
          id: `handoff-stream-${Date.now()}`,
          claim: action.payload.claim,
          steps: [],
          model: "",
          totalLatencyMs: 0,
          timestamp: Date.now(),
        },
      };
    }

    case "APPEND_HANDOFF_STEP": {
      if (!state.currentHandoffRun) return state;
      const existingIndex = state.currentHandoffRun.steps.findIndex(
        (s) => s.agent === action.payload.agent
      );
      let newSteps: HandoffStep[];
      if (existingIndex >= 0) {
        newSteps = state.currentHandoffRun.steps.map((s, i) =>
          i === existingIndex ? action.payload : s
        );
      } else {
        newSteps = [...state.currentHandoffRun.steps, action.payload];
      }
      return {
        ...state,
        currentHandoffRun: {
          ...state.currentHandoffRun,
          steps: newSteps,
        },
      };
    }

    case "SET_HANDOFF_FINAL_REPORT": {
      if (!state.currentHandoffRun) return state;
      return {
        ...state,
        currentHandoffRun: {
          ...state.currentHandoffRun,
          finalReport: action.payload.finalReport,
          totalLatencyMs: action.payload.totalLatencyMs,
          model: action.payload.model,
        },
      };
    }

    case "COMPLETE_HANDOFF_STREAM": {
      if (state.currentHandoffRun && state.currentHandoffRun.steps.length > 0) {
        return {
          ...state,
          handoffRuns: [...state.handoffRuns, state.currentHandoffRun],
          currentHandoffRun: null,
          isExpanding: false,
          agentError: action.payload.error ?? "",
        };
      }
      return {
        ...state,
        currentHandoffRun: null,
        isExpanding: false,
        agentError: action.payload.error ?? "",
      };
    }

    // 多搜索引擎交叉验证（新增）
    case "SET_CLAIM_DECOMPOSITION": {
      return { ...state, claimDecomposition: action.payload };
    }

    case "SET_SEARCH_JOBS": {
      return { ...state, searchJobs: action.payload };
    }

    case "UPDATE_SEARCH_TASK": {
      const { jobId, provider, result } = action.payload;
      return {
        ...state,
        searchJobs: state.searchJobs.map((job) =>
          job.jobId === jobId
            ? {
                ...job,
                searchTasks: job.searchTasks.map((task) =>
                  task.provider === provider ? { ...task, status: "completed" as const, result } : task
                ),
              }
            : job
        ),
      };
    }

    case "SET_CONSENSUS_REPORT": {
      return { ...state, consensusReport: action.payload };
    }

    case "LOAD_CONSENSUS_DEMO": {
      return {
        ...state,
        originalClaim: action.payload.decomposition.originalClaim,
        claimDecomposition: action.payload.decomposition,
        searchJobs: action.payload.searchJobs,
        consensusReport: action.payload.consensusReport,
      };
    }

    case "RESET_CONSENSUS": {
      return {
        ...state,
        claimDecomposition: null,
        searchJobs: [],
        consensusReport: null,
      };
    }

    case "START_STREAMING_SESSION": {
      return {
        ...state,
        streamingSession: {
          ...action.payload,
          overallStatus: "running",
        },
        isStreaming: true,
      };
    }

    case "UPDATE_STREAMING_STAGE": {
      if (!state.streamingSession) return state;
      return {
        ...state,
        streamingSession: {
          ...state.streamingSession,
          currentStageId: action.payload.status === "running"
            ? action.payload.stageId
            : state.streamingSession.currentStageId === action.payload.stageId
              ? null
              : state.streamingSession.currentStageId,
          stages: state.streamingSession.stages.map((stage) =>
            stage.id === action.payload.stageId
              ? { ...stage, status: action.payload.status }
              : stage
          ),
        },
      };
    }

    case "APPEND_STREAMING_CHUNK": {
      if (!state.streamingSession) return state;
      return {
        ...state,
        streamingSession: {
          ...state.streamingSession,
          stages: state.streamingSession.stages.map((stage) =>
            stage.id === action.payload.stageId
              ? { ...stage, chunks: [...stage.chunks, action.payload.chunk] }
              : stage
          ),
        },
      };
    }

    case "END_STREAMING_SESSION": {
      if (!state.streamingSession) return state;
      return {
        ...state,
        streamingSession: {
          ...state.streamingSession,
          overallStatus: "completed" as const,
        },
        isStreaming: false,
      };
    }

    case "RESET": {
      // 保留评论和追加输入（持久化数据），其余重置
      return {
        ...initialState,
        comments: state.comments,
        followUps: state.followUps,
      };
    }

    default:
      return state;
  }
}

// ───────────────────────────────────────────────────────────────
// Context
// ───────────────────────────────────────────────────────────────

interface ReasoningContextValue {
  state: ReasoningState;
  dispatch: React.Dispatch<ReasoningAction>;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

// ───────────────────────────────────────────────────────────────
// Provider
// ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "reasoning-v3-comments";
const FOLLOW_UP_KEY = "reasoning-v3-followups";

export function ReasoningProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 从 LocalStorage 恢复评论和追加输入
  useEffect(() => {
    try {
      const rawComments = localStorage.getItem(STORAGE_KEY);
      const rawFollowUps = localStorage.getItem(FOLLOW_UP_KEY);
      if (rawComments) {
        const parsed: NodeComment[] = JSON.parse(rawComments);
        parsed.forEach((c) => dispatch({ type: "ADD_COMMENT", payload: c }));
      }
      if (rawFollowUps) {
        const parsed: FollowUpEntry[] = JSON.parse(rawFollowUps);
        parsed.forEach((f) => dispatch({ type: "ADD_FOLLOW_UP", payload: f }));
      }
    } catch {
      // 忽略解析错误
    }
  }, []);

  // 持久化评论和追加输入
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.comments));
  }, [state.comments]);

  useEffect(() => {
    localStorage.setItem(FOLLOW_UP_KEY, JSON.stringify(state.followUps));
  }, [state.followUps]);

  return (
    <ReasoningContext.Provider value={{ state, dispatch }}>
      {children}
    </ReasoningContext.Provider>
  );
}

// ───────────────────────────────────────────────────────────────
// Hook
// ───────────────────────────────────────────────────────────────

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("useReasoning must be used within ReasoningProvider");
  }
  return context;
}

// ───────────────────────────────────────────────────────────────
// Selectors（派生状态计算）
// ───────────────────────────────────────────────────────────────

export function selectVisibleNodes(state: ReasoningState): CanvasNode[] {
  // v3 中所有节点默认可见，由展开状态控制子树渲染
  return state.nodes;
}

export function selectVisibleEdges(state: ReasoningState): CanvasEdge[] {
  return state.edges;
}

export function selectSelectedNode(state: ReasoningState): CanvasNode | undefined {
  return state.nodes.find((n) => n.id === state.selectedNodeId);
}

export function selectFocusedPath(state: ReasoningState): { nodeIds: string[]; edgeIds: string[] } {
  if (!state.focusedNodeId || !state.isFocusMode) {
    return { nodeIds: [], edgeIds: [] };
  }

  // BFS 向上追溯父节点，构建聚焦路径
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = [state.focusedNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (nodeIds.has(current)) continue;
    nodeIds.add(current);

    // 找指向 current 的边和源节点
    state.edges.forEach((edge) => {
      if (edge.to === current) {
        edgeIds.add(edge.id);
        queue.push(edge.from);
      }
    });
  }

  return {
    nodeIds: Array.from(nodeIds),
    edgeIds: Array.from(edgeIds),
  };
}

export function selectNodeComments(state: ReasoningState, nodeId: string): NodeComment[] {
  return state.comments.filter((c) => c.nodeId === nodeId);
}

export function selectLatestRunForNode(state: ReasoningState, nodeId: string): AgentRun | undefined {
  return [...state.agentRuns].reverse().find((r) => r.nodeId === nodeId);
}

export function selectLatestRecursiveRunForNode(state: ReasoningState, nodeId: string): RecursiveSearchRun | undefined {
  const selectedNode = state.nodes.find((node) => node.id === nodeId);
  const recursiveRunId = selectedNode?.sourceRef?.recursiveRunId;

  if (recursiveRunId) {
    return state.recursiveSearchRuns.find((run) => run.id === recursiveRunId);
  }

  return [...state.recursiveSearchRuns].reverse().find((run) => run.nodeId === nodeId);
}

export function selectLatestSherlockRunForNode(state: ReasoningState, nodeId: string): SherlockSearchRun | undefined {
  return [...state.sherlockSearchRuns].reverse().find((run) => run.nodeId === nodeId);
}

export function selectLatestHandoffRun(state: ReasoningState): HandoffRun | undefined {
  return state.handoffRuns[state.handoffRuns.length - 1];
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function selectConclusionProgress(state: ReasoningState): {
  explored: number;
  total: number;
  percentage: number;
} {
  const percentage = state.totalSubclaimCount > 0
    ? Math.round((state.exploredSubclaimCount / state.totalSubclaimCount) * 100)
    : 0;
  return {
    explored: state.exploredSubclaimCount,
    total: state.totalSubclaimCount,
    percentage,
  };
}
