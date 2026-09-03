import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase, reduce, replay } from "../casefile/reduce.js";
import type { Case, CaseEvent } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import type { SearchHit, SearchProviderFn } from "../search/searchAll.js";
import { createStageContext, type LlmJob } from "../stages/context.js";
import type { InvestigatorTools } from "../stages/investigate.js";
import { OFF_TOPIC_REPLY } from "../text/publicCopy.js";
import { runTurn, type RunTurnDeps, type RunTurnInput } from "./runTurn.js";

const AT = "2026-09-03T12:00:00.000Z";
const TEXT = "人社部发文说生育津贴直接打到个人卡里了";
const SNIPPET = "官方通报此事不实，津贴由单位申领。";
const PIPELINE = [
  "intake",
  "decompose",
  "retrieve",
  "assess",
  "judge",
  "investigate",
  "crossExam",
  "compose",
  "finalize",
] as const;

function govHits(): SearchProviderFn {
  return async function gov(): Promise<SearchHit[]> {
    return [{ url: "https://www.gov.cn/zhengce/allowance", title: "通报", snippet: SNIPPET }];
  };
}

function idleTools(): InvestigatorTools {
  return {
    search: async () => [],
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  };
}

function script() {
  return {
    decompose: { claims: [{ text: TEXT, type: "fact" as const, checkable: true }] },
    "self-proof": { results: [] },
    assess: {
      stances: [
        {
          evidenceId: "e1",
          stance: "refutes" as const,
          quote: "官方通报此事不实",
          confidence: 0.9,
        },
      ],
    },
    compose: {
      conclusion: "生育津贴不会直接打到个人卡里，仍由单位申领。",
      claimItems: [{ claimId: "c1", line: "生育津贴直接打到个人卡：与现有依据相反。[1]" }],
    },
    investigate: { action: { kind: "stop" as const, target: "", why: "没有缺口" } },
  };
}

function deps(overrides: Partial<RunTurnDeps> = {}): RunTurnDeps {
  return {
    llm: overrides.llm ?? createFakeLlm(script()),
    searchProviders: overrides.searchProviders ?? [govHits()],
    tools: overrides.tools ?? idleTools(),
    providers: overrides.providers ?? [
      { provider: "deepseek", model: "fake-a" },
      { provider: "stepfun", model: "fake-b" },
    ],
    now: overrides.now ?? (() => AT),
    ...(overrides.clock ? { clock: overrides.clock } : {}),
  };
}

