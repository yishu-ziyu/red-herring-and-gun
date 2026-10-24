// 公开 SSE 事件与接口返回的形状（对照 apps/server/src/http/publicStream.ts、handlers.ts、pipelineEvents.ts）。
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema.ts";
import type { PublicActivity } from "@shared/investigation/activity.ts";

export type { InvestigationSnapshotV1, PublicActivity };
export type { InvestigationClaim, InvestigationSource } from "@shared/investigation/schema.ts";

export type StreamEvent = {
  type: string;
  timestamp?: number;
  eventSeq?: number;
  runId?: string;
  [key: string]: unknown;
};

/** GET /api/investigations/:runId/result 的形状。report 里有 _verdictDecision 与 citationSources。 */
export type RunResult = {
  runId: string;
  resultId?: string;
  revision?: number;
  snapshot: InvestigationSnapshotV1;
  report: Record<string, unknown> | null;
  createdAt?: number;
};

export type FixtureMeta = {
  fixture: string;
  runId: string;
  claim: string;
  status: string;
  createdAt: number;
  label?: string | null;
};

export type Fixture = { meta: FixtureMeta; events: StreamEvent[]; result: RunResult };

/** GET /api/investigations 每一条。 */
export type HistoryEntry = {
  runId: string;
  claim: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
};
