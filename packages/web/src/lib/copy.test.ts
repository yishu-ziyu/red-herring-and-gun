import { describe, expect, it } from "vitest";
import { faceWord } from '@rhg/core/publicCopy';
import { MEMO_FOLLOW, MEMO_PURSUE, MEMO_USER, ROLES, STATUS, STOP_REASONS, claimFace, faceTone, memoBody, memoLabel, pursueText } from "./copy.js";

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

  it("pursueText 生成追查正文", () => {
    expect(pursueText("gov.cn/zhengce")).toBe("追查 · gov.cn/zhengce");
  });

  it("用户消息标签：原句 / 追问 / 追查", () => {
    expect(memoLabel(undefined, false)).toBe(MEMO_USER);
    expect(memoLabel("new_claim", false)).toBe(MEMO_USER);
    expect(memoLabel("ask_case", true)).toBe(MEMO_FOLLOW);
    expect(memoLabel("pursue_frontier", true)).toBe(MEMO_PURSUE);
    expect(memoLabel("pursue_frontier", false)).toBe(MEMO_PURSUE);
  });

  it("追查正文去掉前缀只留芯片文案", () => {
    expect(memoBody(pursueText("gov.cn/zhengce"), "pursue_frontier")).toBe("gov.cn/zhengce");
    expect(memoBody("顺着这条出处再查", "pursue_frontier")).toBe("顺着这条出处再查");
    expect(memoBody(pursueText("gov.cn/zhengce"), "ask_case")).toBe("追查 · gov.cn/zhengce");
  });
});
