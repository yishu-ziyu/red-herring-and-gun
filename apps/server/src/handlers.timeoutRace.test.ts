/**
 * 超时竞态验收（契约 docs/evals/2026-09-12-mainpath-p0.md Change C、Evaluator 3）。
 *
 * 每条时序都走完整 HTTP 处理器（建 run、总超时、后台收尾、落库、刷新恢复），只把 runCasePipeline 打桩。
 * 用 40ms 的总时限跑，因为这里关心的是「超时之后发生什么」，不是真等 300 秒。
 *
 *  1) 超时后管线晚完成 → run 落 completed、真结论照发、可经刷新恢复通道取回；
 *  2) 超时后管线最终失败（宽限期内直接抛错）→ run 落 interrupted；
 *  3) 超时后管线彻底不回来（宽限期也过）→ 现有时限中断收尾：中间结论 + interrupted；
 *  4) 超时后用户离开页面 → 不再中止管线，晚完成的结果仍可刷新取回。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  claim: "某市下周将试点无人驾驶公交。",
  conclusion: "这条说法目前查不到可靠依据，试点消息也没有权威出处。",
  atom: "某市下周试点无人驾驶公交",
  /** 管线被调用时把控制柄交给测试：由测试决定什么时候完成 / 失败 / 永不回来。 */
  gate: null as null | {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    input: any;
  },
}));

vi.mock("./lib/casePipeline/index.js", () => ({
  runCasePipeline: (input: any) =>
    new Promise((resolve, reject) => {
      fixture.gate = { resolve, reject, input };
    }),
}));

import {
  createHandlers,
  PIPELINE_LATE_GRACE_MS_DEFAULT,
  PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT,
} from "./handlers.js";
import { buildInvestigationSnapshot } from "./lib/investigation/index.js";
import { openRunStore } from "./lib/runStore.js";

const TOTAL_TIMEOUT_MS = 40;

function env(graceMs = 400): Record<string, string> {
  return {
    OPENAI_API_KEY: "env-key",
    OPENAI_BASE_URL: "https://api.test/v1",
    ORCHESTRATE_TOTAL_TIMEOUT_MS: String(TOTAL_TIMEOUT_MS),
    ORCHESTRATE_LATE_GRACE_MS: String(graceMs),
  };
}

function mockRes() {
  const events: Record<string, any>[] = [];
  const listeners: Record<string, () => void> = {};
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
    on: vi.fn((name: string, listener: () => void) => {
      listeners[name] = listener;
    }),
  };
  /** 模拟用户关页/刷新：连接关闭，服务端收到 close。 */
  const closeConnection = () => {
    res.destroyed = true;
    listeners.close?.();
  };
  return { res, events, closeConnection };
}

function makeRequest(clientRequestId: string) {
  const ticket: any = {
    kind: "guest",
    guestId: `timeout-${clientRequestId}`,
    ipKey: null,
    settled: false,
  };
  const req: any = {
    method: "POST",
    body: { claim: fixture.claim, clientRequestId },
    checkTicket: ticket,
    headers: { "x-real-ip": "203.0.113.31" },
    on: vi.fn(),
  };
  return { req, ticket };
}

/** 完成态快照：phase=complete 且带真结论（刷新恢复通道取回的正是它）。 */
function completeSnapshot() {
  return buildInvestigationSnapshot(
    {
      originalClaim: fixture.claim,
      phase: "complete",
      claimAtoms: [fixture.atom],
      claimAtomTypes: [{ text: fixture.atom, verifiable: true, type: "fact" }],
      atomSearchBundle: { atomsSearched: [fixture.atom], byAtomKey: {} },
      subclaimVerdicts: [
        {
          claimAtom: fixture.atom,
          verdict: "unverified",
          evidence: "没有权威出处",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["缺官方公告"],
        },
      ],
      report: { conclusion: fixture.conclusion, verdictType: "unverified" },
    },
    { claimAtomKeyFn: (s: string) => s.trim() }
  );
}

