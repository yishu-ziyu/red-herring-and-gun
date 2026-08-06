/**
 * missionShell/types.ts
 *
 * Ant Design X–shaped process model for Mission Control.
 * Independent of @ant-design/x package imports so Phase 0 stays pure.
 * Phase 1 maps these fields onto ThoughtChain / Bubble / Tool UI props.
 */

export type ShellNodeStatus = "pending" | "loading" | "success" | "error";

/** ThoughtChain-like step (Ant Design X ThoughtChain item) */
export interface ShellThoughtItem {
  key: string;
  title: string;
  description?: string;
  status: ShellNodeStatus;
  /** agent | tool | planner | debate | review | report */
  kind: "agent" | "tool" | "planner" | "debate" | "review" | "report" | "relay";
  agentId?: string;
  toolId?: string;
  timestamp?: number;
  /** Extra payload for right-rail drill-in */
  detail?: Record<string, unknown>;
}

/** Tool strip row (ToolUseBar-like) */
export interface ShellToolItem {
  key: string;
  toolId?: string;
  toolName: string;
  title: string;
  detail?: string;
  status: ShellNodeStatus;
  query?: string;
  result?: Record<string, unknown>;
  timestamp?: number;
}

/** Agent cluster chip (Kimi-style person × task) */
export interface ShellAgentChip {
  agentId: string;
  name: string;
  status: ShellNodeStatus;
  icon?: string;
  summary?: string;
}

/** Final verdict card when complete */
export interface ShellVerdictCard {
  present: boolean;
  verdictType?: string;
  conclusion?: string;
  credibilityScore?: number;
  reviewPassed?: boolean;
  reviewScore?: number;
  reviewIssues?: Array<{ code: string; severity: string; message: string }>;
}

export interface MissionShellModel {
  claim: string;
  phaseLabel: string;
  thoughtItems: ShellThoughtItem[];
  tools: ShellToolItem[];
  agents: ShellAgentChip[];
  verdict: ShellVerdictCard;
  /** true while stream has not completed */
  live: boolean;
  errorMessage?: string;
}
