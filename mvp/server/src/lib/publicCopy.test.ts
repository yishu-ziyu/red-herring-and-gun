import { describe, expect, it } from "vitest";
import {
  applyPublicCopy,
  constrainRecommendation,
  leadWithFace,
  shapeConclusion,
  scrubPublicText,
} from "./publicCopy";

describe("scrubPublicText", () => {
  it("剥掉工具名、角色名、检索商标", () => {
    const text = scrubPublicText(
      "FactChecker 对照 search360 与 Tavily 后，MiniMax 认为属实。"
    );
    expect(text).not.toMatch(/FactChecker|search360|Tavily|MiniMax/);
    expect(text).toContain("认为属实");
  });

  it("剥掉工具调用 / Agent / canSay", () => {
    const text = scrubPublicText("本次工具调用成功。Agent 写入 canSay。");
    expect(text).not.toMatch(/工具调用|\bAgent\b|canSay/);
  });
});

describe("leadWithFace", () => {
  it("无判断词时把还查不清放在句首", () => {
    expect(leadWithFace("目前没有可点开的出处。", "unverified")).toBe(
      "还查不清。目前没有可点开的出处。"
    );
  });

  it("已有判断词不重复加", () => {
    expect(leadWithFace("不能信。官方已辟谣。", "false")).toBe("不能信。官方已辟谣。");
  });
});

describe("constrainRecommendation", () => {
  it("转发建议收成判断词", () => {
    expect(constrainRecommendation("先别转发这条。", "false")).toBe("不能信。");
    expect(constrainRecommendation("请结合 canSay 再传播。", "unverified")).toBe("还查不清。");
  });

  it("已是判断词则保留", () => {
    expect(constrainRecommendation("只能信一部分。前半有出处。", "mixed_misleading")).toBe(
      "只能信一部分。前半有出处。"
    );
  });
});

describe("shapeConclusion", () => {
  it("去掉作文开头和行动建议，保留判断打头", () => {
    const out = shapeConclusion(
      "截至目前研究表明属实。官方通报不支持该说法[1]。建议你先观察。仍不能推出全国范围。",
      "false"
    );
    expect(out.startsWith("不能信")).toBe(true);
    expect(out).not.toMatch(/截至目前|建议你/);
    expect(out).toContain("官方通报不支持该说法");
  });

  it("超过五句只留前五句", () => {
    const out = shapeConclusion("不能信。一。二。三。四。五。六。", "false");
    expect(splitCount(out)).toBe(5);
  });
});

function splitCount(text: string): number {
  return text.split(/(?<=[。！？])/).filter((part) => part.trim()).length;
}

describe("applyPublicCopy", () => {
  it("结论、建议、faceVerdict 对齐；链上角色名去掉", () => {
    const report: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: "ReportComposer 未完成，search360 无结果。",
      summaryForPublic: "Tavily 没搜到。",
      recommendation: "建议你先别转发。",
      canSay: ["FactChecker 说可说"],
      cannotSay: ["不能把 MiniMax 记忆当出处"],
      evidenceChain: [
        {
          layer: "证据",
          finding: "FactChecker 未覆盖",
          evidence: "search360 空",
          boundary: "不能推出已证实",
        },
      ],
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "unverified", evidence: "Tavily 无结果", boundary: "待补证" },
      ],
    };
    applyPublicCopy(report);
    expect(report.faceVerdict).toBe("还查不清");
    expect(String(report.conclusion).startsWith("还查不清")).toBe(true);
    expect(String(report.conclusion)).not.toMatch(/ReportComposer|search360/);
    expect(report.recommendation).toBe("还查不清。");
    expect((report.canSay as string[])[0]).not.toMatch(/FactChecker/);
    expect((report.evidenceChain as Array<{ finding: string }>)[0].finding).not.toMatch(
      /FactChecker/
    );
    expect(
      (report.subclaimVerdicts as Array<{ evidence: string }>)[0].evidence
    ).not.toMatch(/Tavily/);
  });
});
