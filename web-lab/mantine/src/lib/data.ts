/**
 * 数据入口：真实接口（/api/investigations…）与本地回放样例（public/fixtures，从库里只读导出、已过公开清洗）。
 * 两条路给出同一种形状：事件序列 + 结果（快照 + 报告）。
 */
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema.ts";
import { isUrlOnlyClaim } from "@shared/investigation/presentation.ts";

export type StreamEvent = Record<string, unknown> & { type: string; timestamp?: number; eventSeq?: number };

export type Report = Record<string, unknown>;

export type ImageReading = { texts: string[]; summary: string };

export type ResultData = {
  snapshot: InvestigationSnapshotV1;
  report: Report | null;
  /** 有图片时：从图片里读出的文字。 */
  image: ImageReading | null;
  /** 真实记录的 runId（分享要用）。 */
  runId: string | null;
};

export type FixtureIndexItem = {
  name: string;
  runId: string;
  createdAt: number;
  claim: string;
  label: string | null;
  judgment: string | null;
  events: number;
};

export type Fixture = {
  name: string;
  runId: string;
  status: string;
  createdAt: number;
  claim: string;
  events: StreamEvent[];
  result: { snapshot: InvestigationSnapshotV1; report: Report | null };
};

export type HistoryItem = {
  key: string;
  claim: string;
  createdAt: number;
  label: string | null;
  status: string;
  source: "server" | "fixture";
  href: string;
};

const IMAGE_REQUEST_PREFIX = "请核查用户上传的";

/**
 * 老记录只交图片时，原句里拼着图片读取的结果（JSON）。拆出读到的文字；
 * 原句换成读到的文字，不把给模型的请求句和服务名露出来。
 */
export function splitImageClaim(originalClaim: string): { claim: string; image: ImageReading | null } {
  if (!originalClaim.startsWith(IMAGE_REQUEST_PREFIX)) return { claim: originalClaim, image: null };
  const start = originalClaim.indexOf("{");
  const end = originalClaim.lastIndexOf("}");
  let image: ImageReading | null = null;
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(originalClaim.slice(start, end + 1)) as Record<string, unknown>;
      image = imageReadingOf(parsed);
    } catch {
      image = null;
    }
  }
  const claim = image?.texts.length ? image.texts.join("\n") : "上传的图片";
  return { claim, image };
}

export function imageReadingOf(raw: Record<string, unknown> | null | undefined): ImageReading | null {
  if (!raw) return null;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  const texts = list(raw.ocrTexts);
  const summary = typeof raw.visualSummary === "string" ? raw.visualSummary.trim() : "";
  if (!texts.length && !summary) return null;
  return { texts, summary };
}

/** 事件流里图片读取那一步的结果。 */
export function imageReadingFromEvents(events: readonly StreamEvent[]): ImageReading | null {
  for (const event of events) {
    if (event.type !== "tool_result") continue;
    const result = event.result as Record<string, unknown> | undefined;
    if (result && (Array.isArray(result.ocrTexts) || typeof result.visualSummary === "string")) return imageReadingOf(result);
  }
  return null;
}

/** 显示用的原句：去掉图片请求句；只贴链接时保持原样。 */
export function displayClaimOf(snapshot: InvestigationSnapshotV1): string {
  const { claim } = splitImageClaim(snapshot.originalClaim);
  return isUrlOnlyClaim(claim) ? claim.replace(/^请核查链接内容：/, "") : claim;
}

export function resultFromParts(snapshot: InvestigationSnapshotV1, report: Report | null, events: readonly StreamEvent[], runId: string | null): ResultData {
  const split = splitImageClaim(snapshot.originalClaim);
  // 老记录的原句里拼着图片读取结果：换成读到的文字再交给共享层，否则「本次未核查」会把请求句当成原句的一部分。
  const clean = split.image ? { ...snapshot, originalClaim: split.claim, scope: snapshot.scope ? { ...snapshot.scope, notCoveredTexts: undefined } : undefined } : snapshot;
  return { snapshot: clean, report, image: imageReadingFromEvents(events) ?? split.image, runId };
}

// ── 样例 ──

const fixtureCache = new Map<string, Promise<Fixture>>();

export function loadFixture(name: string): Promise<Fixture> {
  if (!/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error("没有这条记录"));
  let pending = fixtureCache.get(name);
  if (!pending) {
    pending = fetch(`/fixtures/${name}.json`).then((res) => {
      if (!res.ok) throw new Error("没有这条记录");
      return res.json() as Promise<Fixture>;
    });
    fixtureCache.set(name, pending);
  }
  return pending;
}

