/**
 * streamingTypes.ts — 流式推理面板共享类型
 *
 * 前后端共用：前端组件 + Mock 数据生成器
 */

export type StageStatus = "pending" | "running" | "completed" | "error";

export type ChunkType = "thought" | "action" | "result" | "divider" | "tool_call";

export interface StreamingChunk {
  id: string;
  type: ChunkType;
  content: string;
  timestamp: number;
}

export interface StreamingStage {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  status: StageStatus;
  agentName: string;
  agentIcon: string;
  chunks: StreamingChunk[];
  startTime?: number;
  endTime?: number;
}

export interface StreamingReasoningSession {
  sessionId: string;
  claim: string;
  stages: StreamingStage[];
  overallStatus: "idle" | "running" | "completed" | "error";
  currentStageId: string | null;
  source: "mock" | "runtime";
  sourceLabel: string;
}

export type StreamEvent =
  | { type: "stage_start"; stageId: string; nameZh: string; agentName: string }
  | { type: "content_chunk"; stageId: string; chunk: StreamingChunk }
  | { type: "stage_end"; stageId: string; status: StageStatus }
  | { type: "session_complete"; timestamp: number };

export type StreamEventHandler = (event: StreamEvent) => void;
