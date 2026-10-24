// 后端接口（apps/server/src/handlers.ts、shareHandlers.ts）与本地回放样例。
import { useEffect, useRef, useState } from "react";
import type { Fixture, FixtureMeta, HistoryEntry, RunResult, StreamEvent } from "./types.ts";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || `请求失败（${res.status}）`);
  return body as T;
}

export async function loadFixtureIndex(): Promise<FixtureMeta[]> {
  return json<FixtureMeta[]>(await fetch("/fixtures/index.json"));
}

const fixtureCache = new Map<string, Promise<Fixture>>();
export function loadFixture(name: string): Promise<Fixture> {
  if (!/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error("没有这条样例"));
  if (!fixtureCache.has(name)) fixtureCache.set(name, fetch(`/fixtures/${name}.json`).then((r) => json<Fixture>(r)));
  return fixtureCache.get(name)!;
}

export type ImageInput = { name: string; type: string; size: number; dataUrl: string };

/** POST /api/investigations：后台开始一次核查，返回 runId。 */
export async function startInvestigation(claim: string, images: ImageInput[]): Promise<{ runId: string }> {
  const clientRequestId = crypto.randomUUID();
  return json(
    await fetch("/api/investigations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": clientRequestId },
      body: JSON.stringify({ claim, clientRequestId, intake: { text: claim, links: [], images, createdAt: Date.now() } }),
    }),
  );
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const res = await fetch("/api/investigations", { credentials: "include" });
  if (res.status === 403) return [];
  return (await json<{ investigations: HistoryEntry[] }>(res)).investigations ?? [];
}

export async function fetchResult(runId: string): Promise<RunResult> {
  return json<RunResult>(await fetch(`/api/investigations/${encodeURIComponent(runId)}/result`, { credentials: "include" }));
}

export async function createShare(runId: string): Promise<string> {
  const body = await json<{ url: string }>(
    await fetch(`/api/investigations/${encodeURIComponent(runId)}/shares`, { method: "POST", credentials: "include" }),
  );
  return new URL(body.url, window.location.origin).toString();
}

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/api/investigations/${encodeURIComponent(runId)}/cancel`, { method: "POST", credentials: "include" });
}

export type RunSource = { kind: "fixture"; name: string } | { kind: "live"; runId: string };

/**
 * 事件到达：真实运行走 SSE（GET …/events?afterEvent=n）；样例按原时间间隔加速重放。
 * 返回已到达的事件；视图再决定看到哪一条（实时跟随 / 历史回放）。
 */
export function useArrivingEvents(source: RunSource | null, speed: number) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string>("");
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  /** 最近一批事件到达时的墙钟时间：回放时用它把「已用」时间按倍速往前推。 */
  const arrivedAt = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const key = source ? (source.kind === "fixture" ? `f:${source.name}` : `l:${source.runId}`) : "";

  useEffect(() => {
    setEvents([]);
    setError("");
    if (!source) return;
    let stopped = false;
    if (source.kind === "live") {
      const es = new EventSource(`/api/investigations/${encodeURIComponent(source.runId)}/events?afterEvent=0`, { withCredentials: true });
      es.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data) as StreamEvent;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "run_state" && ev.terminal === true) es.close();
        } catch {
          /* 心跳等非 JSON 帧忽略 */
        }
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) setError("和服务器的连接断了，刷新页面会从断点接上");
      };
      return () => es.close();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadFixture(source.name)
      .then((fx) => {
        if (stopped) return;
        setFixture(fx);
        let i = 0;
        const tick = () => {
          if (stopped || i >= fx.events.length) return;
          const batch: StreamEvent[] = [];
          const first = fx.events[i]!;
          // 同一毫秒附近的事件一起到，减少渲染次数
          while (i < fx.events.length && (fx.events[i]!.timestamp ?? 0) - (first.timestamp ?? 0) <= 30) batch.push(fx.events[i++]!);
          arrivedAt.current = Date.now();
          setEvents((prev) => [...prev, ...batch]);
          if (i >= fx.events.length) return;
          const gap = ((fx.events[i]!.timestamp ?? 0) - (batch.at(-1)!.timestamp ?? 0)) / speedRef.current;
          timer = setTimeout(tick, Math.min(Math.max(gap, 16), 2500));
        };
        tick();
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, restartKey]);

  return { events, error, fixture, arrivedAt, restart: () => setRestartKey((k) => k + 1) };
}
