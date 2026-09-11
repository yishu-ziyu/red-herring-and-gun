/**
 * investigationResume — 刷新/断线后接回同一条 run（IMPLEMENTATION_PLAN §5.3）。
 *
 * 补发接口是 GET：先给 after 之后的活动与最新快照，再接直播。
 * 它不跑模型、不检索、不扣额——重连不是第二次核查。
 *
 * 边界（照 RunService 的实际能力写，不承诺做不到的事）：
 * 客户端断开时服务端会中止管线并保留已获快照，所以刷新通常接到的是
 * 「已中断 + 已有材料」，可以就地重新调查，但不会在后台继续烧。
 */
import type { OrchestrateStreamEvent } from "./agentExpansion";

const API_BASE = "";

export type ResumeHandle = {
  /** 主动停止本地接收（不发取消请求）。 */
  close: () => void;
};

function parseFrame(raw: string): OrchestrateStreamEvent | null {
  const line = raw.trim();
  if (!line.startsWith("data:")) return null;
  const body = line.slice(5).trim();
  if (!body) return null;
  try {
    return JSON.parse(body) as OrchestrateStreamEvent;
  } catch {
    return null;
  }
}

/**
 * 接回一条已有 run。每个事件交给 onEvent；流自然结束或出错时交给 onEnd。
 * 返回的 close 只关本地连接。
 */
export function resumeInvestigationStream(
  runId: string,
  after: number,
  onEvent: (event: OrchestrateStreamEvent) => void,
  onEnd: (reason: "closed" | "failed") => void
): ResumeHandle {
  const controller = new AbortController();
  let closed = false;

  void (async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/investigations/${encodeURIComponent(runId)}/events?after=${Math.max(0, Math.floor(after))}`,
        { method: "GET", credentials: "include", signal: controller.signal }
      );
      if (!response.ok || !response.body) {
        onEnd("failed");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // 帧以空行分隔；注释行（心跳）天然不匹配 parseFrame
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = parseFrame(part);
          if (event) onEvent(event);
        }
      }
      if (!closed) onEnd("closed");
    } catch {
      if (!closed) onEnd("failed");
    }
  })();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
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
