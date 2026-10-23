/**
 * SSE 的线上格式：调查流与接回流共用同一份。
 * 客户端解析器只认 `data: ` 行；注释行（心跳）天然被忽略。
 */
import type { ServerResponse } from "node:http";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
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
  const seq = (event as Record<string, unknown>).eventSeq;
  const id = typeof seq === "number" ? `id: ${seq}\n` : "";
  return `${id}data: ${JSON.stringify(event)}\n\n`;
}

const SSE_BUFFER_BYTES = 1024 * 1024;
const SSE_DRAIN_TIMEOUT_MS = 30_000;

/** A bounded transport queue. Closing it never changes the durable run or its abort signal. */
export function createSseWriter(res: ServerResponse) {
  type Frame = { text: string; bytes: number; offset: number; oversized: boolean; resolve: (written: boolean) => void };
  const queue: Frame[] = [];
  const cleanup = new Set<() => void>();
  let queuedBytes = 0;
  let oversizedInFlight = false;
  let blocked: Frame | undefined;
  let closed = false;
  let ending = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const clearDeadline = () => { if (deadline) clearTimeout(deadline); deadline = undefined; };
  const dispose = (destroy: boolean) => {
    if (closed) return;
    closed = true;
    clearDeadline();
    if (heartbeat) clearInterval(heartbeat);
    res.off('drain', onDrain);
    res.off('close', onClose);
    res.off('finish', onFinish);
    res.off('error', onError);
    blocked?.resolve(false);
    blocked = undefined;
    for (const frame of queue.splice(0)) frame.resolve(false);
    queuedBytes = 0;
    for (const fn of cleanup) fn();
    cleanup.clear();
    if (destroy && !res.destroyed) res.destroy();
  };
  const armDeadline = () => {
    clearDeadline();
    deadline = setTimeout(() => {
      console.warn('[sse] slow subscriber disconnected after drain deadline');
      dispose(true);
    }, SSE_DRAIN_TIMEOUT_MS);
    deadline.unref?.();
  };
  const pump = () => {
    if (closed || blocked) return;
    while (queue.length && !closed) {
      const frame = queue.shift()!;
      if (!frame.oversized) queuedBytes -= frame.bytes;
      try {
        while (frame.offset < frame.text.length) {
          // 16K UTF-16 units encode to at most 64KiB. Never split a surrogate pair.
          let end = frame.oversized ? Math.min(frame.offset + 16 * 1024, frame.text.length) : frame.text.length;
          if (end < frame.text.length && /[\uD800-\uDBFF]/.test(frame.text[end - 1]!)) end -= 1;
          const chunk = frame.text.slice(frame.offset, end);
          frame.offset = end;
          if (!res.write(chunk)) { blocked = frame; armDeadline(); return; }
        }
        if (frame.oversized) oversizedInFlight = false;
        frame.resolve(true);
      } catch {
        frame.resolve(false);
        dispose(true);
        return;
      }
    }
    if (ending && !closed && !res.writableEnded) {
      armDeadline();
      try { res.end(); } catch { dispose(true); }
    }
  };
  function onDrain() {
    clearDeadline();
    const frame = blocked;
    blocked = undefined;
    if (frame) {
      if (frame.offset < frame.text.length) queue.unshift(frame);
      else {
        if (frame.oversized) oversizedInFlight = false;
        frame.resolve(true);
      }
    }
    pump();
  }
  function onClose() { dispose(false); }
  function onFinish() { dispose(false); }
  function onError() { dispose(true); }
  const sendText = (text: string): Promise<boolean> => {
    if (closed || ending) return Promise.resolve(false);
    const bytes = Buffer.byteLength(text, 'utf8');
    const oversized = bytes > SSE_BUFFER_BYTES;
    // One already-persisted large event may occupy the writer exclusively, without
    // imposing a new product input limit. Its chunks obey drain; following small
    // frames retain the ordinary 1MiB budget. Another large event must reconnect.
    if (oversized && (oversizedInFlight || blocked || queue.length)) {
      console.warn('[sse] disconnected: another large frame arrived before the writer drained');
      dispose(true);
      return Promise.resolve(false);
    }
    const nextLargeChunk = oversizedInFlight ? 64 * 1024 : 0;
    if (!oversized && bytes + queuedBytes + res.writableLength + nextLargeChunk > SSE_BUFFER_BYTES) {
      console.warn('[sse] disconnected: queued small frames exceeded the 1MiB byte budget');
      dispose(true);
      return Promise.resolve(false);
    }
    if (oversized) oversizedInFlight = true;
    return new Promise(resolve => {
      queue.push({ text, bytes, offset: 0, oversized, resolve });
      if (!oversized) queuedBytes += bytes;
      pump();
    });
  };
  openSse(res);
  res.on('drain', onDrain);
  res.on('close', onClose);
  res.on('finish', onFinish);
  res.on('error', onError);
  heartbeat = setInterval(() => {
    if (!blocked && !queue.length && !ending) void sendText(SSE_KEEPALIVE_FRAME);
  }, SSE_KEEPALIVE_MS);
  heartbeat.unref?.();
  if (res.destroyed || res.writableEnded) dispose(false);
  return {
    get closed() { return closed; },
    send(event: object) { return sendText(sseFrame(event)); },
    finish() { if (!closed) { ending = true; if (heartbeat) clearInterval(heartbeat); pump(); } },
    close() { dispose(true); },
    onClose(fn: () => void) { if (closed) fn(); else cleanup.add(fn); },
  };
}
