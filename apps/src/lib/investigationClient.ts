/**
 * 调查服务的前端客户端：提交与接回返回同一种事件流，取消、分享、额度走同一个接口前缀。
 *
 * 客户端断开不是取消：服务端照常把这条 run 跑完，接回时拿到的是它当时的进度，
 * 跑完了就是完成态。接回不跑模型、不检索、不扣额。
 */
import { caseIntakePrimaryText, type CaseIntake } from "./caseIntake";
import {
  checksExhaustedMessage,
  isChecksExhaustedMessage,
  parseCheckQuota,
  type CheckQuotaView,
} from "../../shared/quota";
import type { InvestigationSnapshotV1, PublicActivity } from "../../shared/investigation";
import type { VisiblePriorRound } from "../../shared/followUp";

const API_BASE = import.meta.env.VITE_API_BASE || "";

/** 服务端每 15s 发心跳注释帧；60s 没有任何字节就当连接已死。 */
const READ_TIMEOUT_MS = 60_000;
const CONNECTION_LOST_MESSAGE = "连接已断开，暂时无法确认调查进度。";

/** 调查 SSE 事件。只声明前端读的字段；其余事件和字段服务端照发，reducer 一概忽略。 */
export interface InvestigationStreamEvent {
  type:
    | "run_started"
    | "run_state"
    | "investigation_snapshot"
    | "investigation_activity"
    | "complete"
    | "transport_error"
    /** 超时后管线仍在跑：这条连接等不到头了，但调查没失败。 */
    | "timeout_pending"
    /** 服务端常驻提示（code=image_unreadable：图片没读出来，已按文字继续）。 */
    | "notice"
    | "error"
    /** 客户端合成：流读完或断掉，总是最后一条。 */
    | "stream_closed";
  /** investigation_snapshot：完整 InvestigationSnapshotV1，产品界面唯一的调查语义来源。 */
  investigation?: InvestigationSnapshotV1;
  /**
   * investigation_activity：调查刚刚做了什么、带回了什么。
   * 服务端确定性投影，不是模型写的直播稿；先落快照，后发引用它的活动。
   */
  activity?: PublicActivity;
  /** run_started：这次调查的运行身份（取消与刷新恢复都要它）。 */
  runId?: string;
  /** run_started：这次调查在服务端开始的时间（毫秒）；刷新接回时也是最初那一刻。 */
  startedAt?: number;
  /** 服务端发出这条事件的时间（毫秒）。 */
  timestamp?: number;
  /** run_state：服务端确认的运行状态（重连时先给一次）。 */
  status?: string;
  finalReport?: Record<string, unknown>;
  message?: string;
  code?: string;
  /** stream_closed：读到结尾（closed），或请求被拒、网络断开、超时（failed）。 */
  reason?: "closed" | "failed";
}

function parseDataLine(line: string): InvestigationStreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const body = line.slice(5).trim();
  if (!body) return null;
  try {
    return JSON.parse(body) as InvestigationStreamEvent;
  } catch {
    // 丢的可能就是 complete 帧，不能静默
    console.error(`[stream] JSON 解析失败: ${body.slice(0, 120)}`);
    return null;
  }
}

function transportMessage(error: unknown, timedOut: boolean): string {
  const raw = error instanceof Error ? error.message : "";
  return timedOut || !raw || /failed to fetch|networkerror|load failed|network request failed|aborted/i.test(raw)
    ? CONNECTION_LOST_MESSAGE
    : raw;
}

async function* streamEvents(
  url: string,
  init: RequestInit,
  /** 响应不是可读的 200 时，说明这是什么事件；null 表示只关流。 */
  rejection: (response: Response) => Promise<InvestigationStreamEvent | null>
): AsyncGenerator<InvestigationStreamEvent> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = () => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, READ_TIMEOUT_MS);
  };
  const disarm = () => {
    if (timer) clearTimeout(timer);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reason: NonNullable<InvestigationStreamEvent["reason"]> = "failed";

  try {
    arm();
    const response = await fetch(url, { ...init, credentials: "include", signal: controller.signal });
    disarm();
    if (!response.ok || !response.body) {
      const event = await rejection(response);
      if (event) yield event;
    } else {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        arm();
        const { done, value } = await reader.read();
        disarm();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // 按行取 data:（带不带空格都认），空行与 ": keepalive" 心跳注释天然被跳过
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseDataLine(line);
          if (event) yield event;
        }
      }
      const tail = parseDataLine(buffer + decoder.decode());
      if (tail) yield tail;
      reason = "closed";
    }
  } catch (error) {
    if (timedOut) console.error("[stream] 60 秒无数据，判定连接已断", error);
    yield { type: "transport_error", message: transportMessage(error, timedOut) };
  } finally {
    disarm();
    // 消费端提前退出（组件卸载/重置）也走这里：断开连接；取消调查需另发请求
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  yield { type: "stream_closed", reason };
}

