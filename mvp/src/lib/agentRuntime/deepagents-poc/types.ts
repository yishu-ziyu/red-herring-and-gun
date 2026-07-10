/**
 * deepagents-poc/types.ts
 *
 * Core types for the React Agent pattern PoC.
 * Mirrors the existing RumorDetector output contract.
 */

// ── Agent Tool ──────────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ── Tool Call / Response (LangChain-compatible shape) ──────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface AgentStep {
  messages: AgentMessage[];
  toolCalls?: ToolCall[];
  toolResults?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

// ── LLM Interface (the abstraction point for deepagents.js) ────

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: "end_turn" | "tool_use";
}

export interface MockLLM {
  invoke(messages: AgentMessage[]): Promise<LLMResponse>;
}

// ── RumorDetector Output (same as agentConfigs.ts) ─────────────

export interface RumorDetectorOutput {
  claimAtoms: string[];
  rumorTypes: string[];
  rumorIndicators: string[];
  severity: "low" | "medium" | "high";
  analysis: string;
  detectedPatterns: string[];
  neededEvidence: string[];
  handoffTargets: string[];
}
