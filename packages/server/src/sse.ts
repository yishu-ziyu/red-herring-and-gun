import type { Response } from "express";
import type { CaseEvent } from "@rhg/core";
import { toPublicEvent } from "./publicEvent.js";
import type { CaseStore } from "./store.js";
import type { TurnRunner } from "./turns.js";

export const DEFAULT_HEARTBEAT_MS = 15_000;

export type SseOptions = {
  res: Response;
  caseId: string;
  since: number;
  store: CaseStore;
  turns: TurnRunner;
  heartbeatMs?: number;
};

function writeRaw(res: Response, chunk: string, closed: { value: boolean }): void {
  if (closed.value || res.writableEnded || res.destroyed) return;
  res.write(chunk);
}

export function writeFrame(res: Response, event: CaseEvent, closed: { value: boolean }): void {
  const publicEvent = toPublicEvent(event);
  writeRaw(
    res,
    `event: case.event\nid: ${publicEvent.seq}\ndata: ${JSON.stringify(publicEvent)}\n\n`,
    closed,
  );
}

export async function attachCaseStream(opts: SseOptions): Promise<() => void> {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const closed = { value: false };
  const sent = new Set<number>();
  const buffer: CaseEvent[] = [];
  let live = false;

  const writeIfNew = (event: CaseEvent): void => {
    if (event.seq <= opts.since || sent.has(event.seq)) return;
    sent.add(event.seq);
    writeFrame(opts.res, event, closed);
  };

  const unsubscribe = opts.turns.subscribe(opts.caseId, (event) => {
    if (!live) {
      buffer.push(event);
      return;
    }
    writeIfNew(event);
  });

  const logged = (await opts.store.load(opts.caseId)) ?? [];
  for (const event of logged) writeIfNew(event);
  const pending = buffer.splice(0);
  for (const event of pending) writeIfNew(event);
  live = true;
  const leftover = buffer.splice(0);
  for (const event of leftover) writeIfNew(event);

  const ping = setInterval(() => {
    writeRaw(opts.res, ": ping\n\n", closed);
  }, heartbeatMs);

  const detach = (): void => {
    if (closed.value) return;
    closed.value = true;
    clearInterval(ping);
    unsubscribe();
  };

  opts.res.on("close", detach);
  return detach;
}

export function prepareSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}