export async function loadFixtureIndex(): Promise<FixtureIndexItem[]> {
  const res = await fetch("/fixtures/index.json");
  if (!res.ok) return [];
  return res.json();
}

// ── 真实接口 ──

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 120) };
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type StartInput = { text: string; images: { name: string; type: string; size: number; dataUrl: string }[] };

/** POST /api/investigations：后台开始一次核查，返回 runId。 */
export async function startInvestigation(input: StartInput): Promise<{ runId: string }> {
  const text = input.text.trim();
  const claim = text || `请核查用户上传的 ${input.images.length} 张图片材料。`;
  const res = await fetch("/api/investigations", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim,
      clientRequestId: crypto.randomUUID(),
      kind: "initial",
      intake: { text, links: [], images: input.images, createdAt: Date.now() },
    }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(body.message || "没能开始核查", res.status);
  return { runId: String(body.runId) };
}

/** GET /api/investigations/:runId/events：SSE。返回关闭函数。 */
export function followEvents(runId: string, onEvent: (event: StreamEvent) => void, onEnd: (error?: string) => void): () => void {
  const source = new EventSource(`/api/investigations/${encodeURIComponent(runId)}/events?afterEvent=0`, { withCredentials: true });
  let ended = false;
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as StreamEvent;
      onEvent(event);
      if (event.type === "run_state" && event.terminal === true) {
        ended = true;
        source.close();
        onEnd();
      }
    } catch {
      /* 心跳等非 JSON 帧忽略 */
    }
  };
  source.onerror = () => {
    if (ended) return;
    if (source.readyState === EventSource.CLOSED) onEnd("连接中断了，刷新页面可以接着看");
  };
  return () => {
    ended = true;
    source.close();
  };
}

/** 已结束的记录：把事件一次读完（服务端补发完会关流）。 */
export async function readAllEvents(runId: string): Promise<StreamEvent[]> {
  const res = await fetch(`/api/investigations/${encodeURIComponent(runId)}/events?afterEvent=0`, { credentials: "include" });
  if (!res.ok || !res.body) return [];
  const text = await res.text();
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join(""))
    .filter(Boolean)
    .flatMap((data) => {
      try {
        return [JSON.parse(data) as StreamEvent];
      } catch {
        return [];
      }
    });
}

/** GET /api/investigations/:runId/result */
export async function fetchResult(runId: string): Promise<ResultData> {
  const res = await fetch(`/api/investigations/${encodeURIComponent(runId)}/result`, { credentials: "include" });
  const body = await readJson(res);
  if (res.status === 202) throw new ApiError("还在核查，稍后再看", 202);
  if (!res.ok) throw new ApiError(body.message || "没能读取结果", res.status);
  const events = await readAllEvents(runId).catch(() => []);
  return resultFromParts(body.snapshot, body.report ?? null, events, runId);
}

/** GET /api/investigations：这个浏览器发起过的记录。 */
export async function fetchHistory(): Promise<HistoryItem[]> {
  const res = await fetch("/api/investigations", { credentials: "include" });
  if (!res.ok) return [];
  const body = await readJson(res);
  const list = Array.isArray(body.investigations) ? body.investigations : [];
  return list.map((run: any) => ({
    key: String(run.runId),
    claim: splitImageClaim(String(run.claim ?? "")).claim,
    createdAt: Number(run.createdAt) || 0,
    label: null,
    status: String(run.status ?? ""),
    source: "server" as const,
    href: run.status === "completed" || run.status === "interrupted"
      ? `?part=result&runId=${encodeURIComponent(run.runId)}`
      : `?part=running&runId=${encodeURIComponent(run.runId)}`,
  }));
}

/** POST /api/investigations/:runId/shares → 链接 */
export async function createShare(runId: string): Promise<string> {
  const res = await fetch(`/api/investigations/${encodeURIComponent(runId)}/shares`, { method: "POST", credentials: "include" });
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(body.message || "没能生成链接", res.status);
  return new URL(String(body.url), window.location.origin).toString();
}

export type Quota = { remaining: number; total: number };

export async function fetchQuota(): Promise<Quota | null> {
  try {
    const res = await fetch("/api/checks/quota", { credentials: "include" });
    if (!res.ok) return null;
    const body = await readJson(res);
    const q = body.quota ?? body;
    return typeof q.remaining === "number" ? { remaining: q.remaining, total: Number(q.total) || 0 } : null;
  } catch {
    return null;
  }
}

/** POST /api/investigations/:runId/cancel */
export async function cancelInvestigation(runId: string): Promise<void> {
  await fetch(`/api/investigations/${encodeURIComponent(runId)}/cancel`, { method: "POST", credentials: "include" });
}
