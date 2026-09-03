import { describe, expect, it } from "vitest";
import { faceWord } from '@rhg/core/publicCopy';
import { ROLES, STATUS, STOP_REASONS, claimFace, faceTone } from "./copy.js";

describe("copy", () => {
  it("状态词只有规定的八个", () => {
    expect(Object.values(STATUS)).toEqual([
      "正在拆题",
      "正在找证据",
      "正在核对",
      "正在追索",
      "正在复核",
      "正在写结论",
      "已完成",
      "已中止",
    ]);
  });

  it("停止原因只有规定的五个", () => {
    expect(Object.values(STOP_REASONS)).toEqual([
      "预算用完",
      "没有新收获",
      "已经查清",
      "时间到",
      "工具故障",
    ]);
  });

  it("role 只有三个中文词", () => {
    expect(Object.values(ROLES)).toEqual(["主查", "控方", "辩方"]);
  });

  it("face 词来自 publicCopy", () => {
    expect(claimFace("true")).toBe(faceWord("true"));
    expect(claimFace("false")).toBe(faceWord("false"));
    expect(faceTone("unverified")).toBe("unclear");
  });
});
