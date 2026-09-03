import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import type { Claim } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import type { SearchHit, SearchProviderFn } from "../search/searchAll.js";
import { createStageContext, type StageContext } from "./context.js";
import { runRetrieve } from "./retrieve.js";

const AT = "2026-09-03T00:00:00.000Z";

function claim(partial: Omit<Claim, "checkable"> & { checkable?: boolean }): Claim {
  return { checkable: true, ...partial };
}

function setup(claims: Claim[]): { ctx: StageContext; fake: ReturnType<typeof createFakeLlm> } {
  const { case: c } = createCase({ id: "case1", text: "原句", at: AT });
  const fake = createFakeLlm({});
  const ctx = createStageContext({ case: c, llm: fake, now: () => AT });
  ctx.emit({ type: "claims.added", claims });
  return { ctx, fake };
}

function hits(rows: SearchHit[]): SearchProviderFn {
  return async function keep() {
    return rows;
  };
}

describe("runRetrieve", () => {
  it("负荷选择：causal 与含数字优先，超出 maxClaims 进 skipped", async () => {
    const { ctx } = setup([
      claim({ id: "c1", text: "天气很好", type: "fact", order: 0 }),
      claim({ id: "c2", text: "污染导致癌症", type: "causal", order: 1 }),
      claim({ id: "c3", text: "增长率 12%", type: "fact", order: 2 }),
      claim({ id: "c4", text: "有人发表了看法", type: "fact", order: 3 }),
      claim({ id: "c5", text: "因为下雨所以堵车", type: "causal", order: 4 }),
      claim({ id: "c6", text: "还发生了别的事", type: "fact", order: 5 }),
      claim({ id: "c7", text: "加班导致离职", type: "causal", order: 6 }),
      claim({ id: "c8", text: "这太离谱了", type: "value", checkable: false, order: 7 }),
    ]);

    const result = await runRetrieve(ctx, { providers: [hits([])], maxClaims: 3 });

    expect(result.searched).toEqual(["c2", "c3", "c5"]);
    expect(result.skipped).toEqual(["c7", "c1", "c4", "c6"]);
    const staged = ctx.emitted
      .filter((event) => event.type === "stage.started" || event.type === "stage.finished")
      .map((event) => ("claimId" in event ? event.claimId : undefined));
    expect(staged).toEqual(["c2", "c2", "c3", "c3", "c5", "c5"]);
    expect(ctx.emitted.some((event) => "claimId" in event && event.claimId === "c7")).toBe(false);
    expect(ctx.emitted.some((event) => "claimId" in event && event.claimId === "c8")).toBe(false);
  });

  it("每条证据 provenance.kind 为 search 且带 query", async () => {
    const { ctx, fake } = setup([claim({ id: "c1", text: "甘南所有景点一律免费", type: "fact", order: 0 })]);

    await runRetrieve(ctx, {
      providers: [hits([{ url: "https://news.cn/free", title: "通报", snippet: "官方口径" }])],
      queriesPerClaim: 1,
    });

    const added = ctx.emitted.filter((event) => event.type === "evidence.added");
    expect(added.length).toBeGreaterThan(0);
    for (const event of added) {
      expect(event.evidence.provenance.kind).toBe("search");
      expect(event.evidence.provenance.kind === "search" && event.evidence.provenance.query.length > 0).toBe(
        true,
      );
      expect(event.evidence.text).toBeUndefined();
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("跨命题同一 URL 只发一次 evidence.added", async () => {
    const shared = "https://example.com/same?utm_source=x";
    const { ctx } = setup([
      claim({ id: "c1", text: "甘南免票", type: "fact", order: 0 }),
      claim({ id: "c2", text: "景点免费开放", type: "fact", order: 1 }),
    ]);

    await runRetrieve(ctx, {
      providers: [hits([{ url: shared, snippet: "转载" }])],
      queriesPerClaim: 2,
    });

    const added = ctx.emitted.filter((event) => event.type === "evidence.added");
    expect(added).toHaveLength(1);
    expect(added[0]?.evidence.canonicalUrl).toBe("https://example.com/same");
    expect(ctx.current.evidence).toHaveLength(1);
  });

  it("一个 provider 抛错仍产出其余来源", async () => {
    async function boom(): Promise<SearchHit[]> {
      throw new Error("provider down");
    }
    async function keep(): Promise<SearchHit[]> {
      return [{ url: "https://news.cn/ok", title: "保留", snippet: "还在" }];
    }
    const { ctx } = setup([claim({ id: "c1", text: "官方通报了此事", type: "fact", order: 0 })]);

    await runRetrieve(ctx, { providers: [boom, keep], queriesPerClaim: 1 });

    expect(ctx.current.evidence.map((item) => item.url)).toEqual(["https://news.cn/ok"]);
    expect(ctx.current.evidence[0]?.tier).toBe("A");
  });

  it("空结果不抛错且有 stage.finished", async () => {
    const { ctx } = setup([claim({ id: "c1", text: "查无此事", type: "fact", order: 0 })]);

    const result = await runRetrieve(ctx, { providers: [hits([])], queriesPerClaim: 1 });

    expect(result.searched).toEqual(["c1"]);
    expect(result.skipped).toEqual([]);
    expect(ctx.emitted.filter((event) => event.type === "evidence.added")).toHaveLength(0);
    const finished = ctx.emitted.filter((event) => event.type === "stage.finished");
    expect(finished).toEqual([
      expect.objectContaining({ type: "stage.finished", stage: "retrieve", claimId: "c1", outcome: "ok" }),
    ]);
  });

  it("同 host 两条证据得到同一 clusterId", async () => {
    const { ctx } = setup([claim({ id: "c1", text: "微博上传了两篇", type: "fact", order: 0 })]);

    await runRetrieve(ctx, {
      providers: [
        hits([
          { url: "https://weibo.com/p/1", snippet: "短文甲" },
          { url: "https://weibo.com/p/2", snippet: "短文乙" },
        ]),
      ],
      queriesPerClaim: 1,
    });

    expect(ctx.current.evidence).toHaveLength(2);
    const [a, b] = ctx.current.evidence;
    expect(a?.host).toBe(b?.host);
    expect(a?.clusterId).toBeDefined();
    expect(a?.clusterId).toBe(b?.clusterId);
    const updates = ctx.emitted.filter((event) => event.type === "evidence.updated");
    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((event) => event.clusterId))).toEqual(new Set([a?.clusterId]));
  });
});
