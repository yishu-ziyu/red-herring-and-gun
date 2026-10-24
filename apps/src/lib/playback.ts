/**
 * 回放：按事件真实间隔加速重放（每段间隔除以倍速，再封顶），只推进「已收到」的条数。
 * 实时：订阅 SSE，事件来一条加一条。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "./types";
import { eventTime } from "./workbench";
import { subscribeEvents } from "./data";

const MAX_GAP_MS = 1200;

export function useReplay(events: StreamEvent[], enabled: boolean) {
  const [received, setReceived] = useState(enabled ? 0 : events.length);
  const [playing, setPlaying] = useState(enabled);
  const [speed, setSpeed] = useState(8);
  const receivedRef = useRef(received);
  receivedRef.current = received;

  useEffect(() => {
    if (!enabled || !playing) return;
    if (received >= events.length) {
      setPlaying(false);
      return;
    }
    const prev = received > 0 ? eventTime(events[received - 1]!) : eventTime(events[0]!);
    const gap = Math.max(0, eventTime(events[received]!) - prev);
    const delay = Math.min(gap / speed, MAX_GAP_MS);
    const timer = window.setTimeout(() => setReceived((n) => Math.min(events.length, n + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [enabled, playing, received, speed, events]);

  const restart = useCallback(() => {
    setReceived(0);
    setPlaying(true);
  }, []);

  return { received, playing, setPlaying, speed, setSpeed, restart, total: events.length };
}

export function useLiveEvents(runId: string, enabled: boolean) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    setEvents([]);
    return subscribeEvents(
      runId,
      (event) => setEvents((list) => (list.some((e) => e.eventSeq !== undefined && e.eventSeq === event.eventSeq) ? list : [...list, event])),
      setError
    );
  }, [runId, enabled]);
  return { events, error };
}

/** 实时运行中让「进行中」的步骤耗时走起来。 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
