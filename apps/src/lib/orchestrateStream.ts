import { caseIntakePrimaryText, type CaseIntake } from "./caseIntake";
import {
  checksExhaustedMessage,
  isChecksExhaustedMessage,
} from "../../shared/quota";
import type { InvestigationSnapshotV1, PublicActivity } from "../../shared/investigation";
import type { VisiblePriorRound } from "../../shared/followUp";

const API_BASE = import.meta.env.VITE_API_BASE || "";

/** 调查 SSE 事件。只声明前端读的字段；其余字段服务端照发，这里不读。 */
export interface OrchestrateStreamEvent {
  type:
    | "run_started"
    | "run_state"
    | "investigation_snapshot"
    | "investigation_activity"
    | "search_progress"
    | "planner_update"
    | "speculative_update"
    | "agent_start"
    | "agent_complete"
    | "agent_error"
    | "agent_thought"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "complete"
    /** 超时后管线仍在跑：这条连接等不到头了，但调查没失败。 */
    | "timeout_pending"
    /** 服务端常驻提示（code=image_unreadable：图片没读出来，已按文字继续）。 */
    | "notice"
    | "error";
  /** investigation_snapshot：完整 InvestigationSnapshotV1，产品界面唯一的调查语义来源。 */
  investigation?: InvestigationSnapshotV1;
  /**
   * investigation_activity：调查刚刚做了什么、带回了什么。
   * 服务端确定性投影，不是模型写的直播稿；先落快照，后发引用它的活动。
   */
  activity?: PublicActivity;
  /** run_started：这次调查的运行身份（取消与刷新恢复都要它）。 */
  runId?: string;
  /** run_state：服务端确认的运行状态（重连时先给一次）。 */
  status?: string;
  finalReport?: Record<string, unknown>;
  message?: string;
  code?: string;
}

export async function* requestOrchestrateStream(
  input: CaseIntake,
  memoryRecall?: Record<string, unknown>,
  /** 幂等键：同一身份下同一个键只建一条 run，双击不会开两条管线。 */
  clientRequestId?: string,
  /** 追问：传上一轮可见材料。首轮不传，payload 不出现这些字段。 */
  priorRound?: VisiblePriorRound | null
): AsyncGenerator<OrchestrateStreamEvent> {
  const payload: Record<string, unknown> = { claim: caseIntakePrimaryText(input), intake: input };
  if (memoryRecall) payload.memoryRecall = memoryRecall;
  if (clientRequestId) payload.clientRequestId = clientRequestId;
  if (priorRound) {
    payload.followUp = true;
    payload.priorRound = priorRound;
  }

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
        : checksExhaustedMessage();
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
    const raw = error instanceof Error ? error.message : "";
    const message =
      !raw || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)
        ? "与核查服务的连接中断了，这次没有查完。请重试。"
        : raw;
    yield { type: "error", message };
  }
}
