import type { AgentRuntimeEvent, AgentRuntimePhase } from "./types";

function now() {
  return Date.now();
}

export function createToolStartEvent({
  toolId,
  toolName,
  query,
  phase = "tool",
}: {
  toolId?: string;
  toolName: string;
  query?: string;
  phase?: AgentRuntimePhase;
}): AgentRuntimeEvent {
  return {
    type: "tool_start",
    phase,
    toolId,
    toolName,
    query,
    timestamp: now(),
  };
}

export function createToolResultEvent({
  toolId,
  toolName,
  query,
  model,
  result,
  phase = "tool",
}: {
  toolId?: string;
  toolName: string;
  query?: string;
  model?: string;
  result?: unknown;
  phase?: AgentRuntimePhase;
}): AgentRuntimeEvent {
  return {
    type: "tool_result",
    phase,
    toolId,
    toolName,
    query,
    model,
    result,
    timestamp: now(),
  };
}

export function createToolErrorEvent({
  toolId,
  toolName,
  query,
  error,
  result,
  phase = "tool",
}: {
  toolId?: string;
  toolName: string;
  query?: string;
  error: string;
  result?: unknown;
  phase?: AgentRuntimePhase;
}): AgentRuntimeEvent {
  return {
    type: "tool_error",
    phase,
    toolId,
    toolName,
    query,
    error,
    result,
    timestamp: now(),
  };
}

export function createAgentStartEvent({
  agent,
  agentName,
  agentIcon,
  agentContract,
  model,
}: {
  agent: string;
  agentName: string;
  agentIcon?: string;
  agentContract?: unknown;
  model?: string;
}): AgentRuntimeEvent {
  return {
    type: "agent_start",
    phase: "agent",
    agent,
    agentName,
    agentIcon,
    agentContract,
    model,
    timestamp: now(),
  };
}

export function createAgentCompleteEvent({
  agent,
  agentName,
  agentIcon,
  agentContract,
  output,
  model,
  latencyMs,
  result,
  evidenceBundle,
}: {
  agent: string;
  agentName: string;
  agentIcon?: string;
  agentContract?: unknown;
  output?: unknown;
  model?: string;
  latencyMs?: number;
  result?: unknown;
  evidenceBundle?: unknown;
}): AgentRuntimeEvent {
  return {
    type: "agent_complete",
    phase: "agent",
    agent,
    agentName,
    agentIcon,
    agentContract,
    output,
    model,
    latencyMs,
    result,
    evidenceBundle,
    timestamp: now(),
  };
}

export function createAgentErrorEvent({
  agent,
  agentName,
  agentIcon,
  agentContract,
  error,
}: {
  agent: string;
  agentName: string;
  agentIcon?: string;
  agentContract?: unknown;
  error: string;
}): AgentRuntimeEvent {
  return {
    type: "agent_error",
    phase: "error",
    agent,
    agentName,
    agentIcon,
    agentContract,
    error,
    timestamp: now(),
  };
}
