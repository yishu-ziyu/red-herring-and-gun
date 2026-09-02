import { describe, expect, it } from "vitest";
import {
  composeFollowUpClaim,
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
