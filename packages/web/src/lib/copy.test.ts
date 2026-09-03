import { describe, expect, it } from "vitest";
import { STATUS, claimFace, faceTone } from "./copy.js";

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

  it("face 词来自 publicCopy", () => {
    expect(claimFace("true")).toBe("能信");
    expect(claimFace("false")).toBe("不能信");
    expect(faceTone("unverified")).toBe("unclear");
  });
});
