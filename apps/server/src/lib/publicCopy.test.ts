import { describe, expect, it } from "vitest";
import {
  applyPublicCopy,
  applyUnopenedLinkConclusion,
  boundedInterruptedAnswer,
  constrainRecommendation,
  leadWithFace,
  looksLikeResearchMemo,
  looksLikeUrlOnlyClaim,
  shapeConclusion,
  scrubPublicText,
  UNOPENED_LINK_ANSWER,
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

  it("整句丢掉 wholeClaimAudit，不留残句", () => {
    const text = scrubPublicText(
      "微波本身不致癌。但wholeClaimAudit指出的四项桥接缺口仍未补齐。各来源一致指出致癌物来自焦糊。",
    );
    expect(text).not.toMatch(/wholeClaimAudit/);
    expect(text).not.toMatch(/桥接缺口/);
    expect(text).toContain("微波本身不致癌");
    expect(text).toContain("各来源一致指出致癌物来自焦糊");
  });

  it("剥掉 S1 / S3/S5 来源序号，留下标题", () => {
    const text = scrubPublicText(
      "所有来源均为非学术性文章。S1将「咖啡与茶的千年战争」定义为「文化较量」。S3/S5中「人类战争史」指能量补充。S2/S4同样为概括性叙述。",
    );
    expect(text).not.toMatch(/\bS\d+\b/);
    expect(text).toContain("「咖啡与茶的千年战争」");
    expect(text).toContain("「人类战争史」");
    expect(text).toContain("同样为概括性叙述");
  });

  it("不误伤第一次世界大战", () => {
    expect(scrubPublicText("第一次世界大战改变了补给。")).toBe("第一次世界大战改变了补给。");
  });

  it("丢掉 claim中，不留下内部 schema 词", () => {
    const text = scrubPublicText(
      "课文已删。claim中「这句话曾被写进无数教科书与科普读物」尚未查清，未计入该判断。",
    );
    expect(text).not.toMatch(/claim/i);
    expect(text).toContain("「这句话曾被写进无数教科书与科普读物」尚未查清");
  });

  it("丢掉半截 IA 和双引号残字，保住完整 IARC", () => {
    const cut = scrubPublicText(
      "各来源均未提及专项评估。IA「「微波炉加热食物会致癌」这一说法尚未查清，未计入该判断。",
    );
    expect(cut).not.toMatch(/\bIA\b/);
    expect(cut).not.toContain("「「");
    expect(cut).toContain("「微波炉加热食物会致癌」");
    expect(scrubPublicText("IARC 将射频辐射列为 2B 类。")).toContain("IARC");
  });
});

describe("boundedInterruptedAnswer", () => {
  it("分条判断齐了：按条写出哪一截站住、哪一截站不住，总判断是有对有错", () => {
    const out = boundedInterruptedAnswer([
      { text: "低钠盐能预防中风", checkability: "checkable", judgment: "mixed" },
      { text: "肾病患者也能吃", checkability: "checkable", judgment: "refuted" },
      { text: "这消息传得很快", checkability: "not-applicable", judgment: "not-applicable" },
    ]);
    expect(out).not.toBeNull();
    expect(out!.directAnswer).toBe("「低钠盐能预防中风」有对有错；「肾病患者也能吃」站不住。");
    expect(out!.judgment).toBe("mixed");
  });

  it("还有命题没判断：不写总答", () => {
    expect(
      boundedInterruptedAnswer([
        { text: "命题A", checkability: "checkable", judgment: "refuted" },
        { text: "命题B", checkability: "checkable", judgment: null },
      ])
    ).toBeNull();
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
    expect(constrainRecommendation("有真有假。前半有出处。", "mixed_misleading")).toBe("前半有出处。");
    expect(constrainRecommendation("部分成立。只在加热不当时。", "partial")).toBe("只在加热不当时。");
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

describe("只贴链接打不开", () => {
  it("原句只是 URL 且 0 命题时，结论说链接打不开，不假装查完", () => {
    expect(looksLikeUrlOnlyClaim("https://weibo.com/1749990115/P3bF9xY1z")).toBe(true);
    expect(looksLikeUrlOnlyClaim("https://weibo.com/x 隔夜菜会致癌吗")).toBe(false);
    const report: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: "公开材料还撑不住判断。",
      summaryForPublic: "公开材料还撑不住判断。",
      recommendation: "公开材料还撑不住判断。",
      causalBoundary: "无法建立证据链：缺少原句文本，无法拆解原子命题",
    };
    applyUnopenedLinkConclusion(report, "https://weibo.com/1749990115/P3bF9xY1z", 0);
    expect(report.conclusion).toBe(UNOPENED_LINK_ANSWER);
    expect(String(report.causalBoundary)).toContain("链接打不开");
    expect(String(report.conclusion)).not.toContain("撑不住判断");
  });

  it("已经拆出命题时不改结论", () => {
    const report: Record<string, unknown> = { conclusion: "公开材料还撑不住判断。" };
    applyUnopenedLinkConclusion(report, "https://weibo.com/x", 2);
    expect(report.conclusion).toBe("公开材料还撑不住判断。");
  });
});
