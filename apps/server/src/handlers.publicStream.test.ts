import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ service: null as any, gate: null as any }));
vi.mock("./lib/runService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/runService.js")>();
  return { ...original, createRunService: (options: any) => {
    fixture.service = original.createRunService(options);
    return fixture.service;
  } };
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

describe("Issue #132: HTTP SSE public boundary", () => {
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
