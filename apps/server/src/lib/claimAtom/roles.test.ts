import { describe, expect, it } from "vitest";
import { collapseShortSingleClaim, dropUntraceableAtoms, ensureStanceAtom, markStanceAtoms } from "./roles";

const type = (text: string, extra: Record<string, unknown> = {}) => ({ text, verifiable: true, type: "fact", ...extra });

describe("短单句不拆（Decomposition Dilemmas：单句短主张拆题常有害）", () => {
  it("没有分句标点、也没有并列词的短句，被拆成几条也收回成原句一条主要主张", () => {
    const claim = "常穿黑色内衣易患癌";
    const result = collapseShortSingleClaim(claim, ["常穿黑色内衣", "内衣易患癌"], [type("常穿黑色内衣"), type("内衣易患癌", { type: "causal" })]);
    expect(result.atoms).toEqual([claim]);
    expect(result.types).toEqual([{ text: claim, verifiable: true, type: "fact", role: "main" }]);
  });

  it("有分句标点 / 并列词 / 超长的句子不动，并列主张仍要拆开", () => {
    const parallel = "维生素C能预防感冒，还能美白皮肤";
    const atoms = ["维生素C能预防感冒", "维生素C能美白皮肤"];
    expect(collapseShortSingleClaim(parallel, atoms, atoms.map((a) => type(a))).atoms).toEqual(atoms);
    const joined = "这药能降血压且能降血糖";
    expect(collapseShortSingleClaim(joined, ["这药能降血压", "这药能降血糖"], []).atoms).toHaveLength(2);
    const long = "某市卫健委在去年发布通知称全市所有社区医院从下月起不再开具任何抗生素处方药";
    expect(collapseShortSingleClaim(long, ["A", "B"], []).atoms).toEqual(["A", "B"]);
  });

  it("只有一条或没有原子时原样返回；原子全是立场句时收回后仍是立场句", () => {
    expect(collapseShortSingleClaim("常穿黑色内衣易患癌", ["常穿黑色内衣易患癌"], [type("常穿黑色内衣易患癌")]).atoms).toEqual(["常穿黑色内衣易患癌"]);
    const stance = collapseShortSingleClaim("小区不该养大型犬", ["小区不该养狗", "狗是大型犬"], [
      type("小区不该养狗", { verifiable: false, type: "value" }),
      type("狗是大型犬", { verifiable: false, type: "value" }),
    ]);
    expect(stance.types).toEqual([{ text: "小区不该养大型犬", verifiable: false, type: "value", role: "main" }]);
  });
});

describe("每一部分必须对得上原句的一截（span）", () => {
  const claim = "某药已获批准，而且能根治失眠";
  it("span 不是原句的一截 → 拆题编造，丢掉", () => {
    const result = dropUntraceableAtoms(
      claim,
      ["某药已获批准", "能根治失眠", "该药有明确剂量阈值"],
      [type("某药已获批准", { span: "某药已获批准" }), type("能根治失眠", { span: "能根治失眠" }), type("该药有明确剂量阈值", { span: "剂量阈值" })]
    );
    expect(result.atoms).toEqual(["某药已获批准", "能根治失眠"]);
    expect(result.dropped).toEqual(["该药有明确剂量阈值"]);
    expect(result.types).toHaveLength(2);
  });

  it("空白差异不算编造；没写 span 的不丢（旧输出、沿用上一轮的命题）", () => {
    const result = dropUntraceableAtoms(claim, ["A", "B"], [type("A", { span: "某药 已获批准" }), type("B")]);
    expect(result.atoms).toEqual(["A", "B"]);
  });

  it("全部都对不上时不清空：保留全部继续管线（同自证 fail-open）", () => {
    const result = dropUntraceableAtoms(claim, ["A", "B"], [type("A", { span: "无" }), type("B", { span: "也无" })]);
    expect(result.atoms).toEqual(["A", "B"]);
    expect(result.dropped).toEqual([]);
  });
});

describe("立场 / 价值判断不当事实查（NEW-301 形状）", () => {
  it("只含「不该 / 应该」这类价值词、没有事实动词的句子标为立场型", () => {
    const types = markStanceAtoms([
      type("小区里就不该允许养大型犬", { type: "fact" }),
      type("政府应该禁止短视频", { type: "normative" }),
    ]);
    expect(types).toEqual([
      { text: "小区里就不该允许养大型犬", verifiable: false, type: "normative" },
      { text: "政府应该禁止短视频", verifiable: false, type: "normative" },
    ]);
  });

  it("含事实动词或数字的不动：某地已经规定不该养、流传的因果句仍是可核查说法", () => {
    const facts = [
      type("某地已经规定小区不该养大型犬"),
      type("每天喝红酒会预防心脏病", { type: "causal" }),
      type("小区应该在2024年前完成改造"),
    ];
    expect(markStanceAtoms(facts)).toEqual(facts);
  });
});

describe("价值判断闸不误伤有外部标准的规范句与桥接命题", () => {
  it("「所以…应该…」是从前提推出的结论，仍是可核查的主张", () => {
    const leap = [type("所以所有人每顿饭后都应该注射胰岛素")];
    expect(markStanceAtoms(leap)).toEqual(leap);
  });

  it("法规 / 指南 / 标准 / 说明书 一类的「应当」仍是可核查", () => {
    const facts = [type("医生应该在术前告知风险，这是医疗机构管理条例的要求", { type: "normative" }), type("孕妇应该遵医嘱，说明书写明", { type: "normative" })];
    expect(markStanceAtoms(facts)).toEqual(facts);
  });
});


describe("整句是立场、拆题一条命题都没给（NEW-301 基准 v2 形状）", () => {
  const stanceOnly = { verifiable: false, type: "value", reason: "纯价值判断" };
  it("把原句本身作为一条立场型命题，不让整句落成「没有命题」", () => {
    const claim = "小区里就不该允许养大型犬";
    expect(ensureStanceAtom(claim, [], [], stanceOnly)).toEqual({
      atoms: [claim],
      types: [{ text: claim, verifiable: false, type: "value", role: "main" }],
    });
  });

  it("有命题时不动；整句可核查而模型没给命题时也不动（那走拆题失败的兜底）", () => {
    expect(ensureStanceAtom("A", ["A"], [type("A")], stanceOnly)).toEqual({ atoms: ["A"], types: [type("A")] });
    expect(ensureStanceAtom("A", [], [], { verifiable: true, type: "fact" })).toEqual({ atoms: [], types: [] });
    expect(ensureStanceAtom("A", [], [], undefined)).toEqual({ atoms: [], types: [] });
  });
});
