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
  /** 模型真实 thinking 字段：逐条推理句子（来自 agent_thought 增量） */
  reasoning?: string[];
  /** 推理首次下发时间戳（ns），用于折叠时展示「Thought for Ns」 */
  reasoningStartedAt?: number;
  /** 推理持续时间（ms），推理结束时定格 */
  reasoningElapsedMs?: number;
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

/** Source line for verdict card (≤3 on hero) */
export interface ShellVerdictSource {
  title: string;
  url?: string;
}

/** 系统如何理解原句：原句 → 拆出的可核查原子命题（来自 rumor_detector） */
export interface ShellUnderstanding {
  claim: string;
  atoms: Array<{
    text: string;
    verifiable: boolean;
    type: string;
  }>;
}

/** Final verdict card when complete — first-screen decision payload */
export interface ShellVerdictCard {
  present: boolean;
  verdictType?: string;
  conclusion?: string;
  credibilityScore?: number;
  /** Explicit recommendation or derived share advice */
  shareAdvice?: string;
  /** Key findings chips (e.g. 外地素材拼接) */
  keyFindings?: string[];
  /** Up to 3 sources for the hero card */
  topSources?: ShellVerdictSource[];
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
  /** 系统把原句读成了哪些可核查命题（rumor_detector 拆分结果，一级可见） */
  understanding?: ShellUnderstanding;
  verdict: ShellVerdictCard;
  /** true while stream has not completed */
  live: boolean;
  errorMessage?: string;
}
