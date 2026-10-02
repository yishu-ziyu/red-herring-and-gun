import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ service: null as any, gate: null as any }));
vi.mock("./lib/runService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/runService.js")>();
  return { ...original, createRunService: (options: any) => {
    fixture.service = original.createRunService(options);
    return fixture.service;
  } };
});

describe("Issue #132: real loopback HTTP SSE boundary", () => {
  it("filters first, reconnect and duplicate sockets, preserving replay and terminal output", async () => {
    fixture.gate = null;
    const handlers = createHandlers({ OPENAI_API_KEY: "synthetic-test-key", OPENAI_BASE_URL: "https://api.test/v1", ORCHESTRATE_TOTAL_TIMEOUT_MS: "5000" });
    const id = `socket-egress-${Date.now()}`;
    let pipelineDone: Promise<unknown> | undefined;
    const server = createServer(async (rawReq, res) => {
      const req: any = rawReq;
      const next = (error?: unknown) => { if (error) { res.statusCode = 500; res.end("handler failed"); } };
      try {
        if (req.method === "POST") {
          let body = "";
          for await (const chunk of req) body += chunk;
          req.body = JSON.parse(body);
          req.checkTicket = { kind: "guest", guestId: id, ipKey: null, settled: false };
          const done = handlers.orchestrateStreamHandler(req, res, next);
          pipelineDone ??= done;
          await done;
        } else {
          req.params = { runId: new URL(req.url, "http://localhost").pathname.split("/")[3] };
          await handlers.investigationEventsHandler(req, res, next);
        }
      } catch (error) { next(error); }
    });
    const abort = new AbortController();
    const streams: Array<{ wire: string; done: Promise<void> }> = [];
    const events = (wire: string) => wire.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing TCP address");
      const base = `http://127.0.0.1:${address.port}`;
      const connect = async (path: string, post = false) => {
        const response = await fetch(base + path, {
          signal: abort.signal,
          ...(post ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim: "离线出口验证说法", clientRequestId: id }) } : {}),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const stream = { wire: "", done: Promise.resolve() };
        streams.push(stream);
        stream.done = (async () => {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            stream.wire += decoder.decode(value, { stream: true });
          }
          stream.wire += decoder.decode();
        })();
        void stream.done.catch(() => {});
        return stream;
      };
      const first = await connect("/api/agent/orchestrate-stream", true);
      await vi.waitFor(() => { expect(fixture.gate).not.toBeNull(); expect(events(first.wire).some(e => e.type === "run_started")).toBe(true); });
      const runId = events(first.wire).find(e => e.type === "run_started").runId;
      const gate = fixture.gate;
      const internal = { systemPrompt: "INTERNAL_SOCKET_PROMPT", userContent: "INTERNAL_SOCKET_INPUT", model: "minimax:socket", latencyMs: 20 };
      openRunStore()!.appendActivities(runId, [{ id: "socket-activity", seq: 1, kind: "search_started", createdAt: 1, text: "公开活动", timestamp: 1, ...internal }] as any);
      openRunStore()!.saveSnapshot(runId, { schemaVersion: 1, originalClaim: "公开说法", phase: "judging", claims: [], sources: [], conflicts: [], ...internal } as any);
      const reconnect = await connect(`/api/investigations/${runId}/events?after=0`);
      const duplicate = await connect("/api/agent/orchestrate-stream", true);
      await vi.waitFor(() => {
        for (const stream of [reconnect, duplicate]) {
          const replay = events(stream.wire);
          expect(replay.find(e => e.type === "run_started").runId).toBe(runId);
          expect(replay.find(e => e.type === "investigation_activity").activity.text).toBe("公开活动");
          expect(replay.find(e => e.type === "investigation_snapshot").investigation.originalClaim).toBe("公开说法");
        }
      });
      expect(fixture.gate).toBe(gate);
      fixture.service.publish(runId, { type: "agent_complete", output: { conclusion: "公开结论", ...internal }, ...internal });
      fixture.service.publish(runId, { type: "tool_error", error: "RAW_SOCKET_ERROR", detail: "RAW_SOCKET_DETAIL", result: { _source: "tool-error", traceText: "RAW_SOCKET_TRACE" } });
      let deep: any = internal;
      for (let i = 0; i < 12; i++) deep = { nested: [deep] };
      fixture.service.publish(runId, { type: "tool_result", result: deep });
      gate.resolve({ steps: [], finalReport: { claim: "离线出口验证说法", verdictType: "unverified", conclusion: "公开结论" }, atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } }, search360Result: {}, memoryCandidates: [] });
      await pipelineDone;
      await Promise.all(streams.map(stream => stream.done));
      for (const [index, stream] of streams.entries()) {
        expect.soft(stream.wire, ["initial POST", "GET reconnect", "duplicate POST"][index]).not.toMatch(/INTERNAL_SOCKET_|RAW_SOCKET_|minimax|systemPrompt|userContent|latencyMs/);
        expect(stream.wire).toContain("公开结论");
        expect.soft(events(stream.wire).find(e => e.type === "tool_error").error, ["initial POST", "GET reconnect", "duplicate POST"][index]).toBe("这一步没能完成，核查会按现有材料继续");
        expect(events(stream.wire).some(e => e.type === "complete")).toBe(true);
      }
    } finally {
      abort.abort();
      fixture.gate?.resolve({ steps: [], finalReport: null });
      await Promise.allSettled(streams.map(stream => stream.done));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 15000);
});
vi.mock("./lib/casePipeline/index.js", () => ({
  runCasePipeline: vi.fn(() => new Promise((resolve) => { fixture.gate = { resolve }; })),
}));
import { openRunStore } from "./lib/runStore.js";
import { createHandlers } from "./handlers.js";

