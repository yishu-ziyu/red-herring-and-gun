import { describe, expect, it } from "vitest";
import {
  applyContextCrossCheckToReport,
  contextCrossCheck,
  coreClaimTokens,
} from "./contextCrossCheck.js";

describe("coreClaimTokens", () => {
  it("抽核心词，滤停用词与短词", () => {
    const t = coreClaimTokens("这家医院是不是真的免费？");
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.includes("医院")).toBe(true);
  });
});

describe("contextCrossCheck — 配文 vs 截图语料", () => {
  it("配文要点全部没出现在截图 → 提示（配文曲解候选）", () => {
    const r = contextCrossCheck({
      claim: "截图说某医院免费看病",
      visualExtraction: {
        extractedClaims: ["今日天气晴"],
        ocrTexts: ["天气预报第 12 期"],
        visualSummary: "一张天气预报截图",
      },
    });
    expect(r.visible).toBe(true);
    expect(r.hint).toMatch(/医院/);
  });

  it("配文要点能在截图里找到 → 不打扰", () => {
    const r = contextCrossCheck({
      claim: "截图说某医院免费看病",
      visualExtraction: {
        extractedClaims: ["某医院免费看病活动公告"],
        ocrTexts: ["医院 免费"],
      },
    });
    expect(r.visible).toBe(true);
    expect(r.hint).toBeUndefined();
  });

  it("无视觉提取 / 无图内内容 → 不触发", () => {
    expect(contextCrossCheck({ claim: "随便一句话" }).visible).toBe(false);
    expect(
      contextCrossCheck({ claim: "随便一句话", visualExtraction: { ocrTexts: [] } }).visible
    ).toBe(false);
  });

  it("配文核心词不足 2 个 → 不判（宁漏不误）", () => {
    const r = contextCrossCheck({
      claim: "嗯，就这样",
      visualExtraction: { extractedClaims: ["今天下雨"] },
    });
    expect(r.hint).toBeUndefined();
  });
});

describe("applyContextCrossCheckToReport", () => {
  it("只追加提示与 cannotSay，不改判定字段", () => {
    const report: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: "公开材料还撑不住这条说法。",
    };
    applyContextCrossCheckToReport(report, {
      claim: "截图里说某股票明天涨停",
      visualExtraction: { extractedClaims: ["欢迎光临超市"], ocrTexts: ["超市入口"] },
    });
    expect(report.verdictType).toBe("unverified");
    expect(report.conclusion).toBe("公开材料还撑不住这条说法。");
    expect(Array.isArray(report.whyHardToVerify)).toBe(true);
    expect((report.whyHardToVerify as string[]).some((x) => x.includes("截图"))).toBe(true);
    expect(report._contextChecked).toBe(true);
    expect(report.claimContextMismatch).toBeDefined();
  });

  it("无提示时不动报告", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    applyContextCrossCheckToReport(report, { claim: "a b c d 大事件" });
    expect(report.whyHardToVerify).toBeUndefined();
    expect(report.claimContextMismatch).toBeUndefined();
  });
});