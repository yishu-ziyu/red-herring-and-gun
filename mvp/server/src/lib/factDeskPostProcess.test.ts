import { describe, expect, it } from "vitest";
import {
  applyFactDeskPostProcessToReport,
  postProcessHandoffFinalReport,
} from "./factDeskPostProcess";

describe("postProcessHandoffFinalReport (Prompt A+F)", () => {
  it("strips drama and injects claim framing + uncertainty", () => {
    const result = postProcessHandoffFinalReport(
      {
        conclusion: "这纯属捏造，令人啼笑皆非。",
        summaryForPublic: "作为人工智能我认为震惊全网。",
        recommendation: "广大网友务必理性。",
        canSay: ["有公开材料可核对"],
        cannotSay: [],
        whyHardToVerify: [],
      },
      "中央已经决定下月起取消退休金",
    );

    expect(result).not.toBeNull();
    const report = result!.report;
    expect(String(report.conclusion)).toContain("流传说法");
    expect(String(report.conclusion)).not.toMatch(/纯属捏造|啼笑|震惊/);
    expect(String(report.summaryForPublic)).not.toMatch(/作为人工智能|震惊全网/);
    expect(String(report.recommendation)).not.toMatch(/广大网友务必/);
    expect(Array.isArray(report.cannotSay) && (report.cannotSay as string[]).length).toBeGreaterThan(0);
    expect(result!.notes.length).toBeGreaterThan(0);
  });

  it("sanitizes infrastructure errors out of public fields", () => {
    const result = postProcessHandoffFinalReport(
      {
        conclusion: "ReportComposer all providers failed: API error quota exceeded",
        summaryForPublic: "正常结论，证据不足。",
        canSay: [],
        cannotSay: ["不能在证据不足时把原说法写成已证实事实。"],
      },
      "测试命题",
    );

    expect(String(result!.report.conclusion)).not.toMatch(/quota|providers failed/i);
    expect(String(result!.report.summaryForPublic)).toContain("证据不足");
  });

  it("keeps clean fact-desk prose mostly intact", () => {
    const clean = {
      conclusion:
        "流传说法是：「隔夜菜会致癌」。公开材料显示正常储存下亚硝酸盐远低于限量，现有证据不足以支持「等于毒药」。",
      summaryForPublic: "隔夜菜致癌这一说法证据不足，不宜按原强度传播。",
      recommendation: "先看来源再判断能不能信。",
      canSay: ["能信正常储存下含量通常低于安全限量"],
      cannotSay: ["不能说等于毒药", "没有人群研究时，不能当成导致癌症"],
      whyHardToVerify: ["把剂量问题压成绝对因果"],
    };
    const result = postProcessHandoffFinalReport(clean, "隔夜菜会致癌，吃了等于吃毒药");
    expect(String(result!.report.conclusion)).toContain("流传说法");
    expect(result!.report.canSay).toEqual(clean.canSay);
    expect(result!.report.cannotSay).toEqual(clean.cannotSay);
  });

  it("decisive false 结论补上不能信，不再套「仍不足以确认」", () => {
    const result = postProcessHandoffFinalReport(
      {
        verdictType: "false",
        conclusion: "甘南州文旅局声明从未发布全州免票。",
        summaryForPublic: "官方已说明该通知是假的。",
        canSay: ["能信文旅局声明"],
        cannotSay: ["不能把旅行社广告写成官方政策"],
      },
      "甘南所有景点一律免费",
    );
    expect(String(result!.report.conclusion)).toMatch(/^不能信/);
    expect(String(result!.report.conclusion)).not.toMatch(/仍不足以按原强度确认/);
    expect(result!.report.faceVerdict).toBe("不能信");
  });

  it("mutates report in place via applyFactDeskPostProcessToReport", () => {
    const report: Record<string, unknown> = {
      conclusion: "铁证如山，毋庸置疑。",
      canSay: [],
      cannotSay: [],
    };
    const notes = applyFactDeskPostProcessToReport(report, "某政策已落地取消");
    expect(notes.length).toBeGreaterThan(0);
    expect(String(report.conclusion)).not.toMatch(/铁证如山|毋庸置疑/);
    expect(report._factDeskPostProcess).toBeTruthy();
  });
});
