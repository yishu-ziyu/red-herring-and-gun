import { describe, expect, it } from "vitest";
import { constrainComposeDraft, safeClaimLine, safeConclusion } from "./safeVerdictLine.js";
import type { CitationTable } from "./compose.js";

function table(nsByClaim: Record<string, number[]>, citations: Array<{ n: number; evidenceId: string }>): CitationTable {
  return {
    citations,
    nsByClaim: new Map(Object.entries(nsByClaim)),
  };
}

describe("safeClaimLine / safeConclusion", () => {
  it("平台条件扩写不得进入判词行：只保留原命题 + false + 合法引用", () => {
    const line = safeClaimLine({
      claimText: "点早安晚安图片个人信息会被盗",
      checkable: true,
      verdict: "false",
      citationNs: [7, 8, 9],
    });
    expect(line).toBe("点早安晚安图片个人信息会被盗：与现有依据相反。[7][8][9]");
    expect(line).not.toContain("图片和视频本身");
    expect(line).not.toContain("恶意代码");
  });

  it("时间/地区扩写不得进入判词行", () => {
    const line = safeClaimLine({
      claimText: "京沪高速公路停止收费了",
      checkable: true,
      verdict: "false",
      citationNs: [1],
    });
    expect(line).toBe("京沪高速公路停止收费了：与现有依据相反。[1]");
    expect(line).not.toContain("全国");
    expect(line).not.toContain("所有高速公路");
  });

  it("未发现不得写成不可能", () => {
    const line = safeClaimLine({
      claimText: "某地推广某保健品后癌症死亡率下降",
      checkable: true,
      verdict: "unverified",
      citationNs: [1],
    });
    expect(line).toBe("某地推广某保健品后癌症死亡率下降：没有找到足够依据。");
    expect(line).not.toContain("不可能");
    expect(line).not.toMatch(/\[\d+\]/);
  });

  it("结论用原句加 overall 判词，不用「这条说法」章印", () => {
    const conclusion = safeConclusion({
      sourceText: "点早安晚安图片手机会中毒，个人信息会被盗",
      verdictType: "false",
      contested: false,
      citationNs: [1],
    });
    expect(conclusion).toBe("点早安晚安图片手机会中毒，个人信息会被盗：与现有依据相反。[1]");
    expect(conclusion).not.toContain("这条说法");
  });
});

describe("constrainComposeDraft", () => {
  it("丢掉模型自由解释，按结构字段重写结论与每行", () => {
    const draft = constrainComposeDraft({
      sourceText: "点早安晚安图片手机会中毒，个人信息会被盗",
      claims: [
        { id: "c1", text: "点早安晚安图片手机会中毒", type: "causal", checkable: true, order: 0 },
        { id: "c2", text: "点早安晚安图片个人信息会被盗", type: "causal", checkable: true, order: 1 },
      ],
      verdicts: [
        { claimId: "c1", verdict: "false", basis: ["s1"], rule: "false", updatedAt: "t" },
        { claimId: "c2", verdict: "false", basis: ["s2"], rule: "false", updatedAt: "t" },
      ],
      overall: { verdictType: "false", contested: false, score: 0, breakdown: [] },
      table: table({ c1: [1, 2], c2: [7] }, [
        { n: 1, evidenceId: "e1" },
        { n: 2, evidenceId: "e2" },
        { n: 7, evidenceId: "e7" },
      ]),
    });
    expect(draft.conclusion).toBe("点早安晚安图片手机会中毒，个人信息会被盗：与现有依据相反。[1][2][7]");
    expect(draft.claimItems).toEqual([
      { claimId: "c1", line: "点早安晚安图片手机会中毒：与现有依据相反。[1][2]" },
      { claimId: "c2", line: "点早安晚安图片个人信息会被盗：与现有依据相反。[7]" },
    ]);
  });
});
