import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm, type FakeScript } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { runDecompose } from "./decompose.js";

const AT = "2026-09-03T00:00:00.000Z";
const NOW = "2026-09-03T00:00:01.000Z";
const FORBIDDEN = ["能信", "不能信", "可信", "不可信"] as const;

function setup(script: FakeScript, text = "原句") {
  const { case: c } = createCase({ id: "case1", text, at: AT });
  const fake = createFakeLlm(script);
  const ctx = createStageContext({ case: c, llm: fake, now: () => NOW });
  return { ctx, fake };
}

function keepAll(): FakeScript[string] {
  return { results: [] };
}

describe("runDecompose", () => {
  it("system prompt 不含判断措辞", async () => {
    const source = "药能治失眠";
    const { ctx, fake } = setup({
      decompose: { claims: [{ text: source, type: "fact", checkable: true }] },
      "self-proof": keepAll(),
    });
    await runDecompose(ctx, { claimSource: source });
    const prompt = fake.calls.find((call) => call.job === "decompose")?.systemPrompt ?? "";
    expect(prompt.length).toBeGreaterThan(0);
    for (const word of FORBIDDEN) {
      expect(prompt).not.toContain(word);
    }
    expect(prompt).toContain("前提");
    expect(prompt).toContain("侧面");
    expect(prompt).toContain("孩子打疫苗后发烧，说明疫苗导致了自闭症");
    expect(prompt).toContain("群里那张P图配的侮辱性文字说的是真的");
    expect(prompt).toContain("扫码可领补贴，逾期视为弃权");
    expect(prompt).toContain("电动车都被集中拉去国外销毁了，一批一批装船运走");
  });

  it("system prompt 含证据缺失限定语规则与反例", async () => {
    const source = "同事群里说我们公司下周一会被收购，没有公告也没有监管披露";
    const { ctx, fake } = setup({
      decompose: { claims: [{ text: "我们公司下周一会被收购", type: "fact", checkable: true }] },
      "self-proof": keepAll(),
    });
    await runDecompose(ctx, { claimSource: source });
    const prompt = fake.calls.find((call) => call.job === "decompose")?.systemPrompt ?? "";
    expect(prompt).toContain("限定语");
    expect(prompt).toContain("同事群里说我们公司下周一会被收购，没有公告也没有监管披露");
    expect(prompt).toContain("我们公司下周一会被收购");
  });

  it("复合句拆成不少于两条且顺序与原句一致", async () => {
    const source = "这种药能治失眠，这种药已获批准。";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "这种药能治失眠", type: "fact", checkable: true, span: { start: 0, end: 7 } },
          { text: "这种药已获批准", type: "fact", checkable: true, span: { start: 8, end: 15 } },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.map((c) => c.text)).toEqual(["这种药能治失眠", "这种药已获批准"]);
    expect(claims.map((c) => c.order)).toEqual([0, 1]);
    expect(claims.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(source.indexOf(claims[0]!.text)).toBeLessThan(source.indexOf(claims[1]!.text));
  });

  it("立场句 checkable=false", async () => {
    const source = "文科教育正在失去意义";
    const { ctx } = setup({
      decompose: { claims: [{ text: source, type: "value", checkable: false }] },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ text: source, type: "value", checkable: false });
  });

  it("自证丢掉原句没说的命题并发 claims.dropped", async () => {
    const source = "这种药能治失眠";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "这种药能治失眠", type: "fact", checkable: true },
          { text: "地球绕太阳转", type: "fact", checkable: true },
        ],
      },
      "self-proof": {
        results: [
          { atom: "这种药能治失眠", supported: true, reason: "原句有" },
          { atom: "地球绕太阳转", supported: false, reason: "原句没说" },
        ],
      },
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["这种药能治失眠"]);
    const dropped = ctx.emitted.filter((e) => e.type === "claims.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      type: "claims.dropped",
      dropped: [{ text: "地球绕太阳转", reason: "原句没说" }],
    });
  });

  it("导致与致癌类被 forceCheckable 拉回可核对", async () => {
    const source = "隔夜菜会致癌，隔夜菜导致失眠。";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "隔夜菜会致癌", type: "value", checkable: false },
          { text: "隔夜菜导致失眠", type: "value", checkable: false },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([
      expect.objectContaining({ text: "隔夜菜会致癌", checkable: true, type: "fact" }),
      expect.objectContaining({ text: "隔夜菜导致失眠", checkable: true, type: "causal" }),
    ]);
  });

  it("工单抛错则整句一条命题且 outcome 为 failed-open", async () => {
    const source = "药能治失眠，药已获批准。";
    const { ctx } = setup({ decompose: new Error("llm down") });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([
      { id: "c1", text: source, type: "fact", checkable: true, order: 0 },
    ]);
    const finished = ctx.emitted.filter((e) => e.type === "stage.finished");
    expect(finished.at(-1)).toMatchObject({ stage: "decompose", outcome: "failed-open" });
  });

  it("模型输出不符 schema 则失败开放", async () => {
    const source = "药能治失眠";
    const { ctx } = setup({ decompose: { notClaims: true } });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([{ id: "c1", text: source, type: "fact", checkable: true, order: 0 }]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "failed-open",
    });
  });

  it("自证把全部命题丢掉则失败开放", async () => {
    const source = "药能治失眠，药已获批准。";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "药能治失眠", type: "fact", checkable: true },
          { text: "药已获批准", type: "fact", checkable: true },
        ],
      },
      "self-proof": {
        results: [
          { atom: "药能治失眠", supported: false, reason: "不成立" },
          { atom: "药已获批准", supported: false, reason: "不成立" },
        ],
      },
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    const dropped = ctx.emitted.filter((e) => e.type === "claims.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      dropped: [
        { text: "药能治失眠", reason: "不成立" },
        { text: "药已获批准", reason: "不成立" },
      ],
    });
    expect(claims).toEqual([{ id: "c1", text: source, type: "fact", checkable: true, order: 0 }]);
    expect(ctx.emitted.filter((e) => e.type === "claims.added")).toHaveLength(1);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "failed-open",
    });
  });

  it("非法 span 被丢掉且命题保留", async () => {
    const source = "这种药能治失眠，这种药已获批准。";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "这种药能治失眠", type: "fact", checkable: true, span: { start: -1, end: 5 } },
          { text: "这种药已获批准", type: "fact", checkable: true, span: { start: 0, end: source.length + 1 } },
          { text: "这种药能治失眠且已获批准", type: "fact", checkable: true, span: { start: 5, end: 2 } },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toHaveLength(3);
    expect(claims.map((c) => c.text)).toEqual(["这种药能治失眠", "这种药已获批准", "这种药能治失眠且已获批准"]);
    for (const claim of claims) {
      expect(claim.span).toBeUndefined();
    }
  });

  it("碎片命题「国家医保局宣布」被丢弃，完整句保留", async () => {
    const source = "国家医保局宣布生育津贴直接发个人";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "国家医保局宣布", type: "fact", checkable: true },
          { text: "国家医保局宣布了某事", type: "fact", checkable: true },
          { text: "国家医保局宣布生育津贴直接发个人", type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["国家医保局宣布生育津贴直接发个人"]);
    const dropped = ctx.emitted.filter((e) => e.type === "claims.dropped");
    expect(dropped.some((e) => e.type === "claims.dropped" && e.dropped.some((d) => d.reason === "fragment"))).toBe(
      true,
    );
  });

  it("碎片命题「国家医保局宣布该事项」被丢弃", async () => {
    const source = "国家医保局宣布 2026 年起生育津贴直接发个人";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "国家医保局宣布该事项", type: "fact", checkable: true },
          { text: "国家医保局宣布：2026 年起生育津贴直接发个人", type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["国家医保局宣布：2026 年起生育津贴直接发个人"]);
    expect(
      ctx.emitted.some(
        (e) =>
          e.type === "claims.dropped" &&
          e.dropped.some((d) => d.text === "国家医保局宣布该事项" && d.reason === "fragment"),
      ),
    ).toBe(true);
  });

  it("全是碎片时 fail-open 一条 fact", async () => {
    const source = "国家医保局宣布";
    const { ctx } = setup({
      decompose: { claims: [{ text: "国家医保局宣布", type: "fact", checkable: true }] },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([{ id: "c1", text: source, type: "fact", checkable: true, order: 0 }]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "failed-open",
    });
    expect(
      ctx.emitted.some(
        (e) => e.type === "claims.dropped" && e.dropped.some((d) => d.reason === "fragment"),
      ),
    ).toBe(true);
  });

  it("剥掉句首传闻引语", async () => {
    const source = "听说电动车被集中装船运往国外销毁";
    const { ctx } = setup(
      {
        decompose: {
          claims: [{ text: "听说电动车被集中装船运往国外销毁", type: "fact", checkable: true }],
        },
        "self-proof": keepAll(),
      },
      source,
    );
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["电动车被集中装船运往国外销毁"]);
  });

  it("自证抛错则命题仍产出且有 error 事件", async () => {
    const source = "这种药能治失眠";
    const { ctx } = setup({
      decompose: { claims: [{ text: source, type: "fact", checkable: true }] },
      "self-proof": new Error("self-proof down"),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([{ id: "c1", text: source, type: "fact", checkable: true, order: 0 }]);
    expect(ctx.emitted.filter((e) => e.type === "error")).toEqual([
      expect.objectContaining({ type: "error", stage: "decompose", message: "self-proof down" }),
    ]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "ok",
    });
  });
});