function pipelineResult() {
  return {
    steps: [],
    finalReport: { claim: fixture.claim, verdictType: "unverified", conclusion: fixture.conclusion },
    atomSearchBundle: {
      atomsSearched: [fixture.atom],
      byAtomKey: {},
      aggregate: { sources: [] },
    },
    search360Result: {},
    memoryCandidates: [],
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 走到「服务端已经发出超时帧、管线还挂着」这一刻。 */
async function runUntilTimeout(handlers: ReturnType<typeof createHandlers>, clientRequestId: string) {
  const { req, ticket } = makeRequest(clientRequestId);
  const { res, events, closeConnection } = mockRes();
  const done = handlers.orchestrateStreamHandler(req, res, vi.fn());
  await waitFor(() => fixture.gate !== null);
  await waitFor(() => events.some((event) => event.type === "timeout_pending"));
  const runId = events.find((event) => event.type === "run_started")!.runId as string;
  return { req, ticket, res, events, done, runId, closeConnection };
}

beforeEach(() => {
  fixture.gate = null;
});

describe("Change C：总时限默认值与内部预算不打架", () => {
  it("管道总时限默认 420s（给 MiniMax-M2.7 作判断 180s 留余量），超时后的收尾宽限有界", () => {
    expect(PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT).toBe(420_000);
    expect(PIPELINE_LATE_GRACE_MS_DEFAULT).toBe(120_000);
  });
});

describe("Change C：超时后管线晚完成", () => {
  it("run 落 completed，真结论照发，并经刷新恢复通道可取回", async () => {
    const handlers = createHandlers(env());
    const { ticket, events, done, runId } = await runUntilTimeout(handlers, "req-timeout-late");

    // 超时这一刻：不许写死 interrupted，也不许发伪结论
    expect(openRunStore()!.get(runId)!.status).not.toBe("interrupted");
    expect(events.some((event) => event.type === "complete")).toBe(false);

    // 管线在超时之后才收尾（真实走查里是晚了 16 秒）
    const snapshot = completeSnapshot();
    fixture.gate!.input.hooks.onInvestigationSnapshot(snapshot);
    fixture.gate!.resolve(pipelineResult());
    await done;

    // 1) 真结论送到了这条流上，且只可能在超时帧之后
    const complete = events.find((event) => event.type === "complete")!;
    expect(complete.finalReport.conclusion).toBe(fixture.conclusion);
    expect(events.findIndex((event) => event.type === "timeout_pending")).toBeLessThan(events.indexOf(complete));

    // 2) run 落 complete（不是 interrupted）
    const run = openRunStore()!.get(runId)!;
    expect(run.status).toBe("completed");
    expect(run.snapshot?.phase).toBe("complete");
    expect(ticket.settled).toBe(true);

    // 3) 刷新恢复通道：补发的帧里就有那份带结论的快照
    const { res: resumeRes, events: resumeEvents } = mockRes();
    await handlers.investigationEventsHandler(
      {
        method: "GET",
        params: { runId },
        url: `/api/investigations/${runId}/events?after=0`,
        headers: {},
        on: vi.fn(),
      },
      resumeRes,
      vi.fn()
    );
    expect(resumeRes.statusCode).toBe(0);
    const replayed = resumeEvents.find((event) => event.type === "investigation_snapshot")!;
    expect(replayed.investigation.phase).toBe("complete");
    expect(replayed.investigation.conclusion.directAnswer).toContain("查不到可靠依据");
    const replayedState = resumeEvents[resumeEvents.length - 1]!;
    expect(replayedState).toEqual(
      expect.objectContaining({ type: "run_state", status: "completed", terminal: true })
    );
  });
});

describe("Change C：超时后管线最终失败", () => {
  it("宽限期内直接抛错 → run 落 interrupted，用户拿到中断帧与错误提示", async () => {
    const handlers = createHandlers(env());
    const { events, done, runId } = await runUntilTimeout(handlers, "req-timeout-fail");

    fixture.gate!.reject(new Error("上游 provider 全部失败"));
    await done;

    expect(openRunStore()!.get(runId)!.status).toBe("interrupted");
    expect(events.some((event) => event.type === "error")).toBe(true);
    const interrupted = events.find(
      (event) => event.type === "investigation_snapshot" && event.investigation?.phase === "interrupted"
    );
    expect(interrupted).toBeTruthy();
    const state = events.filter((event) => event.type === "run_state").pop()!;
    expect(state.status).toBe("interrupted");
    expect(state.terminal).toBe(true);
  });

  it("宽限期到仍不回来 → 走现有时限中断收尾（中间结论 + interrupted）", async () => {
    const handlers = createHandlers(env(TOTAL_TIMEOUT_MS));
    const { events, done, runId, res } = await runUntilTimeout(handlers, "req-timeout-zombie");

    // 管线永不回来：宽限期到就按中断收尾，不能一直挂着
    await done;

    expect(openRunStore()!.get(runId)!.status).toBe("interrupted");
    const complete = events.find((event) => event.type === "complete")!;
    expect(complete.finalReport._source).toBe("error-boundary");
    expect(events.filter((event) => event.type === "run_state").pop()!.status).toBe("interrupted");
    expect(res.writableEnded).toBe(true);
  });
});

describe("Change C：超时后用户离开页面", () => {
  it("离开不再中止管线；晚完成仍落 completed，刷新回来能取回结论", async () => {
    const handlers = createHandlers(env());
    const { done, runId, closeConnection } = await runUntilTimeout(handlers, "req-timeout-left");

    // 用户按界面提示离开（关页/刷新）→ 服务端收到 close
    closeConnection();
    // 这条连接已经不是管线的生命线：信号不许被 abort
    expect(fixture.gate!.input.signal.aborted).toBe(false);

    const snapshot = completeSnapshot();
    fixture.gate!.input.hooks.onInvestigationSnapshot(snapshot);
    fixture.gate!.resolve(pipelineResult());
    await done;

    const run = openRunStore()!.get(runId)!;
    expect(run.status).toBe("completed");
    expect(run.snapshot?.phase).toBe("complete");

    // 人回来重新贴上 runId → 补发的帧里就有结论
    const { res: resumeRes, events: resumeEvents } = mockRes();
    await handlers.investigationEventsHandler(
      { method: "GET", params: { runId }, url: `/api/investigations/${runId}/events?after=0`, headers: {}, on: vi.fn() },
      resumeRes,
      vi.fn()
    );
    const replayed = resumeEvents.find((event) => event.type === "investigation_snapshot")!;
    expect(replayed.investigation.conclusion.directAnswer).toContain("查不到可靠依据");
  });
});
