import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";
import type { PublicActivity } from "@shared/investigation/activity";
import type { VerdictRecord } from "@shared/domain/decision";

/** 公开 SSE 帧（apps/server/src/http/publicStream.ts 清洗后）。只列界面会读的字段。 */
export type StreamEvent = {
  type: string;
  eventSeq?: number;
  timestamp?: number;
  runId?: string;
  // agent_*
  agent?: string;
  content?: string;
  done?: boolean;
  output?: Record<string, unknown>;
  error?: string;
  // tool_* / search_progress
  toolName?: string;
  query?: string;
  atom?: string;
  phase?: string;
  result?: Record<string, unknown>;
  sources?: Array<{ title?: string; url?: string }>;
  // investigation_*
  investigation?: InvestigationSnapshotV1;
  activity?: PublicActivity;
  // run_state
  status?: string;
  terminal?: boolean;
  message?: string;
  code?: string;
  [key: string]: unknown;
};

/** 一次核查在前端的全部材料：快照、判定记录（规则表）、事件流、活动。 */
export type RunData = {
  runId: string;
  fixture?: string;
  status: string;
  createdAt: number;
  snapshot: InvestigationSnapshotV1 | null;
  verdictDecision: (VerdictRecord & { parts: VerdictRecord["parts"] }) | null;
  events: StreamEvent[];
  activities: PublicActivity[];
};

export type HistoryEntry = {
  runId: string;
  fixture?: string;
  claim: string;
  label: string | null;
  createdAt: number;
  status: string;
};
