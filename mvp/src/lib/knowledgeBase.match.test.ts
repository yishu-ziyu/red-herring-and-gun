import { describe, expect, it } from "vitest";
import { normalizeHistoryClaim } from "./knowledgeBase";

describe("normalizeHistoryClaim", () => {
  it("collapses leading/trailing and repeated whitespace to one space", () => {
    expect(normalizeHistoryClaim("  北京  天安门  天安 ")).toBe("北京 天安门 天安");
    expect(normalizeHistoryClaim("A\tB\t\tC")).toBe("A B C");
    expect(normalizeHistoryClaim("  Foo\nBar \n\n Baz  ")).toBe("Foo Bar Baz");
  });

  it("preserves punctuation, case, and symbols while normalizing only spacing", () => {
    expect(normalizeHistoryClaim("  2026-09-05,  New-York  ???  ")).toBe("2026-09-05, New-York ???");
    expect(normalizeHistoryClaim("   AI-Generated   结果  还好  ")).toBe("AI-Generated 结果 还好");
    expect(normalizeHistoryClaim("  12.5%  is  a  rate  ")).toBe("12.5% is a rate");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeHistoryClaim("   \t\n   ")).toBe("");
    expect(normalizeHistoryClaim("")).toBe("");
  });
});
