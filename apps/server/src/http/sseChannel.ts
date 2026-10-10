/**
 * SSE 的线上格式（external-contracts「SSE framing」）：调查流与接回流共用同一份。
 * 客户端解析器只认 `data: ` 行；注释行（心跳）天然被忽略。
 */
import type { ServerResponse } from "node:http";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  // 不依赖反代配置：任何 nginx（含未关 proxy_buffering 的旧配置）见此头即不缓冲本响应
  "X-Accel-Buffering": "no",
} as const;

/** 心跳：模型调用阶段可静默 ~50s，注释帧让中间代理与浏览器知道流还活着。 */
export const SSE_KEEPALIVE_FRAME = ": keepalive\n\n";
export const SSE_KEEPALIVE_MS = 15_000;

export function openSse(res: Pick<ServerResponse, "writeHead">): void {
  res.writeHead(200, SSE_HEADERS);
}

export function sseFrame(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
