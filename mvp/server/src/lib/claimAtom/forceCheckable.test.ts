import { describe, expect, it } from "vitest";
import { forceCheckableAtomTypes, looksLikeCirculatingClaim } from "./forceCheckable";
import { splitVerifiableAtoms } from "./merge";

describe("looksLikeCirculatingClaim", () => {
  it("隔夜菜会致癌 / 某地要建地铁 像流传说法", () => {
    expect(looksLikeCirculatingClaim("隔夜菜会致癌")).toBe(true);
    expect(looksLikeCirculatingClaim("某地要建地铁")).toBe(true);
  });

  it("规范句、价值句、纯骂、第一人称体验 不像", () => {
    expect(looksLikeCirculatingClaim("政府应该禁止隔夜菜")).toBe(false);
    expect(looksLikeCirculatingClaim("这种政策就是不管老百姓死活")).toBe(false);
    expect(looksLikeCirculatingClaim("文科教育正在失去意义")).toBe(false);
    expect(looksLikeCirculatingClaim("地铁政策没有意义")).toBe(false);
    expect(looksLikeCirculatingClaim("医院是社会的")).toBe(false);
    expect(looksLikeCirculatingClaim("这药对我失眠很有效")).toBe(false);
  });
});

describe("forceCheckableAtomTypes", () => {
  it("隔夜菜被标 value 仍改回可核查；规范句与纯骂不动", () => {
    const types = forceCheckableAtomTypes([
      { text: "隔夜菜会致癌", verifiable: false, type: "value" },
      { text: "某地要建地铁", verifiable: false, type: "value" },
      { text: "政府应该禁止隔夜菜", verifiable: false, type: "normative" },
      { text: "这种政策就是不管老百姓死活", verifiable: false, type: "value" },
    ]);
    expect(types).toEqual([
      { text: "隔夜菜会致癌", verifiable: true, type: "fact" },
      { text: "某地要建地铁", verifiable: true, type: "fact" },
      { text: "政府应该禁止隔夜菜", verifiable: false, type: "normative" },
      { text: "这种政策就是不管老百姓死活", verifiable: false, type: "value" },
    ]);
    const split = splitVerifiableAtoms(
      ["隔夜菜会致癌", "某地要建地铁", "政府应该禁止隔夜菜", "这种政策就是不管老百姓死活"],
      types
    );
    expect(split.verifiable).toEqual(["隔夜菜会致癌", "某地要建地铁"]);
    expect(split.nonVerifiable).toEqual([
      { text: "政府应该禁止隔夜菜", type: "normative" },
      { text: "这种政策就是不管老百姓死活", type: "value" },
    ]);
  });

  it("含「导致」改回 causal；已可核查条目不改", () => {
    const types = forceCheckableAtomTypes([
      { text: "隔夜菜导致癌症", verifiable: false, type: "value" },
      { text: "上海车展上演全武行", verifiable: true, type: "fact" },
    ]);
    expect(types).toEqual([
      { text: "隔夜菜导致癌症", verifiable: true, type: "causal" },
      { text: "上海车展上演全武行", verifiable: true, type: "fact" },
    ]);
  });

  it("非数组原样返回，不抛错", () => {
    expect(forceCheckableAtomTypes(undefined)).toBeUndefined();
    expect(forceCheckableAtomTypes(null)).toBeNull();
  });
});
