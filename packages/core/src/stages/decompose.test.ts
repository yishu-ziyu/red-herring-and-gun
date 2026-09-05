import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm, type FakeScript } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { claimGroundedInCompleteParts, runDecompose } from "./decompose.js";

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
    expect(prompt).toContain("只作上下文");
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

  it("system prompt 含可公开核查前提单独成条的例外", async () => {
    const { ctx, fake } = setup({
      decompose: { claims: [{ text: "该保健品能防癌", type: "causal", checkable: true }] },
      "self-proof": keepAll(),
    });
    await runDecompose(ctx, { claimSource: "某地推广某保健品后癌症死亡率下降，证明该保健品能防癌" });
    const prompt = fake.calls.find((call) => call.job === "decompose")?.systemPrompt ?? "";
    expect(prompt).toContain("可公开核查的事实主张");
    expect(prompt).toContain("某地推广该保健品后癌症死亡率下降");
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

  it("导致与致癌类由工单一次写对，不再靠补丁拉回", async () => {
    const source = "隔夜菜会致癌，隔夜菜导致失眠。";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "隔夜菜会致癌", type: "fact", checkable: true },
          { text: "隔夜菜导致失眠", type: "causal", checkable: true },
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

  it("位置标偏会被校准到床垫二字", async () => {
    const source = "中国体育代表团出征奥运会自带300多个空调和床垫";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "中国体育代表团自带床垫", type: "fact", checkable: true, span: { start: 0, end: 13 } },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toHaveLength(1);
    const span = claims[0]?.span;
    expect(span).toBeDefined();
    expect(source.slice(span!.start, span!.end)).toContain("床垫");
  });

  it("原句里找不到依据的位置会被拿掉，命题留下", async () => {
    const source = "中国体育代表团自带300多个空调";
    const { ctx } = setup({
      decompose: {
        claims: [{ text: "代表团经费很充足", type: "fact", checkable: true, span: { start: 0, end: 5 } }],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.span).toBeUndefined();
  });

  it("合并的空调和床垫被并列复核拆开", async () => {
    const source = "中国体育代表团出征奥运会自带300多个空调和床垫";
    const { ctx, fake } = setup({
      decompose: {
        claims: [{ text: "中国体育代表团自带300多个空调和床垫", type: "fact", checkable: true }],
      },
      "self-proof": keepAll(),
      "split-check": { split: ["中国体育代表团自带300多个空调", "中国体育代表团自带床垫"] },
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["中国体育代表团自带300多个空调", "中国体育代表团自带床垫"]);
    expect(fake.calls.some((c) => c.job === "split-check")).toBe(true);
  });

  it("并列复核拆出来的加戏会被删掉", async () => {
    const source = "中国体育代表团自带300多个空调";
    const { ctx } = setup({
      decompose: {
        claims: [{ text: "中国体育代表团自带300多个空调和床垫", type: "fact", checkable: true }],
      },
      "self-proof": keepAll(),
      "split-check": { split: ["中国体育代表团自带300多个空调", "代表团经费很充足"] },
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["中国体育代表团自带300多个空调"]);
    expect(ctx.emitted.filter((e) => e.type === "claims.dropped")).not.toHaveLength(0);
  });

  it("没有并列标记不花并列复核调用", async () => {
    const source = "这种药能治失眠";
    const { ctx, fake } = setup({
      decompose: { claims: [{ text: source, type: "fact", checkable: true }] },
      "self-proof": keepAll(),
    });
    await runDecompose(ctx, { claimSource: source });
    expect(fake.calls.some((c) => c.job === "split-check")).toBe(false);
  });

  it("RUMOR-008 并列不断成一条：空调和床垫各一条", async () => {
    const source = "中国体育代表团出征奥运会自带300多个空调和床垫";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "中国体育代表团自带300多个空调", type: "fact", checkable: true },
          { text: "中国体育代表团自带床垫", type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.map((c) => c.text).join("|")).toContain("空调");
    expect(claims.map((c) => c.text).join("|")).toContain("床垫");
  });

  it("工单抛错则整句一条命题且 outcome 为 failed-open", async () => {
    const source = "药能治失眠，药已获批准。";
    const { ctx } = setup({ decompose: new Error("llm down") });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([
      { id: "c1", text: source, type: "fact", checkable: true, order: 0, span: { start: 0, end: source.length } },
    ]);
    const finished = ctx.emitted.filter((e) => e.type === "stage.finished");
    expect(finished.at(-1)).toMatchObject({ stage: "decompose", outcome: "failed-open" });
  });

  it("模型输出不符 schema 则失败开放", async () => {
    const source = "药能治失眠";
    const { ctx } = setup({ decompose: { notClaims: true } });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims).toEqual([
      { id: "c1", text: source, type: "fact", checkable: true, order: 0, span: { start: 0, end: source.length } },
    ]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "failed-open",
    });
  });

  it("自证把全部命题丢掉则空结果，不整段放行", async () => {
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
    const { claims, origin } = await runDecompose(ctx, { claimSource: source });
    const dropped = ctx.emitted.filter((e) => e.type === "claims.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      dropped: [
        { text: "药能治失眠", reason: "不成立" },
        { text: "药已获批准", reason: "不成立" },
      ],
    });
    expect(origin).toBe("empty");
    expect(claims).toEqual([]);
    expect(ctx.emitted.filter((e) => e.type === "claims.added")).toHaveLength(0);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "ok",
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
    // 非法位置不再盲信：能对上的校准回正确区间，对不上才拿掉
    for (const claim of claims) {
      expect(claim.span).toBeDefined();
      expect(source.slice(claim.span!.start, claim.span!.end).length).toBeGreaterThan(0);
    }
    expect(source.slice(claims[0]!.span!.start, claims[0]!.span!.end)).toContain("治失眠");
    expect(source.slice(claims[1]!.span!.start, claims[1]!.span!.end)).toContain("已获批准");
  });

  it("「自带床垫」四个字是完整判断，不许当碎片扔", async () => {
    const source = "中国体育代表团自带300多个空调和床垫";
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "自带300多个空调", type: "fact", checkable: true },
          { text: "自带床垫", type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims } = await runDecompose(ctx, { claimSource: source });
    expect(claims.map((c) => c.text)).toEqual(["自带300多个空调", "自带床垫"]);
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

  it("全是碎片时空结果，不整段放行", async () => {
    const source = "国家医保局宣布";
    const { ctx } = setup({
      decompose: { claims: [{ text: "国家医保局宣布", type: "fact", checkable: true }] },
      "self-proof": keepAll(),
    });
    const { claims, origin } = await runDecompose(ctx, { claimSource: source });
    expect(origin).toBe("empty");
    expect(claims).toEqual([]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "ok",
    });
    expect(
      ctx.emitted.some(
        (e) => e.type === "claims.dropped" && e.dropped.some((d) => d.reason === "fragment"),
      ),
    ).toBe(true);
  });

  it("未补全条目不能成为可核命题，完整条目保留", async () => {
    const incomplete = "对象还没说清是哪件";
    const complete = "人社部发文说津贴打到个人卡";
    const source = `${incomplete}\n${complete}`;
    const { ctx, fake } = setup({
      decompose: {
        claims: [
          { text: incomplete, type: "fact", checkable: true },
          { text: complete, type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims, origin } = await runDecompose(ctx, {
      claimSource: source,
      parts: [incomplete, complete],
      completeParts: [2],
    });
    expect(origin).toBe("model");
    expect(claims.map((c) => c.text)).toEqual([complete]);
    expect(
      ctx.emitted.some(
        (e) =>
          e.type === "claims.dropped" &&
          e.dropped.some((d) => d.text === incomplete && d.reason === "unresolved-context"),
      ),
    ).toBe(true);
    const userContent = fake.calls.find((call) => call.job === "decompose")?.userContent ?? "";
    expect(userContent).toContain("【1】");
    expect(userContent).toContain("不得单独立案");
    expect(userContent).toContain("本轮立案材料");
  });

  it("忠实拆题不因冒号或转述格式差异被标成 unresolved-context", async () => {
    const complete = "某大学研究发现：隔夜面包会发霉";
    expect(claimGroundedInCompleteParts("隔夜面包会发霉", [complete], [1])).toBe(true);
    expect(claimGroundedInCompleteParts("某大学研究发现隔夜面包会发霉", [complete], [1])).toBe(true);
    const { ctx } = setup({
      decompose: {
        claims: [{ text: "某大学研究发现隔夜面包会发霉", type: "fact", checkable: true }],
      },
      "self-proof": keepAll(),
    });
    const { claims, origin } = await runDecompose(ctx, {
      claimSource: complete,
      parts: [complete],
      completeParts: [1],
    });
    expect(origin).toBe("model");
    expect(claims.map((c) => c.text)).toEqual(["某大学研究发现隔夜面包会发霉"]);
    expect(
      ctx.emitted.some(
        (e) => e.type === "claims.dropped" && e.dropped.some((d) => d.reason === "unresolved-context"),
      ),
    ).toBe(false);
  });

  it("首轮单条材料时不把跨句归属拆题标成 unresolved-context", async () => {
    const source = "某大学研究发现：面包不能吃，放两天会发霉";
    const later = "某大学研究发现面包放两天会发霉";
    expect(claimGroundedInCompleteParts(later, [source], [1])).toBe(false);
    const { ctx } = setup({
      decompose: {
        claims: [
          { text: "某大学研究发现面包不能吃", type: "fact", checkable: true },
          { text: later, type: "fact", checkable: true },
        ],
      },
      "self-proof": keepAll(),
    });
    const { claims, origin } = await runDecompose(ctx, {
      claimSource: source,
      parts: [source],
      completeParts: [1],
    });
    expect(origin).toBe("model");
    expect(claims.map((c) => c.text)).toEqual(["某大学研究发现面包不能吃", later]);
    expect(
      ctx.emitted.some(
        (e) => e.type === "claims.dropped" && e.dropped.some((d) => d.reason === "unresolved-context"),
      ),
    ).toBe(false);
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
    expect(claims).toEqual([
      { id: "c1", text: source, type: "fact", checkable: true, order: 0, span: { start: 0, end: source.length } },
    ]);
    expect(ctx.emitted.filter((e) => e.type === "error")).toEqual([
      expect.objectContaining({ type: "error", stage: "decompose", message: "self-proof down" }),
    ]);
    expect(ctx.emitted.filter((e) => e.type === "stage.finished").at(-1)).toMatchObject({
      stage: "decompose",
      outcome: "ok",
    });
  });
});
