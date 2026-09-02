/**
 * piEvents.ts — pi AgentEvent → 统一核查事件归一化（P0a）。
 *
 * subscribe 层事件与扩展层事件（context/tool_call/tool_result 等 6 个）分层——
 * 需要在扩展里抓的（tool_call 原始参数）P0 暂用 subscribe 可得的 message_update /
 * tool_execution_* 近似表达；后续 P1 再按需走 pi.on 落库。
 */
export type PiStreamItem =
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; toolName: string }
  | { kind: "tool_result"; toolName: string; text?: string }
  | { kind: "done" }
  | { kind: "info"; text: string };

export function normalizePiEvent(event: {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}): PiStreamItem | null {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (!inner || typeof inner !== "object") return null;
      if (inner.type === "text_delta" && typeof inner.delta === "string" && inner.delta) {
        return { kind: "delta", text: inner.delta };
      }
      if (inner.type === "tool_call" && inner.toolCall) {
        return { kind: "tool_call", toolName: String(inner.toolCall.name || "tool") };
      }
      if (inner.type === "tool_result") {
        return { kind: "tool_result", toolName: String(inner.toolResult?.name || inner.toolName || "tool") };
      }
      return null;
    }
    case "tool_execution_start":
    case "tool_execution_begin": {
      const name = event.toolName || event.tool?.name || event.name || "";
      return { kind: "tool_call", toolName: String(name) };
    }
    case "tool_execution_end":
    case "tool_execution_finish":
    case "tool_execution_error": {
      return { kind: "tool_result", toolName: String(event.toolName || event.tool?.name || event.name || "tool") };
    }
    case "agent_settled":
    case "agent_end":
      return { kind: "done" };
    default:
      return null;
  }
}

/** 把归一化事件收集成数组（供测试/日志断言）。 */
export class PiEventCollector {
  readonly items: PiStreamItem[] = [];
  private deltaBuf: string[] = [];
  handle = (event: { type: string; [key: string]: unknown }): void => {
    const item = normalizePiEvent(event);
    if (!item) return;
    this.items.push(item);
    if (item.kind === "delta") this.deltaBuf.push(item.text);
    if (item.kind === "done") this.deltaBuf = this.deltaBuf.slice(-200); // 防超长
  };
  /** 拼接该轮的最终文本（近似 lastText）。 */
  getFinalText(): string {
    return this.deltaBuf.join("").slice(0, 16000);
  }
}