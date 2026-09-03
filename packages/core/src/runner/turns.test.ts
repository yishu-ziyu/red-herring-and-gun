import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase, reduce, replay } from "../casefile/reduce.js";
import type { Case, CaseEvent, Evidence, Pivot, Report } from "../casefile/schema.js";
import type { FetchedPage } from "../fetch/types.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext } from "../stages/context.js";
import type { InvestigatorTools } from "../stages/investigate.js";
import { ASK_CASE_FALLBACK, CHALLENGE_UNREACHABLE, OFF_TOPIC_REPLY } from "../text/publicCopy.js";
import { runTurn, type RunTurnDeps } from "./runTurn.js";

const AT = "2026-09-03T12:00:00.000Z";
const TEXT = "人社部发文说生育津贴直接打到个人卡里了";
const GOV_URL = "https://www.gov.cn/zhengce/allowance-follow";
const GOV_TEXT = "人社部从未发文称生育津贴直接打到个人卡。通知明确：津贴拨付至用人单位，标准 3200 元。";
const EVIL_URL = "https://evil.example/rumor";

function page(partial: Partial<FetchedPage> & Pick<FetchedPage, "finalUrl" | "text">): FetchedPage {
  return {
    status: 200,
    contentType: "text/html",
    links: [],
    images: [],
    reachable: true,
    charset: "utf-8",
    ...partial,
  };
}

function govEvidence(): Evidence {
  return {
    id: "e1",
    url: "https://www.gov.cn/zhengce/allowance",
    canonicalUrl: "https://gov.cn/zhengce/allowance",
    host: "gov.cn",
    title: "通报",
    excerpt: "津贴由单位申领，标准 3200 元。",
    text: "官方通报此事不实，津贴由单位申领，标准 3200 元。",
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "user" },
  };
}

function nextPivot(): Pivot {
  return {
    id: "p-mohrss",
    kind: "entity",
    value: "人社部",
    why: "当事方",
    expectedValue: 2,
    depth: 1,
  };
}

function seedReport(): Report {
  return {
    conclusion: "生育津贴不会直接打到个人卡里，仍由单位申领。",
    claimItems: [{ claimId: "c1", line: "与现有依据相反。[1]", citations: [1] }],
    citations: [{ n: 1, evidenceId: "e1" }],
    finalizedAt: AT,
  };
}

function composeScript() {
  return {
    conclusion: "生育津贴不会直接打到个人卡里，仍由单位申领。",
    claimItems: [{ claimId: "c1", line: "生育津贴直接打到个人卡：与现有依据相反。[1]" }],
  };
}

function assessRefute(evidenceId: string) {
  return {
    stances: [
      {
        evidenceId,
        stance: "refutes" as const,
        quote: "人社部从未发文称生育津贴直接打到个人卡",
        confidence: 0.9,
      },
    ],
  };
}

type SeedOpts = {
  id: string;
  evidence?: boolean;
  frontier?: boolean;
  report?: boolean;
  verdict?: boolean;
};

function seedCase(opts: SeedOpts): { start: Case; prelude: CaseEvent[] } {
  const { case: raw, events: created } = createCase({ id: opts.id, text: TEXT, at: AT });
  const ctx = createStageContext({ case: raw, llm: createFakeLlm({}), now: () => AT });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: TEXT, type: "fact", checkable: true, order: 0 }],
  });
  if (opts.evidence) ctx.emit({ type: "evidence.added", evidence: govEvidence() });
  if (opts.verdict) {
    ctx.emit({
      type: "verdict.updated",
      verdict: { claimId: "c1", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
    });
  }
  if (opts.frontier) ctx.emit({ type: "frontier.added", pivots: [nextPivot()] });
  if (opts.report) ctx.emit({ type: "report.finalized", report: seedReport() });
  return { start: ctx.current, prelude: [...created, ...ctx.emitted] };
}

function countingTools(fetchImpl?: InvestigatorTools["fetch"]) {
  const counts = { search: 0, fetch: 0 };
  const tools: InvestigatorTools = {
    search: async () => {
      counts.search += 1;
      return [];
    },
    fetch: async (url) => {
      counts.fetch += 1;
      if (fetchImpl) return fetchImpl(url);
      throw new Error("fetch should not run");
    },
  };
  return { tools, counts };
}

function deps(overrides: Partial<RunTurnDeps> = {}): RunTurnDeps {
  return {
    llm: overrides.llm ?? createFakeLlm({}),
    searchProviders: overrides.searchProviders ?? [],
    tools: overrides.tools ?? countingTools().tools,
    now: overrides.now ?? (() => AT),
    ...(overrides.clock ? { clock: overrides.clock } : {}),
  };
}

