import type { CanvasNode } from "../data/reasoningCanvas";
import type { SherlockSearchRequest, SherlockSearchResponse } from "./sherlockStyleSearch";

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
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

export interface HandoffResult {
  claim: string;
  steps: HandoffStep[];
  finalReport?: Record<string, unknown>;
}

export async function requestOrchestrate(claim: string): Promise<HandoffResult> {
  const response = await fetch("/api/agent/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  });

  const data = (await response.json().catch(() => null)) as HandoffResult | { message?: string } | null;

  if (!response.ok) {
    throw new Error(data && "message" in data && data.message ? data.message : `Orchestrate 调用失败：HTTP ${response.status}`);
  }

  return data as HandoffResult;
}

export interface OrchestrateStreamEvent {
  type: "agent_start" | "agent_complete" | "agent_error" | "complete" | "error";
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  output?: Record<string, unknown>;
  model?: string;
  latencyMs?: number;
  steps?: HandoffStep[];
  finalReport?: Record<string, unknown>;
  totalLatencyMs?: number;
  claim?: string;
  error?: string;
  message?: string;
  timestamp?: number;
}

export async function* requestOrchestrateStream(claim: string): AsyncGenerator<OrchestrateStreamEvent> {
  const response = await fetch("/api/agent/orchestrate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming 调用失败：HTTP ${response.status}`);
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
        yield data;
      } catch {
        // 忽略
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function requestAgentExpansion(payload: AgentExpansionRequest): Promise<AgentExpansionResponse> {
  const response = await fetch("/api/agent/expand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as AgentExpansionResponse | { message?: string } | null;

  if (!response.ok) {
    throw new Error(data && "message" in data && data.message ? data.message : `LLM 调用失败：HTTP ${response.status}`);
  }

  return data as AgentExpansionResponse;
}

export async function requestRecursiveSearch(payload: RecursiveSearchRequest): Promise<RecursiveSearchResponse> {
  const response = await fetch("/api/agent/recursive-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as RecursiveSearchResponse | { message?: string } | null;

  if (!response.ok) {
    throw new Error(data && "message" in data && data.message ? data.message : `递归搜索失败：HTTP ${response.status}`);
  }

  return data as RecursiveSearchResponse;
}

export async function requestSherlockSearch(payload: SherlockSearchRequest): Promise<SherlockSearchResponse> {
  const response = await fetch("/api/agent/sherlock-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as SherlockSearchResponse | { message?: string } | null;

  if (!response.ok) {
    throw new Error(data && "message" in data && data.message ? data.message : `Sherlock 搜索失败：HTTP ${response.status}`);
  }

  return data as SherlockSearchResponse;
}
