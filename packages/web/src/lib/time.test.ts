import { describe, expect, it } from "vitest";
import { formatRelativeTime, previewText } from "./time.js";

describe("time", () => {
  it("previewText 截到 24 字", () => {
    expect(previewText("短句")).toBe("短句");
    expect(previewText("一二三四五六七八九十一二三四五六七八九十一二三四五六")).toBe(
      "一二三四五六七八九十一二三四五六七八九十一二三四…",
    );
  });

  it("formatRelativeTime 输出相对时间", () => {
    const now = new Date("2026-09-03T12:03:00.000Z").getTime();
    expect(formatRelativeTime("2026-09-03T12:00:00.000Z", now)).toBe("3 分钟前");
  });
});
