import { describe, expect, it } from "vitest";

import { buildInvestigationSnapshot } from "./index.js";

/**
 * E1 / E2：结论分层（verdictLead + rationale）的确定性切分行为。
 * 只走 buildInvestigationSnapshot，不碰前端、不调模型。
 */
const keyFn = (s: string) => s.replace(/\u3000/g, " ").trim();

function completeWith(originalClaim: string, conclusion: string) {
  return buildInvestigationSnapshot(
    {
      originalClaim,
      phase: "complete",
      claimAtoms: [],
      report: { conclusion, verdictType: "unverified" },
    },
    { claimAtomKeyFn: keyFn }
  );
}

describe("E1 结论两层切分", () => {
  it("① 首句即判断 → verdictLead = 首句、rationale = 其余", () => {
    const snapshot = completeWith(
      "空气中氧气约占体积的两成。",
      "会。公开标准大气成分表显示氧气约占 20.9%。"
    );
    expect(snapshot.conclusion?.verdictLead).toBe("会。");
    expect(snapshot.conclusion?.rationale).toBe("公开标准大气成分表显示氧气约占 20.9%。");
    // directAnswer 语义不动：仍是完整 conclusion 的截断
    expect(snapshot.conclusion?.directAnswer).toBe(
      "会。公开标准大气成分表显示氧气约占 20.9%。"
    );
  });

  it("② 首句是原句复述 → verdictLead 取第二句、复述句不出现任何一层", () => {
    const originalClaim = "世界卫生组织已经宣布喝隔夜水会致癌。";
    const snapshot = completeWith(
      originalClaim,
      "世界卫生组织已经宣布喝隔夜水会致癌。这只是谣言。世卫组织从未发布过这一结论。"
    );
    expect(snapshot.conclusion?.verdictLead).toBe("这只是谣言。");
    expect(snapshot.conclusion?.rationale).toBe("世卫组织从未发布过这一结论。");
    const lead = snapshot.conclusion?.verdictLead ?? "";
    const rationale = snapshot.conclusion?.rationale ?? "";
    expect(lead).not.toContain("喝隔夜水会致癌");
    expect(rationale).not.toContain("喝隔夜水会致癌");
  });

  it("③ 单句结论 → verdictLead = 该句、rationale 缺省", () => {
    const snapshot = completeWith("空气中氧气约占体积的两成。", "会。");
    expect(snapshot.conclusion?.verdictLead).toBe("会。");
    expect(snapshot.conclusion?.rationale).toBeUndefined();
    expect("rationale" in (snapshot.conclusion ?? {})).toBe(false);
  });
});

describe("E2 两层不重叠、不丢判断", () => {
  it("verdictLead 只含一句（句内无终止标点），rationale 不包含 verdictLead 文本", () => {
    const snapshot = completeWith(
      "空气中氧气约占体积的两成。",
      "会。公开标准大气成分表显示氧气约占 20.9%。近地大气取样也复核了这一比例。"
    );
    const lead = snapshot.conclusion?.verdictLead ?? "";
    const rationale = snapshot.conclusion?.rationale ?? "";
    expect(lead.length).toBeGreaterThan(0);
    // 只含一句：去掉句末标点后句内不再有 。！？
    expect(lead.replace(/[。！？]+$/, "")).not.toMatch(/[。！？]/);
    expect(rationale).not.toContain(lead);
    expect(rationale).toBe("公开标准大气成分表显示氧气约占 20.9%。近地大气取样也复核了这一比例。");
  });

  it("复述句被丢弃后仍保留判断句（不丢判断）", () => {
    const originalClaim = "喝隔夜水会致癌。";
    const snapshot = completeWith(
      originalClaim,
      "喝隔夜水会致癌。原句站不住。没有证据支持这一说法。"
    );
    // "原句站不住。" 以「原句」开头，但它不复述原句 → 不能被误丢
    expect(snapshot.conclusion?.verdictLead).toBe("原句站不住。");
    expect(snapshot.conclusion?.rationale).toBe("没有证据支持这一说法。");
  });
});

describe("E9 复述判定不误伤「原句 + 新增信息」", () => {
  it("原句 + 新增信息必须保留为 verdictLead", () => {
    const snapshot = completeWith(
      "隔夜水中含有亚硝酸盐。",
      "隔夜水中含有亚硝酸盐，但没超标。检测显示每升仅 0.2 毫克。"
    );
    expect(snapshot.conclusion?.verdictLead).toBe("隔夜水中含有亚硝酸盐，但没超标。");
    expect(snapshot.conclusion?.rationale).toBe("检测显示每升仅 0.2 毫克。");
  });

  it("带引导词但内容是判断句的四个变体必须保留", () => {
    const sentences = ["原句站不住。", "原句与公开标准不符。", "该说法没有依据。", "这句话夸大其词。"];
    for (const sentence of sentences) {
      const snapshot = completeWith(
        "隔夜水中含有亚硝酸盐。",
        `${sentence}公开检测未支持这一说法。`
      );
      expect(snapshot.conclusion?.verdictLead).toBe(sentence);
      expect(snapshot.conclusion?.rationale).toBe("公开检测未支持这一说法。");
    }
  });
});

describe("E10 带引导词 / 连接词的真复述必须丢（剥离后须与原句完全相同）", () => {
  it("引导词与连接词长短不一时都判为复述", () => {
    const restatements = [
      "该说法称喝隔夜水会致癌。",
      "该说法指出喝隔夜水会致癌。",
      "这句话说喝隔夜水会致癌。",
      "原句说喝隔夜水会致癌。",
    ];
    for (const restatement of restatements) {
      const snapshot = completeWith(
        "喝隔夜水会致癌。",
        `${restatement}公开检测未支持这一说法。`
      );
      expect(snapshot.conclusion?.verdictLead).toBe("公开检测未支持这一说法。");
      expect(snapshot.conclusion?.rationale).toBeUndefined();
      expect(snapshot.conclusion?.verdictLead).not.toContain("喝隔夜水会致癌");
    }
  });
});

describe("E11 带连接词且追加新信息必须保留", () => {
  it("剥离引导词与连接词后 ≠ 原句 → 保留", () => {
    const snapshot = completeWith(
      "喝隔夜水会致癌。",
      "该说法称喝隔夜水会致癌，但没超标。公开检测未支持这一说法。"
    );
    expect(snapshot.conclusion?.verdictLead).toBe("该说法称喝隔夜水会致癌，但没超标。");
    expect(snapshot.conclusion?.rationale).toBe("公开检测未支持这一说法。");
  });
});
