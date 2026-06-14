import type { MemoryCandidate } from "./memoryCandidateTypes";
import type {
  ConsensusDebateUpdate,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "../agentOrchestrationTypes";

export type AgentRuntimePhase =
  | "intake"
  | "memory_recall"
  | "agent"
  | "tool"
  | "handoff"
  | "report"
  | "memory_write"
  | "complete"
  | "error";

export type AgentToolRiskLevel = "read" | "write" | "publish";

export interface SteeringMessage {
  id: string;
  content: string;
  createdAt: number;
  consumedAt?: number;
}

export interface FollowUpTask {
  id: string;
  title: string;
  reason: string;
  status: "pending" | "running" | "completed" | "blocked";
  createdAt: number;
}

export interface AgentSession {
  id: string;
  claim: string;
  createdAt: number;
  steeringQueue: SteeringMessage[];
  followUpQueue: FollowUpTask[];
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  kind: "llm" | "search" | "vision" | "fetch" | "memory" | "report" | "canvas";
  riskLevel: AgentToolRiskLevel;
  requiresAuth: boolean;
  provider?: string;
}

export interface AgentRuntimeEvent {
  type:
    | "agent_start"
    | "agent_complete"
    | "agent_error"
    | "planner_update"
    | "speculative_update"
    | "consensus_debate_round"
    | "consensus_debate_final"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "complete"
    | "error";
  timestamp: number;
  phase?: AgentRuntimePhase;
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  agentContract?: unknown;
  toolId?: string;
  toolName?: string;
  query?: string;
  model?: string;
  output?: unknown;
  result?: unknown;
  evidenceBundle?: unknown;
  error?: string;
  claim?: string;
  sessionId?: string;
  steps?: unknown[];
  finalReport?: unknown;
  plan?: ExecutionDagPlan;
  relay?: SpeculativeRelayUpdate;
  debate?: ConsensusDebateUpdate;
  followUpQueue?: FollowUpTask[];
  memoryCandidates?: MemoryCandidate[];
  totalLatencyMs?: number;
  latencyMs?: number;
}
