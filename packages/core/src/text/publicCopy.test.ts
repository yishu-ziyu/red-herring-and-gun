import { describe, expect, it } from "vitest";
import {
  applyPublicCopy,
  ASK_CASE_FALLBACK,
  CHALLENGE_UNREACHABLE,
  constrainRecommendation,
  leadWithFace,
  looksLikeResearchMemo,
  OFF_TOPIC_REPLY,
  QUALIFY_FALLBACK,
  shapeConclusion,
  scrubPublicText,
} from "./publicCopy";

describe("追问固定文案", () => {
  it("固定回复不含训诫与厂商名", () => {
    const all = [
      CHALLENGE_UNREACHABLE,
      ASK_CASE_FALLBACK,
      OFF_TOPIC_REPLY,
      ...Object.values(QUALIFY_FALLBACK),
    ].join("");
    expect(all).not.toMatch(/请勿|不要相信|谣言|转发/);
    expect(all).not.toMatch(/MiniMax|OpenAI|Claude|web_search|web_fetch|GPT/i);
    expect(CHALLENGE_UNREACHABLE.length).toBeGreaterThan(0);
    expect(ASK_CASE_FALLBACK.length).toBeGreaterThan(0);
    expect(OFF_TOPIC_REPLY.length).toBeGreaterThan(0);
    for (const line of Object.values(QUALIFY_FALLBACK)) {
      expect(line.length).toBeGreaterThan(0);
      expect(line).toMatch(/？$/);
      expect(line).not.toMatch(/进入检索|检索|系统|模型|工单|出处|文件名|发布场合/);
    }
    expect(QUALIFY_FALLBACK.unavailable).not.toBe(QUALIFY_FALLBACK.no_claim);
  });
});

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
  it("不把还查不清盖在句首", () => {
    expect(leadWithFace("目前没有可点开的出处。", "unverified")).toBe("目前没有可点开的出处。");
  });

  it("剥掉四字章，留下真正的答案", () => {
    expect(leadWithFace("不能信。官方已辟谣。", "false")).toBe("官方已辟谣。");
  });

  it("闸门改判后，用直接回答而不是四字章打头", () => {
    expect(leadWithFace("能信。全市发钱。", "unverified")).toBe(
      "公开材料还撑不住判断。全市发钱。"
    );
  });
});

describe("constrainRecommendation", () => {
  it("转发建议收成直接回答，不盖四字章", () => {
    expect(constrainRecommendation("先别转发这条。", "false")).toBe("公开材料不支持这条说法。");
    expect(constrainRecommendation("请结合 canSay 再传播。", "unverified")).toBe(
      "公开材料还撑不住判断。"
    );
  });

  it("剥掉四字章，留下依据", () => {
    expect(constrainRecommendation("只能信一部分。前半有出处。", "mixed_misleading")).toBe(
      "前半有出处。"
    );
  });
});

describe("shapeConclusion", () => {
  it("去掉作文开头和行动建议，第一句是答案不是四字章", () => {
    const out = shapeConclusion(
      "截至目前研究表明属实。官方通报不支持该说法[1]。建议你先观察。仍不能推出全国范围。",
      "false"
    );
    expect(out.startsWith("不能信")).toBe(false);
    expect(out.startsWith("官方通报不支持该说法")).toBe(true);
    expect(out).not.toMatch(/截至目前|建议你/);
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
    expect(String(report.conclusion).startsWith("还查不清")).toBe(false);
    expect(String(report.conclusion)).not.toMatch(/ReportComposer|search360/);
    expect(report.recommendation).toBe("公开材料还撑不住判断。");
    expect((report.canSay as string[])[0]).not.toMatch(/FactChecker/);
    expect((report.evidenceChain as Array<{ finding: string }>)[0].finding).not.toMatch(
      /FactChecker/
    );
    expect(
      (report.subclaimVerdicts as Array<{ evidence: string }>)[0].evidence
    ).not.toMatch(/Tavily/);
  });

  it("does not clip a research memo down to five sentences", () => {
    const memo = [
      "## 核心结论",
      "",
      "**不能信。** 这一判断分两层。",
      "",
      "## 一、已核对的事实",
      "",
      "| 说法 | 判断 |",
      "| --- | --- |",
      "| 必然致癌 | 不成立 |",
      "",
      "REFERENCES",
      "",
      "1. [WHO](https://www.who.int/food)",
    ].join("\n");
    expect(looksLikeResearchMemo(memo)).toBe(true);
    const report: Record<string, unknown> = {
      verdictType: "false",
      conclusion: memo,
      summaryForPublic: "不能信。",
      recommendation: "不能信。",
    };
    applyPublicCopy(report);
    expect(String(report.conclusion)).toContain("## 核心结论");
    expect(String(report.conclusion)).toContain("| 说法 | 判断 |");
    expect(String(report.conclusion)).toContain("REFERENCES");
    expect(String(report.conclusion)).toContain("这一判断分两层");
    expect(String(report.conclusion)).not.toMatch(/## 核心结论\s+\*\*不能信/);
  });
});
