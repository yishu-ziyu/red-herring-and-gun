import { replay, type Case, type CaseEvent } from '@rhg/core/casefile';
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCaseStream, type StreamApi } from "./useCaseStream.js";

const AT = "2026-09-03T12:00:00.000Z";

function created(id = "case-1"): CaseEvent {
  return { type: "case.created", seq: 1, at: AT, id, text: "原句" };
}

function claimsAdded(): CaseEvent {
  return {
    type: "claims.added",
    seq: 2,
    at: AT,
    claims: [{ id: "c1", text: "原句", type: "fact", checkable: true, order: 0 }],
  };
}

function evidenceAdded(): CaseEvent {
  return {
    type: "evidence.added",
    seq: 3,
    at: AT,
    evidence: {
      id: "e1",
      url: "https://www.gov.cn/x",
      canonicalUrl: "https://gov.cn/x",
      host: "gov.cn",
      excerpt: "通报",
      retrievedAt: AT,
      tier: "A",
      provenance: { kind: "user" },
    },
  };
}

class FakeSource extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 1;
  url = "";
  withCredentials = false;
  onopen = null;
  onmessage = null;
  onerror: ((this: EventSource, ev: Event) => void) | null = null;
  closed = false;
  emit(event: CaseEvent) {
    this.dispatchEvent(new MessageEvent("case.event", { data: JSON.stringify(event) }));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function apiWith(events: CaseEvent[], cutAt: number) {
  const sources: FakeSource[] = [];
  let getCaseCalls = 0;
  const api: StreamApi = {
    getCase: async () => {
      getCaseCalls += 1;
      const slice = events.slice(0, cutAt);
      return { case: replay(slice), events: slice, running: true };
    },
    openStream: () => {
      const source = new FakeSource();
      sources.push(source);
      return source as unknown as EventSource;
    },
    postTurn: async () => ({ ok: true }),
    abortTurn: async () => undefined,
  };
  return { api, sources, getCaseCount: () => getCaseCalls };
}

afterEach(() => {
  cleanup();
});

describe("useCaseStream", () => {
  it("顺序应用后状态 toEqual replay(全部事件)", async () => {
    const events = [created(), claimsAdded(), evidenceAdded()];
    const { api, sources } = apiWith(events, 1);
    const hook = renderHook(() => useCaseStream("case-1", api));
    await waitFor(() => expect(hook.result.current.case).not.toBeNull());
    await act(async () => {
      sources[0]?.emit(events[1]!);
      sources[0]?.emit(events[2]!);
    });
    expect(hook.result.current.case).toEqual(replay(events));
  });

  it("收到 seq 跳号则重新 getCase 并重开流，最终状态 toEqual replay", async () => {
    const events = [created(), claimsAdded(), evidenceAdded()];
    let cut = 1;
    const sources: FakeSource[] = [];
    const api: StreamApi = {
      getCase: async () => {
        const slice = events.slice(0, cut);
        return { case: replay(slice) as Case, events: slice, running: true };
      },
      openStream: () => {
        const source = new FakeSource();
        sources.push(source);
        return source as unknown as EventSource;
      },
      postTurn: async () => ({ ok: true }),
      abortTurn: async () => undefined,
    };
    const hook = renderHook(() => useCaseStream("case-1", api));
    await waitFor(() => expect(hook.result.current.case?.seq).toBe(1));
    await act(async () => {
      cut = 3;
      sources[0]?.emit(events[2]!);
    });
    await waitFor(() => expect(hook.result.current.case).toEqual(replay(events)));
    expect(sources[0]?.closed).toBe(true);
    expect(sources.length).toBeGreaterThan(1);
  });

  it("重复 seq 被丢弃", async () => {
    const events = [created(), claimsAdded()];
    const { api, sources } = apiWith(events, 2);
    const hook = renderHook(() => useCaseStream("case-1", api));
    await waitFor(() => expect(hook.result.current.case?.seq).toBe(2));
    const before = hook.result.current.case;
    await act(async () => {
      sources[0]?.emit(events[1]!);
    });
    expect(hook.result.current.case).toEqual(before);
  });

  it("sendTurn 遇 409 → status === error 且不抛", async () => {
    const events = [created()];
    const { api } = apiWith(events, 1);
    api.postTurn = async () => ({ ok: false, status: 409, error: "这一案还在查，等这轮结束再问。" });
    const hook = renderHook(() => useCaseStream("case-1", api));
    await waitFor(() => expect(hook.result.current.case).not.toBeNull());
    await act(async () => {
      await expect(hook.result.current.sendTurn("追问")).resolves.toBeUndefined();
    });
    expect(hook.result.current.status).toBe("error");
  });
});
