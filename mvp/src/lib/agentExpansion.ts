import type { CanvasNode } from "../data/reasoningCanvas";
import { caseIntakePrimaryText, type CaseIntake } from "./caseIntake";
import type { SherlockSearchRequest, SherlockSearchResponse } from "./sherlockStyleSearch";
import type { MemoryCandidate, MemoryCandidateStatus } from "./agentRuntime/memoryCandidateTypes";
import type { AgentEvidenceBundle } from "./schemas";
import type { AgentContract } from "./agentConfigs";
import { getTraceCollector, type TraceStatus } from "./reasoningTrace";
import type {
  ConsensusDebateUpdate,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "./agentOrchestrationTypes";
export type {
  ConsensusDebateRound,
  ConsensusDebateUpdate,
  ExecutionDagClaimType,
  ExecutionDagEdge,
  ExecutionDagNode,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "./agentOrchestrationTypes";
export type { SherlockSearchResponse } from "./sherlockStyleSearch";
export { request360Search } from "./search360";
export type { Search360Request, Search360Response, Search360Source } from "./schemas";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export type ExpansionMode = "search" | "evidence_audit" | "counter" | "rewrite" | "rumor_check";

export interface AgentExpansionRequest {
  claim: string;
  node: Pick<CanvasNode, "id" | "type" | "title" | "subtitle" | "status">;
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
  resultStatus: NonNullable<CanvasNode["status"]>;
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
  seedNode: Pick<CanvasNode, "id" | "type" | "title" | "subtitle" | "status">;
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

// ───────────────────────────────────────────────────────────────
// 多 Agent Handoff Orchestrate
// ───────────────────────────────────────────────────────────────

export interface HandoffStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  agentContract?: AgentContract;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  evidenceBundle?: AgentEvidenceBundle;
  error?: string;
}

export interface HandoffResult {
  claim: string;
  steps: HandoffStep[];
  finalReport?: Record<string, unknown>;
}

export async function requestOrchestrate(claim: string): Promise<HandoffResult> {
  try {
    const response = await fetch(`${API_BASE}/api/agent/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim }),
    });

    const data = (await response.json().catch(() => null)) as HandoffResult | { message?: string } | null;

    if (!response.ok) {
      const message = data && "message" in data && data.message ? data.message : `HTTP ${response.status}`;
      throw new Error(`Orchestrate API 失败：${message}`);
    }

    return data as HandoffResult;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Orchestrate API 调用异常");
  }
}

export interface OrchestrateStreamEvent {
  type:
    | "planner_update"
    | "speculative_update"
    | "consensus_debate_round"
    | "consensus_debate_final"
    | "agent_start"
    | "agent_complete"
    | "agent_error"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "complete"
    | "error";
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  agentContract?: AgentContract;
  toolName?: string;
  query?: string;
  result?: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidenceBundle?: AgentEvidenceBundle;
  model?: string;
  latencyMs?: number;
  steps?: HandoffStep[];
  finalReport?: Record<string, unknown>;
  plan?: ExecutionDagPlan;
  relay?: SpeculativeRelayUpdate;
  debate?: ConsensusDebateUpdate;
  followUpQueue?: unknown[];
  memoryCandidates?: MemoryCandidate[];
  totalLatencyMs?: number;
  sessionId?: string;
  claim?: string;
  error?: string;
  message?: string;
  timestamp?: number;
}

export async function* requestOrchestrateStream(
  input: string | CaseIntake,
  memoryRecall?: Record<string, unknown>,
  modelChoice?: Record<string, { provider: string; model: string }>
): AsyncGenerator<OrchestrateStreamEvent> {
  const claim = typeof input === "string" ? input : caseIntakePrimaryText(input);
  const payload: Record<string, unknown> = typeof input === "string" ? { claim } : { claim, intake: input };
  if (memoryRecall) payload.memoryRecall = memoryRecall;
  if (modelChoice && Object.keys(modelChoice).length > 0) payload.modelChoice = modelChoice;

  // v2-iteration 2026-07-04: PR-3 Site B (peer spec) — emit trace per SSE event.
  // 不修改 AgentRuntime.ts,此函数作为 SSE adapter 接入 trace collector。
  const trace = getTraceCollector();
  const traceSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  trace.setSessionId(traceSessionId);

  const emitTraceFromEvent = (event: OrchestrateStreamEvent) => {
    const status: TraceStatus =
      event.type === "agent_complete" || event.type === "tool_result" || event.type === "complete"
        ? "completed"
        : event.type === "agent_error" || event.type === "tool_error" || event.type === "error"
        ? "failed"
        : "running";
    trace.emit({
      sessionId: traceSessionId,
      agent: event.agent ?? event.toolName ?? event.agentName ?? "planner",
      action: event.type,
      status,
      timestamp: Date.now(),
      latencyMs: event.latencyMs,
      meta: {
        query: event.query,
        model: event.model,
      },
    });
  };

  try {
    const response = await fetch(`${API_BASE}/api/agent/orchestrate-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      yield { type: "error", message: `Orchestrate Stream API 失败：HTTP ${response.status}` };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as OrchestrateStreamEvent;
              emitTraceFromEvent(data);
              yield data;
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      }

      // 处理缓冲区中剩余的内容
      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6)) as OrchestrateStreamEvent;
          emitTraceFromEvent(data);
          yield data;
        } catch {
          // 忽略
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orchestrate Stream API 调用异常";
    trace.emit({
      sessionId: traceSessionId,
      agent: "transport",
      action: "stream_error",
      status: "failed",
      timestamp: Date.now(),
      meta: { message },
    });
    yield { type: "error", message };
  }
}

export async function updateMemoryCandidateStatus(
  id: string,
  status: MemoryCandidateStatus,
  reason?: string
): Promise<MemoryCandidate> {
  const response = await fetch(`${API_BASE}/api/agent/memory-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setStatus", id, status, reason }),
  });
  const data = (await response.json().catch(() => null)) as { candidate?: MemoryCandidate; message?: string } | null;
  if (!response.ok || !data?.candidate) {
    throw new Error(data?.message ?? `Memory Candidate API 失败：HTTP ${response.status}`);
  }
  return data.candidate;
}

export async function requestAgentExpansion(payload: AgentExpansionRequest): Promise<AgentExpansionResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/agent/expand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as AgentExpansionResponse | { message?: string } | null;

    if (!response.ok) {
      const message = data && "message" in data && data.message ? data.message : `HTTP ${response.status}`;
      throw new Error(`Agent Expansion API 失败：${message}`);
    }

    return data as AgentExpansionResponse;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Agent Expansion API 调用异常");
  }
}

export async function requestRecursiveSearch(payload: RecursiveSearchRequest): Promise<RecursiveSearchResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/agent/recursive-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as RecursiveSearchResponse | { message?: string } | null;

    if (!response.ok) {
      const message = data && "message" in data && data.message ? data.message : `HTTP ${response.status}`;
      throw new Error(`Recursive Search API 失败：${message}`);
    }

    return data as RecursiveSearchResponse;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Recursive Search API 调用异常");
  }
}

export async function requestSherlockSearch(payload: SherlockSearchRequest): Promise<SherlockSearchResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/agent/sherlock-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as SherlockSearchResponse | { message?: string } | null;

    if (!response.ok) {
      const message = data && "message" in data && data.message ? data.message : `HTTP ${response.status}`;
      throw new Error(`Sherlock Search API 失败：${message}`);
    }

    return data as SherlockSearchResponse;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Sherlock Search API 调用异常");
  }
}
