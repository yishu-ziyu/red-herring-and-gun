/**
 * R11：接回流（GET /api/investigations/:runId/events）与同 clientRequestId 重复提交的订阅，
 * 每一帧与首次提交的流一样先过 toPublicStreamEvent（契约 docs/evals/2026-09-29-r11-r12-fixes.md）。
 * 只把 runCasePipeline 打桩，其余走完整处理器与真实总线。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  gate: null as null | { resolve: (v: unknown) => void; input: any },
}));

vi.mock("./lib/casePipeline/index.js", () => ({
  runCasePipeline: (input: any) =>
    new Promise((resolve) => {
      fixture.gate = { resolve, input };
    }),
}));

import { createHandlers } from "./handlers.js";

const ENV = {
  OPENAI_API_KEY: "env-key",
  OPENAI_BASE_URL: "https://api.test/v1",
  ORCHESTRATE_TOTAL_TIMEOUT_MS: "5000",
};

function mockRes() {
  const events: Record<string, any>[] = [];
  const res: any = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn((chunk: string) => {
      if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice("data: ".length)));
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    on: vi.fn(),
  };
  return { res, events };
}

function makeRequest(clientRequestId: string) {
  return {
    method: "POST",
    body: { claim: "某市下周将试点无人驾驶公交。", clientRequestId },
    checkTicket: { kind: "guest", guestId: `scrub-${clientRequestId}`, ipKey: null, settled: false },
    headers: { "x-real-ip": "203.0.113.51" },
    on: vi.fn(),
  } as any;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 一帧里不许出现的私有内容。 */
function assertPublic(events: Record<string, any>[]) {
  const text = JSON.stringify(events);
  expect(text).not.toContain("latencyMs");
  expect(text).not.toContain("systemPrompt");
  expect(text).not.toContain("minimax:MiniMax-M2");
  // 工具错误的 error 字段是通用文案（result.traceText 的既有行为与首次提交的流一致，不在本契约内）
  for (const e of events.filter((x) => x.type === "tool_error")) {
    expect(e.error).toBe("这一步没能完成，核查会按现有材料继续");
  }
}

/** 触发两条带私有字段的原始总线事件：tool_result（model、latencyMs、systemPrompt）与 tool_error（原始报错）。 */
function emitRawEvents(hooks: any) {
  hooks.onAtomSearchResult("某市试点无人驾驶公交", {
    model: "minimax:MiniMax-M2.7",
    latencyMs: 1234,
    systemPrompt: "SECRET PROMPT",
    ok: true,
  });
  hooks.onAtomSearchResult("某市试点无人驾驶公交", { _source: "tool-error", traceText: "RAW-PROVIDER-ERROR" });
}

beforeEach(() => {
  fixture.gate = null;
});

describe("R11：订阅流的公开清洗", () => {
  it("同 clientRequestId 重复提交：直播帧不带私有字段，且不改变首次流，run_state 仍能关流", async () => {
    const handlers = createHandlers(ENV);
    const id = `scrub-dup-${Date.now()}`;
    const first = mockRes();
    const done = handlers.orchestrateStreamHandler(makeRequest(id), first.res, vi.fn());
    await waitFor(() => fixture.gate !== null);
    const dup = mockRes();
    const dupDone = handlers.orchestrateStreamHandler(makeRequest(id), dup.res, vi.fn());
    await waitFor(() => dup.events.some((e) => e.type === "run_started"));

    emitRawEvents(fixture.gate!.input.hooks);
    await waitFor(() => dup.events.filter((e) => e.type === "tool_error").length > 0);

    const result = dup.events.find((e) => e.type === "tool_result")!;
    expect(result.result.ok).toBe(true);
    expect(result.query).toBe("某市试点无人驾驶公交");
    assertPublic(dup.events);
    assertPublic(first.events);
    expect(first.events.find((e) => e.type === "tool_result")!.result.ok).toBe(true);

    fixture.gate!.resolve({
      steps: [],
      finalReport: { claim: "x", verdictType: "unverified", conclusion: "查不到" },
      atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } },
      search360Result: {},
      memoryCandidates: [],
    });
    await done;
    await dupDone;
    expect(dup.res.writableEnded).toBe(true);
    expect(dup.events.some((e) => e.type === "run_state" && e.terminal === true)).toBe(true);
  });

  it("接回流：补发的活动/快照与直播帧都不带私有字段，runId / status / terminal 保留", async () => {
    const handlers = createHandlers(ENV);
    const first = mockRes();
    const done = handlers.orchestrateStreamHandler(makeRequest(`scrub-resume-${Date.now()}`), first.res, vi.fn());
    await waitFor(() => fixture.gate !== null);
    const runId = first.events.find((e) => e.type === "run_started")!.runId as string;

    const resume = mockRes();
    await handlers.investigationEventsHandler(
      { method: "GET", params: { runId }, url: `/api/investigations/${runId}/events?after=0`, headers: {}, on: vi.fn() },
      resume.res,
      vi.fn()
    );
    emitRawEvents(fixture.gate!.input.hooks);
    await waitFor(() => resume.events.some((e) => e.type === "tool_error"));
    assertPublic(resume.events);
    expect(resume.events[0]).toEqual(expect.objectContaining({ type: "run_started", runId }));
    expect(resume.events.find((e) => e.type === "run_state")).toEqual(
      expect.objectContaining({ status: expect.any(String), terminal: false })
    );
    fixture.gate!.resolve({
      steps: [],
      finalReport: { claim: "x", verdictType: "unverified", conclusion: "查不到" },
      atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } },
      search360Result: {},
      memoryCandidates: [],
    });
    await done;
  });
});