async function collect(iter: AsyncIterable<CaseEvent>): Promise<CaseEvent[]> {
  const out: CaseEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function assertReplay(prelude: CaseEvent[], turnEvents: CaseEvent[], start: Case): void {
  const snapshot = turnEvents.reduce(reduce, start);
  expect(replay([...prelude, ...turnEvents])).toEqual(snapshot);
  assertInvariants(snapshot);
}

function userRoute(events: CaseEvent[]): string | undefined {
  const msg = events.find((event) => event.type === "message.added");
  return msg?.type === "message.added" ? msg.message.route : undefined;
}

function assistantText(events: CaseEvent[]): string {
  const msg = events.filter((event) => event.type === "message.added").at(-1);
  return msg?.type === "message.added" && msg.message.role === "assistant" ? msg.message.text : "";
}

describe("turns", () => {
  it("pursue_frontier 消费 pivot，第一步不经 investigate 工单", async () => {
    const { case: raw, events: created } = createCase({ id: "case-pursue", text: TEXT, at: AT });
    const prep = createStageContext({ case: raw, llm: createFakeLlm({}), now: () => AT });
    prep.emit({
      type: "claims.added",
      claims: [{ id: "c1", text: TEXT, type: "fact", checkable: true, order: 0 }],
    });
    prep.emit({
      type: "verdict.updated",
      verdict: { claimId: "c1", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
    });
    prep.emit({
      type: "frontier.added",
      pivots: [
        {
          id: "p-gov",
          kind: "link",
          value: GOV_URL,
          why: "官方页",
          expectedValue: 3,
          depth: 1,
        },
      ],
    });
    const fake = createFakeLlm({
      investigate: { action: { kind: "stop" as const, target: "", why: "不应先问" } },
      cites: { primaryLinks: [], citesEvidenceIds: [] },
      assess: assessRefute("e1"),
      compose: composeScript(),
    });
    const events = await collect(
      runTurn({
        case: prep.current,
        message: { text: "查这条", pivotId: "p-gov" },
        route: "pursue_frontier",
        deps: deps({
          llm: fake,
          tools: {
            search: async () => [],
            fetch: async (url) => page({ finalUrl: url, text: GOV_TEXT, title: "人社部通知" }),
          },
        }),
      }),
    );
    expect(userRoute(events)).toBe("pursue_frontier");
    expect(events.some((event) => event.type === "frontier.consumed" && event.pivotId === "p-gov")).toBe(
      true,
    );
    const firstStep = events.find((event) => event.type === "investigator.step");
    expect(firstStep?.type === "investigator.step" && firstStep.action.target).toBe(GOV_URL);
    const firstStepAt = events.findIndex((event) => event.type === "investigator.step");
    expect(
      events
        .slice(0, firstStepAt)
        .some((event) => event.type === "llm.called" && event.job === "investigate"),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    expect(assistantText(events).length).toBeGreaterThan(0);
    assertReplay([...created, ...prep.emitted], events, prep.current);
  });

  it("pursue_frontier 非法 pivot 只发 error，不跑阶段", async () => {
    const { start, prelude } = seedCase({ id: "case-bad-pivot", evidence: true, frontier: true });
    const events = await collect(
      runTurn({
        case: start,
        message: { text: "查这条", pivotId: "no-such" },
        route: "pursue_frontier",
        deps: deps({ llm: createFakeLlm({}) }),
      }),
    );
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "message.added",
      "error",
      "turn.finished",
    ]);
    expect(events[3]).toMatchObject({ type: "turn.finished", reason: "error" });
    expect(events.some((event) => event.type === "stage.started")).toBe(false);
    assertReplay(prelude, events, start);
  });

  it("challenge 新证据 provenance=user，并进入 judge 与报告", async () => {
    const { start, prelude } = seedCase({ id: "case-challenge", verdict: true });
    const fake = createFakeLlm({
      assess: assessRefute("e1"),
      compose: composeScript(),
    });
    const events = await collect(
      runTurn({
        case: start,
        message: { text: `对照 ${GOV_URL}` },
        route: "challenge",
        deps: deps({
          llm: fake,
          tools: {
            search: async () => [],
            fetch: async () => page({ finalUrl: GOV_URL, text: GOV_TEXT, title: "人社部通知" }),
          },
        }),
      }),
    );
    const added = events.filter((event) => event.type === "evidence.added");
    expect(added).toHaveLength(1);
    expect(added[0]?.type === "evidence.added" && added[0].evidence.provenance).toEqual({ kind: "user" });
    const newId = added[0]?.type === "evidence.added" ? added[0].evidence.id : "";
    const addedAt = events.findIndex((event) => event.type === "evidence.added");
    const stanceAt = events.findIndex(
      (event) => event.type === "stance.added" && event.stance.evidenceId === newId,
    );
    const verdictAt = events.findIndex((event) => event.type === "verdict.updated");
    const reportAt = events.findIndex((event) => event.type === "report.finalized");
    expect(stanceAt).toBeGreaterThan(addedAt);
    expect(verdictAt).toBeGreaterThan(stanceAt);
    expect(reportAt).toBeGreaterThan(verdictAt);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    assertReplay(prelude, events, start);
  });

  it("challenge 抓不到：无 evidence.added，reason=done，无 error", async () => {
    const { start, prelude } = seedCase({ id: "case-unreach", verdict: true });
    const events = await collect(
      runTurn({
        case: start,
        message: { text: `对照 ${GOV_URL}` },
        route: "challenge",
        deps: deps({
          llm: createFakeLlm({}),
          tools: {
            search: async () => [],
            fetch: async () => page({ finalUrl: GOV_URL, text: "", reachable: false }),
          },
        }),
      }),
    );
    expect(events.some((event) => event.type === "evidence.added")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    expect(assistantText(events)).toBe(CHALLENGE_UNREACHABLE);
    assertReplay(prelude, events, start);
  });

  it("ask_case 正常：恰一条 ask_case 工单，零检索零阶段", async () => {
    const { start, prelude } = seedCase({
      id: "case-ask",
      evidence: true,
      frontier: true,
      report: true,
    });
    const counted = countingTools();
    const fake = createFakeLlm({
      ask_case: { answer: "材料说津贴由单位申领，标准 3200 元。" },
    });
    const events = await collect(
      runTurn({
        case: start,
        message: { text: "现在判得怎样" },
        route: "ask_case",
        deps: deps({ llm: fake, tools: counted.tools }),
      }),
    );
    const jobs = events.filter((event) => event.type === "llm.called").map((event) => event.job);
    expect(jobs).toEqual(["ask_case"]);
    expect(counted.counts.search).toBe(0);
    expect(counted.counts.fetch).toBe(0);
    expect(events.some((event) => event.type === "stage.started")).toBe(false);
    expect(assistantText(events)).toBe("材料说津贴由单位申领，标准 3200 元。");
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    assertReplay(prelude, events, start);
  });

  it("ask_case 案外 URL 被拦并换成兜底与 frontier 标签", async () => {
    const { start, prelude } = seedCase({
      id: "case-ask-url",
      evidence: true,
      frontier: true,
      report: true,
    });
    const fake = createFakeLlm({
      ask_case: { answer: `详见 ${EVIL_URL}，那边说已经发了。` },
    });
    const events = await collect(
      runTurn({
        case: start,
        message: { text: "有没有别的出处" },
        route: "ask_case",
        deps: deps({ llm: fake }),
      }),
    );
    const text = assistantText(events);
    expect(text).not.toContain(EVIL_URL);
    expect(text).toContain(ASK_CASE_FALLBACK);
    expect(text).toContain("人社部");
    assertReplay(prelude, events, start);
  });

  it("ask_case 案外数字被替换，案内数字原样保留", async () => {
    const { start, prelude } = seedCase({
      id: "case-ask-num",
      evidence: true,
      frontier: true,
      report: true,
    });
    const fakeBad = createFakeLlm({
      ask_case: { answer: "材料说有 987654321 人已领取。" },
    });
    const bad = await collect(
      runTurn({
        case: start,
        message: { text: "领了多少人" },
        route: "ask_case",
        deps: deps({ llm: fakeBad }),
      }),
    );
    expect(assistantText(bad)).not.toContain("987654321");
    expect(assistantText(bad)).toContain(ASK_CASE_FALLBACK);

    const { start: start2, prelude: prelude2 } = seedCase({
      id: "case-ask-num-ok",
      evidence: true,
      frontier: true,
      report: true,
    });
    const fakeOk = createFakeLlm({
      ask_case: { answer: "材料写了 3200 元。" },
    });
    const ok = await collect(
      runTurn({
        case: start2,
        message: { text: "标准是多少" },
        route: "ask_case",
        deps: deps({ llm: fakeOk }),
      }),
    );
    expect(assistantText(ok)).toBe("材料写了 3200 元。");
    assertReplay(prelude, bad, start);
    assertReplay(prelude2, ok, start2);
  });

  it("off_topic 固定文案，路由之后零工单零阶段", async () => {
    const { start, prelude } = seedCase({ id: "case-off", evidence: true });
    const fake = createFakeLlm({});
    const events = await collect(
      runTurn({
        case: start,
        message: { text: "今晚吃什么" },
        route: "off_topic",
        deps: deps({ llm: fake }),
      }),
    );
    expect(events.filter((event) => event.type === "llm.called")).toHaveLength(0);
    expect(events.some((event) => event.type === "stage.started")).toBe(false);
    expect(assistantText(events)).toBe(OFF_TOPIC_REPLY);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
    assertReplay(prelude, events, start);
  });
});
