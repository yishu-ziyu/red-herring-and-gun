/**
 * 取数：回放样例（public/fixtures，开发库只读导出）或真实接口（/api/investigations*，经 Vite 代理到 3100）。
 * 真实接口靠访客 cookie 认人，fetch 一律带 credentials。
 */
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";
import { judgmentToLabel } from "@shared/domain/labels";
import type { HistoryEntry, RunData, StreamEvent } from "./types";

type FixtureIndexRow = { fixture: string; runId: string; claim: string; label: string | null; judgment: string | null; createdAt: number };

let fixtureIndex: Promise<FixtureIndexRow[]> | null = null;
export function loadFixtureIndex(): Promise<FixtureIndexRow[]> {
  fixtureIndex ??= fetch("/fixtures/index.json")
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => []);
  return fixtureIndex;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { message?: string }).message;
    throw new Error(message || `请求失败（${res.status}）`);
  }
  return body as T;
}

export async function isFixture(run: string): Promise<boolean> {
  return (await loadFixtureIndex()).some((row) => row.fixture === run);
}

export async function loadRun(run: string): Promise<RunData> {
  if (await isFixture(run)) {
    const res = await fetch(`/fixtures/${run}.json`);
    const data = await readJson<RunData & { fixture: string }>(res);
    return data;
  }
  const meta = await readJson<{ runId: string; status: string; createdAt: number; snapshot: InvestigationSnapshotV1 | null; activities: RunData["activities"] }>(
    await fetch(`/api/investigations/${encodeURIComponent(run)}`, { credentials: "include" })
  );
  let verdictDecision: RunData["verdictDecision"] = null;
  let snapshot = meta.snapshot;
  const resultRes = await fetch(`/api/investigations/${encodeURIComponent(run)}/result`, { credentials: "include" });
  if (resultRes.status === 200) {
    const result = await resultRes.json();
    snapshot = result.snapshot ?? snapshot;
    verdictDecision = result.report?._verdictDecision ?? null;
  }
  return { runId: meta.runId, status: meta.status, createdAt: meta.createdAt, snapshot, verdictDecision, events: [], activities: meta.activities ?? [] };
}

export async function loadHistory(): Promise<{ mine: HistoryEntry[]; samples: HistoryEntry[]; error: string }> {
  const samples = (await loadFixtureIndex()).map((row) => ({
    runId: row.runId,
    fixture: row.fixture,
    claim: row.claim,
    // 改版前的快照只有 judgment，按共享规则推出标签。
    label: row.label ?? (row.judgment ? judgmentToLabel(row.judgment as Parameters<typeof judgmentToLabel>[0]) : null),
    createdAt: row.createdAt,
    status: "completed",
  }));
  try {
    const res = await fetch("/api/investigations", { credentials: "include" });
    if (res.status === 403) return { mine: [], samples, error: "" };
    const body = await readJson<{ investigations: Array<{ runId: string; claim: string; status: string; createdAt: number }> }>(res);
    return {
      mine: body.investigations.map((row) => ({ runId: row.runId, claim: row.claim, label: null, createdAt: row.createdAt, status: row.status })),
      samples,
      error: "",
    };
  } catch (error) {
    return { mine: [], samples, error: error instanceof Error ? error.message : "历史记录读取失败" };
  }
}

/** 订阅真实事件流：先补发已有事件，再接着推新事件。返回关闭函数。 */
export function subscribeEvents(runId: string, onEvent: (event: StreamEvent) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/api/investigations/${encodeURIComponent(runId)}/events?afterEvent=0`, { withCredentials: true });
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as StreamEvent;
      onEvent(event);
      if (event.type === "run_state" && event.terminal) source.close();
    } catch {
      /* 心跳等非 JSON 帧忽略 */
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) onError("和服务器的连接断开了");
  };
  return () => source.close();
}

/** 读图片为 data URL，发给后端视觉预处理。 */
export type IntakeImage = { name?: string; type?: string; size?: number; dataUrl: string };

/** 发起一次核查（后台执行），返回 runId；过程走 subscribeEvents。 */
export async function startInvestigation(text: string, images: IntakeImage[]): Promise<string> {
  const claim = text.trim() || `请核查用户上传的 ${images.length} 张图片材料。`;
  const body = {
    claim,
    clientRequestId: crypto.randomUUID(),
    kind: "initial",
    intake: { text: text.trim(), links: [], images },
  };
  const res = await fetch("/api/investigations", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const meta = await readJson<{ runId: string }>(res);
  return meta.runId;
}

export async function createShare(runId: string): Promise<string> {
  const res = await fetch(`/api/investigations/${encodeURIComponent(runId)}/shares`, { method: "POST", credentials: "include" });
  const body = await readJson<{ url: string }>(res);
  return new URL(body.url, window.location.origin).toString();
}

export async function loadQuota(): Promise<{ remaining: number; total: number; enforced: boolean } | null> {
  try {
    const res = await fetch("/api/checks/quota", { credentials: "include" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
