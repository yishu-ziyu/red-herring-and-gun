import { replay, type Case, type CaseEvent } from '@rhg/core/casefile';
import { loadFixture } from "./catalog.js";
import { NETWORK_ERROR, TURN_BUSY } from "./copy.js";

export type CaseSnapshot = {
  case: Case;
  events: CaseEvent[];
  running: boolean;
};

export type CaseListItem = {
  caseId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  verdictType?: string;
};

export type PostTurnResult = { ok: true; turnId?: string } | { ok: false; status: number; error: string };

const FIXTURE_TICK_MS = 150;

class FixtureSource extends EventTarget {
  readyState = 1;
  url = "";
  withCredentials = false;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private remaining: CaseEvent[];

  constructor(events: CaseEvent[], since: number) {
    super();
    this.remaining = events.filter((event) => event.seq > since);
    this.timer = setInterval(() => {
      const next = this.remaining.shift();
      if (!next) {
        this.close();
        return;
      }
      const ev = new MessageEvent("case.event", { data: JSON.stringify(next) });
      this.dispatchEvent(ev);
      this.onmessage?.(ev);
    }, FIXTURE_TICK_MS);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.readyState = 2;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export type Attachment = { kind: "url" | "image"; value: string };

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function createCase(
  text: string,
  attachments?: Attachment[],
): Promise<{ caseId: string; turnId: string }> {
  let res: Response;
  try {
    res = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attachments?.length ? { text, attachments } : { text }),
    });
  } catch {
    throw new TypeError(NETWORK_ERROR);
  }
  if (!res.ok) throw new ApiError(await readError(res, "立案失败"), res.status);
  return (await res.json()) as { caseId: string; turnId: string };
}

export async function getCase(caseId: string): Promise<CaseSnapshot> {
  const fixture = loadFixture(caseId);
  if (fixture) {
    const events = fixture.events.slice(0, fixture.cutAt);
    return { case: replay(events), events, running: fixture.cutAt < fixture.events.length };
  }
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
  if (!res.ok) throw new Error(await readError(res, "读不到这案"));
  return (await res.json()) as CaseSnapshot;
}

export async function listCases(): Promise<CaseListItem[]> {
  const res = await fetch("/api/cases");
  if (!res.ok) throw new Error(await readError(res, "列案件失败"));
  return (await res.json()) as CaseListItem[];
}

export async function postTurn(caseId: string, text: string, pivotId?: string): Promise<PostTurnResult> {
  if (loadFixture(caseId)) return { ok: true };
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pivotId ? { text, pivotId } : { text }),
  });
  if (res.status === 409) {
    return { ok: false, status: 409, error: await readError(res, TURN_BUSY) };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res, "这一轮没发出去") };
  }
  const body = (await res.json()) as { turnId?: string };
  return { ok: true, turnId: body.turnId };
}

export async function abortTurn(caseId: string): Promise<void> {
  if (loadFixture(caseId)) return;
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/abort`, { method: "POST" });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res, "中止失败"));
}

export function openStream(caseId: string, since: number): EventSource {
  const fixture = loadFixture(caseId);
  if (fixture) return new FixtureSource(fixture.events, since) as unknown as EventSource;
  return new EventSource(`/api/cases/${encodeURIComponent(caseId)}/stream?since=${since}`);
}
