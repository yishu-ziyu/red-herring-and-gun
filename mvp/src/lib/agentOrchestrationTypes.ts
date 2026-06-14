export type ExecutionDagClaimType = "causal" | "concept" | "event" | "mixed";

export type ExecutionDagNodeStatus = "planned" | "running" | "completed" | "blocked";

export interface ExecutionDagNode {
  id: string;
  label: string;
  agent?: string;
  layer: "planner" | "analysis" | "search" | "audit" | "debate" | "report";
  status: ExecutionDagNodeStatus;
  description: string;
}

export interface ExecutionDagEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ExecutionDagPlan {
  id: string;
  claimType: ExecutionDagClaimType;
  rationale: string;
  nodes: ExecutionDagNode[];
  edges: ExecutionDagEdge[];
  criticalPath: string[];
}

export interface SpeculativeRelayUpdate {
  id: string;
  title: string;
  upstream: string;
  downstream: string;
  trigger: string;
  status: "queued" | "running" | "completed";
  savedReason: string;
  confidence: "low" | "medium" | "high";
}

export interface ConsensusDebateRound {
  challenger: string;
  respondent: string;
  challenge: string;
  response: string;
}

export interface ConsensusDebateUpdate {
  id: string;
  status: "not_needed" | "running" | "resolved";
  title: string;
  conflictCount: number;
  rounds: ConsensusDebateRound[];
  finalConsensus: string;
  confidenceAdjustment: number;
}
