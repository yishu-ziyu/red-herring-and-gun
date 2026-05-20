import type { CanvasNode } from "../data/reasoningCanvas";

export type ExpansionMode = "search" | "evidence_audit" | "counter" | "rewrite";

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
