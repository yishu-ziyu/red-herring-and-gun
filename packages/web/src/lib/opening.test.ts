import { afterEach, describe, expect, it } from "vitest";
import { clearOpening, readOpening, saveOpening } from "./opening.js";

afterEach(() => {
  clearOpening();
});

describe("opening", () => {
  it("只返回同一 caseId 的原句", () => {
    saveOpening("c1", "隔夜菜会致癌，等于吃毒药");
    expect(readOpening("c1")).toBe("隔夜菜会致癌，等于吃毒药");
    expect(readOpening("c2")).toBeNull();
    clearOpening();
    expect(readOpening("c1")).toBeNull();
  });
});