function input(c: Case, extra: Partial<RunTurnInput> = {}): RunTurnInput {
  return {
    case: c,
    message: extra.message ?? { text: TEXT },
    route: extra.route ?? "new_claim",
    deps: extra.deps ?? deps(),
    ...(extra.budget ? { budget: extra.budget } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  };
}

async function collect(iter: AsyncIterable<CaseEvent>): Promise<CaseEvent[]> {
  const out: CaseEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function startedStages(events: CaseEvent[]): string[] {
  const stages: string[] = [];
  for (const event of events) {
    if (event.type !== "stage.started") continue;
    if (stages[stages.length - 1] !== event.stage) stages.push(event.stage);
  }
  return stages;
}

function assertPipelineOrder(events: CaseEvent[]): void {
  expect(events[0]?.type).toBe("turn.started");
  expect(events.at(-1)?.type).toBe("turn.finished");
  const msgs = events.filter((event) => event.type === "message.added");
  expect(msgs.map((event) => (event.type === "message.added" ? event.message.role : ""))).toEqual([
    "user",
    "assistant",
  ]);
  const got = startedStages(events);
  let last = -1;
  for (const stage of got) {
    const idx = PIPELINE.indexOf(stage as (typeof PIPELINE)[number]);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeGreaterThanOrEqual(last);
    last = idx;
  }
  expect(got[0]).toBe("intake");
  expect(got.at(-1)).toBe("finalize");
}

function assertReplay(created: CaseEvent[], turnEvents: CaseEvent[], start: Case): void {
  const snapshot = turnEvents.reduce(reduce, start);
  expect(replay([...created, ...turnEvents])).toEqual(snapshot);
  assertInvariants(snapshot);
}

function llmJobs(events: CaseEvent[]): string[] {
  return events.filter((event) => event.type === "llm.called").map((event) => event.job);
}

describe("runTurn", () => {
  it("事件顺序符合阶段顺序，reason=done，跑过的 LLM 阶段有 llm.called，replay 等于快照", async () => {
    const { case: c, events: created } = createCase({ id: "case-t13", text: TEXT, at: AT });
    const events = await collect(runTurn(input(c)));
    assertPipelineOrder(events);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    const started = new Set(startedStages(events));
    const jobs = llmJobs(events);
    for (const job of ["decompose", "assess", "compose"] as const) {
      if (started.has(job === "compose" ? "compose" : job)) {
        expect(jobs).toContain(job);
      }
    }
    expect(jobs.some((job) => job === "intake")).toBe(false);
    assertReplay(created, events, c);
  });

  it("剩余时间不足时 investigate 被 skipped，报告仍产出，reason=timeout", async () => {
    const time = { ms: 0 };
    const { case: c, events: created } = createCase({ id: "case-timeout", text: TEXT, at: AT });
    const search: SearchProviderFn = async () => {
      time.ms = 100_000;
      return [{ url: "https://www.gov.cn/zhengce/allowance", title: "通报", snippet: SNIPPET }];
    };
    const events = await collect(
      runTurn(
        input(c, {
          deps: deps({ clock: () => time.ms, searchProviders: [search] }),
          budget: { totalMs: 120_000, composeReserveMs: 30_000 },
        }),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "timeout" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "stage.finished", stage: "investigate", outcome: "skipped" }),
    );
    expect(events.some((event) => event.type === "report.finalized")).toBe(true);
    const assistant = events.filter((event) => event.type === "message.added").at(-1);
    expect(assistant?.type === "message.added" ? assistant.message.role : "").toBe("assistant");
    expect(assistant?.type === "message.added" ? assistant.message.text.length : 0).toBeGreaterThan(0);
    assertReplay(created, events, c);
  });

  it("retrieve 前 abort 后最多再出现一个阶段，reason=aborted", async () => {
    const ac = new AbortController();
    const inner = createFakeLlm(script());
    const llm: LlmJob = async (params) => {
      if (params.job === "decompose") {
        await new Promise<void>((resolve) => {
          if (ac.signal.aborted) {
            resolve();
            return;
          }
          ac.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return inner(params);
    };
    const { case: c } = createCase({ id: "case-abort", text: TEXT, at: AT });
    const events: CaseEvent[] = [];
    let afterAbort = false;
    const stagesAfterAbort: string[] = [];
    for await (const event of runTurn(input(c, { deps: deps({ llm }), signal: ac.signal }))) {
      events.push(event);
      if (afterAbort && event.type === "stage.started") stagesAfterAbort.push(event.stage);
      if (!afterAbort && event.type === "stage.finished" && event.stage === "intake") {
        ac.abort();
        afterAbort = true;
      }
    }
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "aborted" });
    expect(new Set(stagesAfterAbort).size).toBeLessThanOrEqual(1);
    expect(events.some((event) => event.type === "stage.started" && event.stage === "retrieve")).toBe(
      false,
    );
    expect(events.some((event) => event.type === "stage.started" && event.stage === "compose")).toBe(
      false,
    );
    expect(events.some((event) => event.type === "stage.started" && event.stage === "finalize")).toBe(
      false,
    );
  });

  it("intake fetch 抛 TypeError 时 reason=error，仍产出报告", async () => {
    const { case: c, events: created } = createCase({ id: "case-error", text: TEXT, at: AT });
    const events = await collect(
      runTurn(
        input(c, {
          message: { text: TEXT, attachments: [{ kind: "url", value: "https://example.com/x" }] },
          deps: deps({
            tools: {
              search: async () => [],
              fetch: async () => {
                throw new TypeError("intake fetch exploded");
              },
            },
          }),
        }),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "error" });
    const err = events.find((event) => event.type === "error" && event.stage === "intake");
    expect(err).toMatchObject({ type: "error", stage: "intake", message: "intake fetch exploded" });
    expect(events.some((event) => event.type === "report.finalized")).toBe(true);
    assertReplay(created, events, c);
  });

  it("同案并发第二轮被拒：只有一条 error，不发 turn 事件", async () => {
    const { case: c } = createCase({ id: "case-lock", text: TEXT, at: AT });
    const first = runTurn(input(c));
    const second = await collect(runTurn(input(c)));
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      type: "error",
      stage: "runner",
      message: "该案件已有一轮在运行",
    });
    expect(second.some((event) => event.type === "turn.started" || event.type === "turn.finished")).toBe(
      false,
    );
    const firstEvents = await collect(first);
    expect(firstEvents.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
  });

  it("消费者 break 出 for-await 不抛", async () => {
    const { case: c } = createCase({ id: "case-break", text: TEXT, at: AT });
    let threw: unknown;
    try {
      for await (const event of runTurn(input(c))) {
        expect(event.type).toBe("turn.started");
        break;
      }
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeUndefined();
  });

  it("缺省 route 时调用 routeMessage，显式传入时不调", async () => {
    const { case: empty } = createCase({ id: "case-omit-empty", text: TEXT, at: AT });
    const fakeEmpty = createFakeLlm(script());
    const emptyEvents = await collect(
      runTurn({ case: empty, message: { text: TEXT }, deps: deps({ llm: fakeEmpty }) }),
    );
    expect(fakeEmpty.calls.some((call) => call.job === "route")).toBe(false);
    const emptyUser = emptyEvents.find((event) => event.type === "message.added");
    expect(emptyUser?.type === "message.added" && emptyUser.message.route).toBe("new_claim");

    const { case: raw } = createCase({ id: "case-omit-claims", text: TEXT, at: AT });
    const prep = createStageContext({ case: raw, llm: createFakeLlm({}), now: () => AT });
    prep.emit({
      type: "claims.added",
      claims: [{ id: "c1", text: TEXT, type: "fact", checkable: true, order: 0 }],
    });
    const fakeDefault = createFakeLlm({ route: { route: "off_topic" } });
    const defaultEvents = await collect(
      runTurn({
        case: prep.current,
        message: { text: "现在判得怎样" },
        deps: deps({ llm: fakeDefault }),
      }),
    );
    expect(fakeDefault.calls.some((call) => call.job === "route")).toBe(true);
    const defaultUser = defaultEvents.find((event) => event.type === "message.added");
    expect(defaultUser?.type === "message.added" && defaultUser.message.route).toBe("off_topic");
    expect(defaultEvents.filter((event) => event.type === "message.added").at(-1)).toMatchObject({
      message: { role: "assistant", text: OFF_TOPIC_REPLY },
    });

    const fakeExplicit = createFakeLlm({ route: { route: "off_topic" }, ...script() });
    const { case: explicitCase } = createCase({ id: "case-explicit", text: TEXT, at: AT });
    const explicitEvents = await collect(
      runTurn(input(explicitCase, { deps: deps({ llm: fakeExplicit }), route: "new_claim" })),
    );
    expect(fakeExplicit.calls.some((call) => call.job === "route")).toBe(false);
    const explicitUser = explicitEvents.find((event) => event.type === "message.added");
    expect(explicitUser?.type === "message.added" && explicitUser.message.route).toBe("new_claim");
    expect(explicitEvents.some((event) => event.type === "stage.started" && event.stage === "intake")).toBe(
      true,
    );
  });
});
