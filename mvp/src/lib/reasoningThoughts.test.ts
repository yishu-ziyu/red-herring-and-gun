import { describe, expect, it } from "vitest";
import {
  formatThoughtElapsedLabel,
  splitReasoningSentences,
  thoughtInterSentenceDelayMs,
} from "./reasoningThoughts";

describe("reasoningThoughts", () => {
  it("splitReasoningSentences: Chinese punctuation and newlines", () => {
    expect(splitReasoningSentences("第一句。第二句！第三句？")).toEqual([
      "第一句。",
      "第二句！",
      "第三句？",
    ]);
    expect(splitReasoningSentences("a\nb")).toEqual(["a", "b"]);
    expect(splitReasoningSentences("  ")).toEqual([]);
    expect(splitReasoningSentences("no terminator")).toEqual(["no terminator"]);
  });

  it("thoughtInterSentenceDelayMs: clamps and zero for single sentence", () => {
    expect(thoughtInterSentenceDelayMs(1)).toBe(0);
    expect(thoughtInterSentenceDelayMs(0)).toBe(0);
    const d = thoughtInterSentenceDelayMs(4);
    expect(d).toBeGreaterThanOrEqual(180);
    expect(d).toBeLessThanOrEqual(900);
  });

  it("formatThoughtElapsedLabel", () => {
    expect(formatThoughtElapsedLabel(undefined)).toBe("…");
    expect(formatThoughtElapsedLabel(400)).toBe("1s");
    expect(formatThoughtElapsedLabel(4200)).toBe("4.2s");
    expect(formatThoughtElapsedLabel(12500)).toBe("13s");
  });
});