export type StartInvestigationOptions = {
  memoryRecall?: Record<string, unknown>;
  /** 幂等键：同一身份下同一个键只建一条 run，双击不会开两条管线。 */
  clientRequestId?: string;
  /** 追问：上一轮可见材料。首轮不传，请求体里没有这些字段。 */
  priorRound?: VisiblePriorRound | null;
  kind?: "recheck";
};

/** 提交一次新调查。 */
export function startInvestigation(
  intake: CaseIntake,
  { memoryRecall, clientRequestId, priorRound, kind }: StartInvestigationOptions = {}
): AsyncGenerator<InvestigationStreamEvent> {
  const payload: Record<string, unknown> = { claim: caseIntakePrimaryText(intake), intake };
  if (memoryRecall) payload.memoryRecall = memoryRecall;
  if (clientRequestId) payload.clientRequestId = clientRequestId;
  if (kind) payload.kind = kind;
  if (priorRound) {
    payload.followUp = true;
    payload.priorRound = priorRound;
  }
  return streamEvents(
    `${API_BASE}/api/agent/orchestrate-stream`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    async (response) => {
      if (response.status === 429) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        const message = isChecksExhaustedMessage(data.message) ? data.message : checksExhaustedMessage();
        return { type: "error", code: "checks_exhausted", message };
      }
      const unreachable = response.status >= 500 || !response.body;
      return unreachable
        ? { type: "transport_error", message: "暂时无法连接核查服务，无法确认调查是否已经开始。" }
        : { type: "error", message: `核查请求未被接受：HTTP ${response.status}` };
    }
  );
}

/** 接回一条已有 run：先补发 after 之后的活动与最新快照，再接直播。 */
export function resumeInvestigation(runId: string, after: number): AsyncGenerator<InvestigationStreamEvent> {
  return streamEvents(
    `${API_BASE}/api/investigations/${encodeURIComponent(runId)}/events?after=${Math.max(0, Math.floor(after))}`,
    { method: "GET" },
    async (response) =>
      response.status === 404 || response.status === 403
        ? { type: "error", code: "resume_unavailable", message: "无法接回这次调查：记录不存在或当前浏览器无权读取。已收到的材料仍保留在下面。" }
        : null
  );
}

/** 取消一条正在跑的 run。返回后端确认的状态。 */
export async function cancelInvestigation(runId: string): Promise<{ ok: boolean; status?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/investigations/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return { ok: false };
    const data = (await response.json()) as { status?: string };
    return { ok: true, ...(data.status ? { status: data.status } : {}) };
  } catch {
    return { ok: false };
  }
}

export async function createShare(runId: string): Promise<{ ok: true; shareId: string; url: string } | { ok: false; message?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/investigations/${encodeURIComponent(runId)}/shares`, {
      method: "POST",
      credentials: "include",
    });
    const data = (await response.json().catch(() => ({}))) as { shareId?: string; url?: string; message?: string };
    if (!response.ok || !data.shareId || !data.url) return { ok: false, message: data.message };
    return { ok: true, shareId: data.shareId, url: data.url };
  } catch {
    return { ok: false };
  }
}

export async function revokeShare(runId: string, shareId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/api/investigations/${encodeURIComponent(runId)}/shares/${encodeURIComponent(shareId)}`,
      { method: "DELETE", credentials: "include" }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchCheckQuota(): Promise<CheckQuotaView | null> {
  try {
    const response = await fetch(`${API_BASE}/api/checks/quota`, { credentials: "include" });
    return response.ok ? parseCheckQuota(await response.json()) : null;
  } catch {
    return null;
  }
}
