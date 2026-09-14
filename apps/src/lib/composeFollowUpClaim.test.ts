import { describe, expect, it } from "vitest";
import {
  composeFollowUpClaim,
  conclusionMissesFollowUp,
  displayFollowUpClaim,
  FOLLOW_UP_MARKER,
  previousAnswerText,
} from "./composeFollowUpClaim";

describe("composeFollowUpClaim", () => {
  it("puts the user follow-up first and keeps the original claim as context", () => {
    const payload = composeFollowUpClaim({
      originalClaim: "隔夜菜加热会致癌吗",
      previousAnswer: "加热不当有风险，但不能直接等同致癌。",
      followUp: "那微波炉加热呢",
    });

    expect(payload.startsWith("那微波炉加热呢")).toBe(true);
    expect(payload).toContain("隔夜菜加热会致癌吗");
    expect(payload).toContain(FOLLOW_UP_MARKER);
    expect(payload).toContain("加热不当有风险");
    expect(payload.indexOf("那微波炉加热呢")).toBeLessThan(payload.indexOf("原对象"));
  });

  it("lists earlier follow-ups without turning the bubble text into the payload", () => {
    const payload = composeFollowUpClaim({
      originalClaim: "隔夜菜加热会致癌吗",
      previousAnswer: "不会直接致癌。",
      followUp: "那隔夜的鱼呢",
      priorFollowUps: ["那微波炉加热呢"],
    });

    expect(payload.startsWith("那隔夜的鱼呢")).toBe(true);
    expect(payload).toContain("此前追问：那微波炉加热呢");
  });

  it("previousAnswerText prefers conclusion over memo", () => {
    expect(
      previousAnswerText({
        conclusion: "不会。",
        memo: "# 长文\n不会。还有很多铺陈。",
      })
    ).toBe("不会。");
    expect(previousAnswerText({ memo: "只有备忘。" })).toBe("只有备忘。");
    expect(previousAnswerText(null)).toBe("");
  });
});

describe("displayFollowUpClaim：显示裁到标记之前", () => {
  const SINGLE_LINE = "那微波炉加热呢？";
  const MULTI_LINE = "第一行：隔夜菜冷藏后还能吃吗？\n第二行：必须吃的话，回热到什么温度才安全？";

  const compose = (followUp: string) =>
    composeFollowUpClaim({
      originalClaim: "隔夜菜会致癌，吃了等于吃毒药。",
      previousAnswer: "现有证据不支持「隔夜菜会致癌」。",
      followUp,
    });

  it("多行追问整段保留，不只第一行", () => {
    const payload = compose(MULTI_LINE);
    expect(payload).toContain(FOLLOW_UP_MARKER);
    expect(displayFollowUpClaim(payload)).toBe(MULTI_LINE);
  });

  it("单行追问只留追问本身，标记与原对象文字都不显示", () => {
    const shown = displayFollowUpClaim(compose(SINGLE_LINE));
    expect(shown).toBe(SINGLE_LINE);
    expect(shown).not.toContain(FOLLOW_UP_MARKER);
    expect(shown).not.toContain("原对象：");
    expect(shown).not.toContain("上一轮回答：");
  });

  it("不含标记的原文原样返回", () => {
    expect(displayFollowUpClaim("隔夜菜会致癌，吃了等于吃毒药。")).toBe("隔夜菜会致癌，吃了等于吃毒药。");
  });

  it("标记之前没有用户文本时返回空串，不返回残留的括号或换行", () => {
    expect(displayFollowUpClaim(`\n（${FOLLOW_UP_MARKER}）\n原对象：隔夜菜会致癌。`)).toBe("");
  });

  it("追问自身的括号不被当作标记的包装吃掉", () => {
    const asked = "不同蔬菜（如叶菜）亚硝酸盐残留有差异吗？";
    expect(displayFollowUpClaim(compose(asked))).toBe(asked);
  });
});

describe("追问结论是否答了这句追问", () => {
  it("IARC 专项评估顶替流行病学追问 → 判定为没答", () => {
    const claim = composeFollowUpClaim({
      originalClaim: "微波炉加热食物会致癌",
      previousAnswer: "站不住。",
      followUp: "这一说法在流行病学或临床医学中是否有可靠的实验数据支持？",
    });
    expect(
      conclusionMissesFollowUp(
        "「IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估」站不住。",
        claim
      )
    ).toBe(true);
    expect(conclusionMissesFollowUp("现有材料没有可靠的流行病学或临床实验数据支持。", claim)).toBe(false);
  });

  it("已经直接答了这句追问，不因为缺四字切片而判没答", () => {
    const claim = composeFollowUpClaim({
      originalClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
      previousAnswer: "亚硝酸盐会升高，谈不上中毒。",
      followUp: "吃了隔夜菜会导致中毒吗？",
    });
    expect(conclusionMissesFollowUp("直接回答这句追问：普通家庭剂量谈不上中毒。", claim)).toBe(false);
  });
});
