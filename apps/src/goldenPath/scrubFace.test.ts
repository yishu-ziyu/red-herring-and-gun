import { describe, expect, it } from "vitest";
import { scrubFaceText } from "./scrubFace";

describe("scrubFaceText：解释不得漏内部词", () => {
  it("L1：丢掉 claim中，不留下「中「」", () => {
    const text = scrubFaceText(
      "相关内容已从课文中删除。claim中「这句话曾被写进无数教科书与科普读物」尚未查清，未计入该判断。",
    );
    expect(text).not.toMatch(/claim/i);
    expect(text).toContain("「这句话曾被写进无数教科书与科普读物」尚未查清，未计入该判断。");
    expect(text).toContain("相关内容已从课文中删除。");
  });

  it("L2：丢掉半截 IA 和双引号残字", () => {
    const text = scrubFaceText(
      "各来源均未提及专项评估。IA「「微波炉加热食物会致癌」这一说法在流行病学上有可靠的实验数据支持」尚未查清，未计入该判断。",
    );
    expect(text).not.toMatch(/\bIA\b/);
    expect(text).not.toContain("「「");
    expect(text).toContain("「微波炉加热食物会致癌」");
    expect(text).toContain("尚未查清，未计入该判断。");
  });

  it("不误伤完整 IARC 和普通中文", () => {
    expect(scrubFaceText("IARC 将射频辐射列为 2B 类。")).toContain("IARC");
    expect(scrubFaceText("微波炉加热食物会致癌吗？")).toBe("微波炉加热食物会致癌吗？");
  });
});
