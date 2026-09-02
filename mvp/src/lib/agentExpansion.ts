import { caseIntakePrimaryText, type CaseIntake } from "./caseIntake";
import type { MemoryCandidate, MemoryCandidateStatus } from "./memoryCandidateTypes";
import type { AgentEvidenceBundle } from "./schemas";
import type { AgentContract } from "./agentConfigs";
import { getTraceCollector, type TraceStatus } from "./reasoningTrace";
import {
  checksExhaustedMessage,
  isChecksExhaustedMessage,
} from "./checkQuota";
import type {
  ConsensusDebateUpdate,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "./agentOrchestrationTypes";
export type {
  ConsensusDebateRound,
  ConsensusDebateUpdate,
  ExecutionDagClaimType,
  ExecutionDagEdge,
  ExecutionDagNode,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "./agentOrchestrationTypes";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export type ExpansionMode = "search" | "evidence_audit" | "counter" | "rewrite" | "rumor_check";

export interface EvidenceClue {
  id: string;
  title: string;
  summary: string;
  source: string;
  role: "support" | "limit" | "counter" | "context" | "lead";
  confidence: "low" | "medium" | "high";
}

export interface SearchFrontierItem {
  id: string;
  title: string;
  reasonToContinue: string;
  nextQuestion: string;
  estimatedValue: "low" | "medium" | "high";
}

export interface SearchStoppedItem {
  id: string;
  title: string;
  reason: "duplicate" | "budget" | "low_confidence" | "out_of_scope";
}

// ───────────────────────────────────────────────────────────────
// 按 Agent 的模型选择（payload 层；UI 未挂载，默认空 map 走 fallback 链）
// ───────────────────────────────────────────────────────────────

export type AgentId = "rumor_detector" | "fact_checker" | "source_validator" | "report_composer";

export interface AvailableModel {
  provider: string;
  model: string;
  label?: string;
}

export interface ModelChoiceEntry {
  provider: string;
  model: string;
}

export type ModelChoiceMap = Partial<Record<AgentId, ModelChoiceEntry>>;

// ───────────────────────────────────────────────────────────────
// 多 Agent Handoff Orchestrate
// ───────────────────────────────────────────────────────────────

export interface HandoffStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  agentContract?: AgentContract;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  evidenceBundle?: AgentEvidenceBundle;
  error?: string;
}

/** search_progress 提供方标识（Issue #9 冻结契约） */
export type SearchProgressProviderId =
  | "360_search"
  | "any_search"
  | "metaso_search"
  | "tavily_search"
  | "exa_search";

export type SearchProgressProviderStatus = "pending" | "running" | "completed" | "partial" | "failed";

/** search_progress: 单个检索提供方的实时状态 */
export interface SearchProgressProvider {
  id: SearchProgressProviderId;
  label: string;
  status: SearchProgressProviderStatus;
  resultCount: number;
}

/** search_progress: completed 阶段携带的汇总统计 */
export interface SearchProgressStats {
  rawResultCount: number;
  uniqueSourceCount: number;
  sharedSourceCount: number;
  singleProviderSourceCount: number;
}

/** search_progress: completed 阶段携带的来源清单 */
export interface SearchProgressSource {
  title: string;
  url: string;
  providerOrigins: string[];
}

export interface OrchestrateStreamEvent {
  type:
    | "search_progress"
    | "planner_update"
    | "speculative_update"
    | "consensus_debate_round"
    | "consensus_debate_final"
    | "agent_start"
    | "agent_complete"
    | "agent_error"
    | "agent_thought"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "complete"
    | "error";
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  agentContract?: AgentContract;
  /** agent_thought: 模型 thinking 文本增量（逐条） */
  content?: string;
  /** agent_thought: 句子序号（从 0 起） */
  seq?: number;
  /** agent_thought: 是否为该 agent 最后一条 */
  done?: boolean;
  /** agent_thought: 正在长出的未完成句，同 seq 可被下一次覆盖 */
  partial?: boolean;
  toolId?: string;
  toolName?: string;
  query?: string;
  result?: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidenceBundle?: AgentEvidenceBundle;
  model?: string;
  latencyMs?: number;
  steps?: HandoffStep[];
  finalReport?: Record<string, unknown>;
  /** Book Ch.1/6 proposer-reviewer 结果（确定性审稿），complete 事件可带 */
  reportReview?: {
    passed: boolean;
    score: number;
    issues: Array<{ code: string; severity: string; message: string }>;
  };
  plan?: ExecutionDagPlan;
  relay?: SpeculativeRelayUpdate;
  debate?: ConsensusDebateUpdate;
  followUpQueue?: unknown[];
  memoryCandidates?: MemoryCandidate[];
  totalLatencyMs?: number;
  sessionId?: string;
  claim?: string;
  error?: string;
  message?: string;
  code?: string;
  providerErrors?: string[];
  /** search_progress: 该事件所属原子命题 */
  atom?: string;
  /** search_progress: 检索阶段 */
  phase?: "started" | "progress" | "completed";
  /** search_progress: 已发出的查询数 */
  queryCount?: number;
  /** search_progress: 各检索提供方快照 */
  providers?: SearchProgressProvider[];
  /** search_progress: completed 时的汇总统计 */
  stats?: SearchProgressStats;
  /** search_progress: completed 时的来源清单 */
  sources?: SearchProgressSource[];
  /** agent_error: 该步失败后仍可继续收束 */
  recoverable?: boolean;
  timestamp?: number;
}

export async function* requestOrchestrateStream(
  input: string | CaseIntake,
  memoryRecall?: Record<string, unknown>,
  modelChoice?: Record<string, { provider: string; model: string }>
): AsyncGenerator<OrchestrateStreamEvent> {
  const claim = typeof input === "string" ? input : caseIntakePrimaryText(input);
  const payload: Record<string, unknown> = typeof input === "string" ? { claim } : { claim, intake: input };
  if (memoryRecall) payload.memoryRecall = memoryRecall;
  if (modelChoice && Object.keys(modelChoice).length > 0) payload.modelChoice = modelChoice;
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("loop") === "1" || params.get("execution") === "loop") {
        payload.execution = "loop";
      }
    } catch {
      /* ignore */
    }
  }

  // v2-iteration 2026-07-04: PR-3 Site B (peer spec) — emit trace per SSE event.
  const trace = getTraceCollector();
  const traceSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  trace.setSessionId(traceSessionId);

  const emitTraceFromEvent = (event: OrchestrateStreamEvent) => {
    const status: TraceStatus =
      event.type === "agent_complete" || event.type === "tool_result" || event.type === "complete"
        ? "completed"
        : event.type === "agent_error" || event.type === "tool_error" || event.type === "error"
        ? "failed"
        : "running";
    trace.emit({
      sessionId: traceSessionId,
      agent: event.agent ?? event.toolName ?? event.agentName ?? "planner",
      action: event.type,
      status,
      timestamp: Date.now(),
      latencyMs: event.latencyMs,
      meta: {
        query: event.query,
        model: event.model,
      },
    });
  };

  try {
    const controller = new AbortController();
    const response = await fetch(`${API_BASE}/api/agent/orchestrate-stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 429) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      const message = isChecksExhaustedMessage(data.message)
        ? data.message
        : checksExhaustedMessage("guest");
      yield { type: "error", code: "checks_exhausted", message };
      return;
    }

    if (!response.ok || !response.body) {
      yield { type: "error", message: `Orchestrate Stream API 失败：HTTP ${response.status}` };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let drained = false;
    // 损坏帧不再静默丢弃：丢的可能就是 complete 帧，静默=整单核查凭空蒸发
    let malformedFrames = 0;
    const noteMalformed = (where: string, head: string) => {
      malformedFrames += 1;
      console.error(`[stream] ${where} JSON 解析失败（第 ${malformedFrames} 帧）: ${head.slice(0, 120)}`);
    };

    try {
      while (true) {
        // F1：服务端每 15s 发心跳注释帧；60s 无任何字节 = 死连接，不再无限等待
        const read = reader.read();
        read.catch(() => {}); // 竞态落败后 abort 会让它 reject，别变成 unhandled rejection
        let readTimer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          readTimer = setTimeout(() => reject(new Error("stream-read-timeout")), 60_000);
        });
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await Promise.race([read, timeout]);
        } catch (error) {
          console.error("[stream] 60 秒无数据，判定连接已断", error);
          controller.abort();
          yield { type: "error", message: "与核查服务的连接中断了，这次没有查完。请重试。" };
          return;
        } finally {
          if (readTimer) clearTimeout(readTimer);
        }
        const { done, value } = chunk;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件（": keepalive" 心跳注释行不以 "data: " 开头，天然被跳过）
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as OrchestrateStreamEvent;
              emitTraceFromEvent(data);
              yield data;
            } catch {
              noteMalformed("行帧", line);
            }
          }
        }
      }

      // 处理缓冲区中剩余的内容
      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6)) as OrchestrateStreamEvent;
          emitTraceFromEvent(data);
          yield data;
        } catch {
          noteMalformed("尾帧", buffer);
        }
      }
      drained = true;
    } finally {
      // 消费端提前退出（组件卸载/重置）：取消读取并断开连接，避免服务端空跑
      if (!drained) {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
      reader.releaseLock();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orchestrate Stream API 调用异常";
    trace.emit({
      sessionId: traceSessionId,
      agent: "transport",
      action: "stream_error",
      status: "failed",
      timestamp: Date.now(),
      meta: { message },
    });
    yield { type: "error", message };
  }
}

export async function updateMemoryCandidateStatus(
  id: string,
  status: MemoryCandidateStatus,
  reason?: string
): Promise<MemoryCandidate> {
  const response = await fetch(`${API_BASE}/api/agent/memory-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setStatus", id, status, reason }),
  });
  const data = (await response.json().catch(() => null)) as { candidate?: MemoryCandidate; message?: string } | null;
  if (!response.ok || !data?.candidate) {
    throw new Error(data?.message ?? `Memory Candidate API 失败：HTTP ${response.status}`);
  }
  return data.candidate;
}
