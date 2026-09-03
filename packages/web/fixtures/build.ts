import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCase,
  createFakeLlm,
  replay,
  runTurn,
  type CaseEvent,
  type Evidence,
  type FetchedPage,
  type RunTurnDeps,
  type SearchProviderFn,
} from "@rhg/core";

const AT = "2026-09-03T12:00:00.000Z";
const CLOCK = 4_000_000_000_000;
const TEXT = "人社部发文说生育津贴直接打到个人卡里了";
const GOV_URL = "https://www.gov.cn/zhengce/allowance";
const NEWS_URL = "https://www.news.cn/fortune/allowance";
const WEIBO_URL = "https://weibo.com/ttarticle/p/show?id=allowance";
const BLOG_URL = "https://example.com/allowance-repost";
const GOV_SNIP = "官方通报此事不实，津贴由单位申领。";
const NEWS_SNIP = "生育津贴将直接发放至个人账户。";
const WEIBO_SNIP = "网友称津贴已经打到卡里。";
const BLOG_SNIP = "转载：有人说已经发到个人。";
const GOV_TEXT = "人社部从未发文称生育津贴直接打到个人卡。通知明确：津贴拨付至用人单位，标准 3200 元。";

const HERE = dirname(fileURLToPath(import.meta.url));

type FixtureFile = { name: string; cutAt: number; events: CaseEvent[] };

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

function hit(url: string, title: string, snippet: string) {
  return { url, title, snippet };
}

function provider(hits: { url: string; title: string; snippet: string }[]): SearchProviderFn {
  return async function fixtureSearch() {
    return hits;
  };
}

function govEvidence(query: string): Evidence {
  return {
    id: "tmp",
    url: GOV_URL,
    canonicalUrl: "https://gov.cn/zhengce/allowance",
    host: "gov.cn",
    title: "通报",
    excerpt: GOV_SNIP,
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "search", query },
  };
}

function composeFor(claimId: string) {
  return {
    conclusion: "生育津贴不会直接打到个人卡里，仍由单位申领。",
    claimItems: [{ claimId, line: "生育津贴直接打到个人卡：与现有依据相反。[1]" }],
  };
}

