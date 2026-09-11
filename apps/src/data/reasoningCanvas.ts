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

