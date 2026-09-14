import { describe, expect, it } from "vitest";
import { leftoverGapSentence, leftoverClaimTexts, isCompleteEmptyShell, uncoveredOriginalClauses, leftoverTextsForCanvas } from "./leftoverClaims";
import type { InvestigationClaim } from "../lib/investigation";

function claim(partial: Partial<InvestigationClaim> & { id: string; text: string }): InvestigationClaim {
  return {
    order: 0,
    checkability: "checkable",
    progress: "complete",
    judgment: "unresolved",
    evidence: [],
    gaps: [],
    ...partial,
  };
}

describe("leftoverClaims", () => {
  it("有材料的卡、查过但证据不足的卡都不是空壳", () => {
    expect(
      isCompleteEmptyShell(
        claim({
          id: "c1",
          text: "太空可见",
          evidence: [{ sourceId: "s1", role: "contradict" }],
        })
      )
    ).toBe(false);
    expect(
      isCompleteEmptyShell(
        claim({
          id: "c2",
          text: "异味来自新增消毒工艺",
          judgment: "unresolved",
          gaps: [{ id: "g1", claimId: "c2", description: "该原子定向检索无结果，待补证", status: "open" }],
        })
      )
    ).toBe(false);
  });

  it("检索预算未覆盖 / 模型未覆盖才是空尾巴", () => {
    expect(
      isCompleteEmptyShell(
        claim({
          id: "c3",
          text: "蜿蜒于群山",
          judgment: "unresolved",
          gaps: [{ id: "g1", claimId: "c3", description: "检索预算未覆盖", status: "open" }],
        })
      )
    ).toBe(true);
    expect(isCompleteEmptyShell(claim({ id: "c4", text: "背景铺垫", judgment: null, boundary: "模型未覆盖，待补证" }))).toBe(true);
    expect(isCompleteEmptyShell(claim({ id: "c5", text: "没判也没材料", judgment: null }))).toBe(true);
  });

  it("尚缺句不含检索预算/模型未覆盖，并点名没查的主张", () => {
    const claims = [
      claim({
        id: "c1",
        text: "长城是古代军事防御工程",
        evidence: [{ sourceId: "s1", role: "support" }],
      }),
      claim({ id: "c2", text: "蜿蜒于中国北方的群山之间", gaps: [{ id: "g1", claimId: "c2", description: "检索预算未覆盖", status: "open" }] }),
      claim({ id: "c3", text: "模型未覆盖，待补证", boundary: "模型未覆盖，待补证" }),
    ];
    const texts = leftoverClaimTexts(claims);
    expect(texts).toEqual(["蜿蜒于中国北方的群山之间", "模型未覆盖，待补证"]);
    const sentence = leftoverGapSentence(texts);
    expect(sentence).toContain("蜿蜒于中国北方的群山之间");
    expect(sentence).toContain("结论没有拿它们当依据");
    expect(sentence).not.toMatch(/检索预算未覆盖/);
  });

  it("盐说法：原句里 10 克、新英格兰试验没进命题，就算没盖住", () => {
    const original =
      "中国人人均每天吃盐约10克，高钠是高血压最主要的危险因素。新英格兰医学杂志的试验表明换低钠盐能减少中风。高血压全是吃盐造成的，换成低钠盐就能预防中风，对肾功能完全适用，每天不超过5克。";
    const claims = ["高血压全是吃盐造成的", "换成低钠盐就能预防中风", "对肾功能完全适用", "每天不超过5克"];
    const leftover = uncoveredOriginalClauses(original, claims);
    const joined = leftover.join("、");
    expect(joined).toContain("10克");
    expect(joined).toMatch(/新英格兰|试验/);
    expect(leftover.some((text) => text.includes("全是吃盐"))).toBe(false);
    expect(leftover.some((text) => text.includes("5克"))).toBe(false);
  });

  it("盐说法：没盖住的试验句整句留下，不按逗号切成半截", () => {
    const original =
      "国家卫健委建议成人每天盐不超过 5 克，中国人平均能吃到 10 克。高钠是高血压最主要的危险因素。2021 年《新英格兰医学杂志》在中国农村做过大规模试验，用含钾的低钠盐替换普通盐，中风和死亡都明显下降。所以高血压全是吃盐造成的，全家换成低钠盐就能预防中风，肾功能不好的老人也完全适用。";
    const claims = [
      "高血压全是吃盐造成的",
      "全家换成低钠盐就能预防中风",
      "肾功能不好的老人也完全适用",
      "国家卫健委建议成人每天盐摄入量不超过 5 克",
    ];
    const leftover = uncoveredOriginalClauses(original, claims);
    expect(leftover.some((text) => text.includes("10 克") || text.includes("10克"))).toBe(true);
    expect(leftover.some((text) => text.includes("最主要的危险因素"))).toBe(true);
    expect(leftover.some((text) => text.includes("新英格兰医学杂志") && text.includes("中风和死亡"))).toBe(true);
    expect(leftover).not.toContain("用含钾的低钠盐替换普通盐");
    expect(leftover).not.toContain("中风和死亡都明显下降");
    expect(leftover.some((text) => text.includes("全是吃盐"))).toBe(false);
    const sentence = leftoverGapSentence(leftover);
    expect(sentence).toContain("新英格兰医学杂志");
    expect(sentence).not.toMatch(/「用含钾的低钠盐替换普通盐」/);
  });

  it("画布尚缺句同时收空壳和原句没盖住的分句", () => {
    const original = "高血压全是吃盐造成的。人均每天约10克。";
    const claims = [
      claim({
        id: "c1",
        text: "高血压全是吃盐造成的",
        evidence: [{ sourceId: "s1", role: "contradict" }],
        judgment: "refuted",
      }),
      claim({
        id: "c2",
        text: "蜿蜒于群山",
        gaps: [{ id: "g1", claimId: "c2", description: "检索预算未覆盖", status: "open" }],
      }),
    ];
    const texts = leftoverTextsForCanvas(original, claims);
    expect(texts.join("、")).toContain("10克");
    expect(texts).toContain("蜿蜒于群山");
    expect(leftoverGapSentence(texts)).toContain("结论没有拿它们当依据");
  });
});