async function collect(iter: AsyncIterable<CaseEvent>): Promise<CaseEvent[]> {
  const out: CaseEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function cutAfter(events: CaseEvent[], test: (event: CaseEvent) => boolean): number {
  const index = events.findIndex(test);
  if (index === -1) throw new Error("cut point not found");
  return index + 1;
}

function write(fixture: FixtureFile): void {
  const path = join(HERE, `${fixture.name}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path} events=${fixture.events.length} cutAt=${fixture.cutAt}`);
}

function baseDeps(overrides: Partial<RunTurnDeps> = {}): RunTurnDeps {
  return {
    llm: overrides.llm ?? createFakeLlm({}),
    searchProviders: overrides.searchProviders ?? [provider([hit(GOV_URL, "通报", GOV_SNIP)])],
    tools: overrides.tools ?? {
      search: async () => [],
      fetch: async () => {
        throw new Error("fetch should not run");
      },
    },
    providers: overrides.providers ?? [
      { provider: "deepseek", model: "fake-a" },
      { provider: "stepfun", model: "fake-b" },
    ],
    now: () => AT,
    clock: () => CLOCK,
  };
}

function pipelineScript(assess: unknown) {
  return {
    decompose: { claims: [{ text: TEXT, type: "fact" as const, checkable: true }] },
    "self-proof": { results: [] },
    assess,
    compose: composeFor("c1"),
    investigate: { action: { kind: "stop" as const, target: "", why: "没有缺口" } },
    cites: { primaryLinks: [], citesEvidenceIds: [] },
  };
}

async function buildDoneLike(id: string): Promise<CaseEvent[]> {
  const { case: c, events: created } = createCase({ id, text: TEXT, at: AT });
  const llm = createFakeLlm({
    ...pipelineScript({
      stances: [{ evidenceId: "e1", stance: "refutes" as const, quote: "官方通报此事不实", confidence: 0.9 }],
    }),
    assess: [
      { stances: [{ evidenceId: "e1", stance: "contextual" as const, quote: "官方通报此事不实", confidence: 0.3 }] },
      {
        stances: [
          {
            evidenceId: "e4",
            stance: "refutes" as const,
            quote: "记者调查：多地仍由单位申领，暂未直发个人。",
            confidence: 0.9,
          },
        ],
      },
    ],
    investigate: [
      { action: { kind: "search" as const, target: "not-a-candidate", why: "补独立来源" } },
      { action: { kind: "stop" as const, target: "", why: "够了" } },
    ],
  });
  const turn = await collect(
    runTurn({
      case: c,
      message: { text: TEXT },
      route: "new_claim",
      deps: baseDeps({
        llm,
        searchProviders: [
          provider([
            hit(GOV_URL, "通报", GOV_SNIP),
            hit(WEIBO_URL, "转发", WEIBO_SNIP),
            hit(BLOG_URL, "转载", BLOG_SNIP),
          ]),
        ],
        tools: {
          search: async () => [
            {
              id: "tmp",
              url: NEWS_URL,
              canonicalUrl: "https://news.cn/fortune/allowance",
              host: "news.cn",
              title: "报道",
              excerpt: "记者调查：多地仍由单位申领，暂未直发个人。",
              retrievedAt: AT,
              tier: "A" as const,
              provenance: { kind: "search" as const, query: "" },
            },
          ],
          fetch: async () => {
            throw new Error("fetch should not run");
          },
        },
      }),
    }),
  );
  return [...created, ...turn];
}

async function buildContested(): Promise<CaseEvent[]> {
  const { case: c, events: created } = createCase({ id: "fx-contested", text: TEXT, at: AT });
  const llm = createFakeLlm({
    decompose: { claims: [{ text: TEXT, type: "fact" as const, checkable: true }] },
    "self-proof": { results: [] },
    assess: {
      stances: [
        { evidenceId: "e1", stance: "refutes" as const, quote: "官方通报此事不实", confidence: 0.9 },
        { evidenceId: "e2", stance: "supports" as const, quote: "生育津贴将直接发放至个人账户", confidence: 0.9 },
      ],
    },
    compose: composeFor("c1"),
    investigate: [
      { action: { kind: "stop" as const, target: "", why: "主查停" } },
      { action: { kind: "search" as const, target: "not-a-candidate", why: "控方" } },
      { action: { kind: "stop" as const, target: "", why: "控方停" } },
      { action: { kind: "search" as const, target: "not-a-candidate", why: "辩方" } },
      { action: { kind: "stop" as const, target: "", why: "辩方停" } },
    ],
    cites: { primaryLinks: [], citesEvidenceIds: [] },
  });
  const turn = await collect(
    runTurn({
      case: c,
      message: { text: TEXT },
      route: "new_claim",
      deps: baseDeps({
        llm,
        searchProviders: [provider([hit(GOV_URL, "通报", GOV_SNIP), hit(NEWS_URL, "报道", NEWS_SNIP)])],
        tools: {
          search: async () => [],
          fetch: async () => {
            throw new Error("fetch should not run");
          },
        },
      }),
    }),
  );
  return [...created, ...turn];
}

async function buildFollowup(): Promise<CaseEvent[]> {
  const { case: c, events: created } = createCase({ id: "fx-followup", text: TEXT, at: AT });
  const llm = createFakeLlm({
    decompose: { claims: [{ text: TEXT, type: "fact" as const, checkable: true }] },
    "self-proof": { results: [] },
    assess: [
      {
        stances: [
          { evidenceId: "e1", stance: "contextual" as const, quote: "网友称津贴已经打到卡里", confidence: 0.8 },
        ],
      },
      {
        stances: [
          { evidenceId: "e2", stance: "refutes" as const, quote: "官方通报此事不实", confidence: 0.9 },
        ],
      },
      {
        stances: [
          {
            evidenceId: "e2",
            stance: "refutes" as const,
            quote: "人社部从未发文称生育津贴直接打到个人卡",
            confidence: 0.9,
          },
        ],
      },
    ],
    compose: composeFor("c1"),
    investigate: [
      { action: { kind: "search" as const, target: "not-a-candidate", why: "补官方口径" } },
      { action: { kind: "stop" as const, target: "", why: "先停" } },
      { action: { kind: "stop" as const, target: "", why: "追索后停" } },
    ],
    cites: { primaryLinks: [], citesEvidenceIds: [] },
  });
  const tools = {
    search: async (query: string) => [govEvidence(query)],
    fetch: async (url: string) => page({ finalUrl: url, text: GOV_TEXT, title: "人社部通知" }),
  };
  const first = await collect(
    runTurn({
      case: c,
      message: { text: TEXT },
      route: "new_claim",
      deps: baseDeps({
        llm,
        searchProviders: [provider([hit(WEIBO_URL, "转发", WEIBO_SNIP)])],
        tools,
      }),
    }),
  );
  const afterFirst = replay([...created, ...first]);
  const pivot = afterFirst.frontier[0];
  if (!pivot) throw new Error("followup first turn left no frontier pivot");
  const second = await collect(
    runTurn({
      case: afterFirst,
      message: { text: "顺着这条出处再查", pivotId: pivot.id },
      route: "pursue_frontier",
      deps: baseDeps({ llm, tools }),
    }),
  );
  return [...created, ...first, ...second];
}

async function main(): Promise<void> {
  const done = await buildDoneLike("fx-done");
  const decomposing = await buildDoneLike("fx-decomposing");
  const retrieving = await buildDoneLike("fx-retrieving");
  const contested = await buildContested();
  const followup = await buildFollowup();

  write({
    name: "decomposing",
    cutAt: cutAfter(decomposing, (event) => event.type === "claims.added"),
    events: decomposing,
  });
  write({
    name: "retrieving",
    cutAt: cutAfter(retrieving, (event) => event.type === "evidence.added"),
    events: retrieving,
  });
  write({
    name: "contested",
    cutAt: cutAfter(
      contested,
      (event) => event.type === "verdict.updated" && event.verdict.verdict === "contested",
    ),
    events: contested,
  });
  write({ name: "done", cutAt: done.length, events: done });
  write({ name: "followup", cutAt: followup.length, events: followup });
}

await main();