function response() {
  const chunks: string[] = [];
  const res: any = {
    writableEnded: false, destroyed: false,
    writeHead: vi.fn(), setHeader: vi.fn(), getHeader: vi.fn(), on: vi.fn(),
    write: (chunk: string) => { chunks.push(chunk); return true; },
    end: () => { res.writableEnded = true; },
  };
  return { res, chunks, events: () => chunks.filter(c => c.startsWith("data: ")).map(c => JSON.parse(c.slice(6))) };
}
function request(id: string) {
  return { method: "POST", headers: {}, on: vi.fn(),
    body: { claim: "离线出口验证说法", clientRequestId: id },
    checkTicket: { kind: "guest", guestId: id, ipKey: null, settled: false },
  };
}

describe("Issue #132: handler SSE public boundary", () => {
  it("cleans first POST, reconnect replay/live and duplicate POST without rerunning", async () => {
    fixture.gate = null;
    const handlers = createHandlers({ OPENAI_API_KEY: "synthetic-test-key", OPENAI_BASE_URL: "https://api.test/v1", ORCHESTRATE_TOTAL_TIMEOUT_MS: "5000" });
    const first = response();
    const id = `public-egress-${Date.now()}`;
    const done = handlers.orchestrateStreamHandler(request(id), first.res, vi.fn());
    await vi.waitFor(() => expect(fixture.gate).not.toBeNull());
    const service = fixture.service;
    const runId = first.events().find(e => e.type === "run_started").runId;
    const internal = { systemPrompt: "INTERNAL_PROMPT_MARKER", userContent: "INTERNAL_INPUT_MARKER", model: "minimax:test", latencyMs: 20 };
    const activity = { id: "activity-1", seq: 1, kind: "search_started", createdAt: 1, text: "公开活动", timestamp: 1, ...internal };
    openRunStore()!.appendActivities(runId, [activity] as any);
    openRunStore()!.saveSnapshot(runId, { schemaVersion: 1, originalClaim: "公开说法", phase: "judging", claims: [], sources: [], conflicts: [], ...internal } as any);
    const reconnect = response();
    await handlers.investigationEventsHandler({ method: "GET", params: { runId }, headers: {}, url: `/api/investigations/${runId}/events?after=0` }, reconnect.res, vi.fn());
    const duplicate = response();
    const originalGate = fixture.gate;
    await handlers.orchestrateStreamHandler(request(id), duplicate.res, vi.fn());
    expect(fixture.gate).toBe(originalGate);
    for (const stream of [reconnect, duplicate]) {
      expect(stream.events().find(e => e.type === "investigation_activity").activity).toMatchObject({ seq: 1, text: "公开活动" });
      expect(stream.events().find(e => e.type === "investigation_snapshot").investigation.originalClaim).toBe("公开说法");
      expect(stream.events().find(e => e.type === "run_started").runId).toBe(runId);
    }
    service.publish(runId, { type: "agent_complete", output: { conclusion: "公开结论", ...internal }, ...internal });
    service.publish(runId, { type: "tool_error", error: "RAW_ERROR_MARKER", detail: "RAW_DETAIL_MARKER", providerErrors: ["RAW_PROVIDER_MARKER"], result: { _source: "tool-error", traceText: "RAW_TRACE_MARKER", unresolvedEvidenceGaps: ["RAW_GAP_MARKER"] } });
    let deep: any = internal;
    for (let i = 0; i < 12; i++) deep = { nested: [deep] };
    service.publish(runId, { type: "tool_result", result: deep });
    fixture.gate.resolve({ steps: [], finalReport: { claim: "离线出口验证说法", verdictType: "unverified", conclusion: "公开结论" }, atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } }, search360Result: {}, memoryCandidates: [] });
    await done;
    for (const stream of [first, reconnect, duplicate]) {
      const wire = stream.chunks.join("");
      expect(wire).not.toMatch(/INTERNAL_|RAW_|minimax|systemPrompt|userContent|latencyMs/);
      expect(wire).toContain("公开结论");
      expect(stream.events().find(e => e.type === "tool_error").error).toBe("这一步没能完成，核查会按现有材料继续");
      expect(stream.res.writableEnded).toBe(true);
    }
    expect(internal.systemPrompt).toBe("INTERNAL_PROMPT_MARKER");
  });
});
