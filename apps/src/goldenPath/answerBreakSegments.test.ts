import { describe, expect, it } from "vitest";
import { answerBreakSegments, isShortSegment } from "./ConclusionHero";

describe("answerBreakSegments", () => {
  it("按中文标点与引号拆段，分隔符留在前一段末尾", () => {
    expect(answerBreakSegments("现有证据不支持「隔夜菜会直接致癌、吃了等于吃毒药」。")).toEqual([
      "现有证据不支持「",
      "隔夜菜会直接致癌、",
      "吃了等于吃毒药」",
      "。",
    ]);
  });

  it("无标点时整句一段", () => {
    expect(answerBreakSegments("完全属实")).toEqual(["完全属实"]);
  });

  it("连续标点不产出空段", () => {
    expect(answerBreakSegments("属实。。")).toEqual(["属实。", "。"]);
  });
});

describe("isShortSegment", () => {
  it("短段（≤12 个实义字）锁不换行", () => {
    expect(isShortSegment("现有证据不支持「")).toBe(true);
    expect(isShortSegment("隔夜菜会直接致癌、")).toBe(true);
    expect(isShortSegment("吃了等于吃毒药」")).toBe(true);
  });

  it("长段（>12 个实义字）保持可断，防止溢出", () => {
    expect(isShortSegment("这一句没有任何标点但是特别长长到可以撑满一整行以上")).toBe(false);
  });

  it("标点引号空白不计入实义字", () => {
    expect(isShortSegment("「」、，。 ")).toBe(true);
  });
});
