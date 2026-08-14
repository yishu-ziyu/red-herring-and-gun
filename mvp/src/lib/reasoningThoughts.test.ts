import { describe, expect, it } from "vitest";
import {
  collectReasoningSentences,
  createLiveThoughtPump,
  formatThoughtElapsedLabel,
  splitReasoningLive,
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

  it("splitReasoningLive: shows the unfinished tail while thinking", () => {
    expect(splitReasoningLive("先拆")).toEqual({ closed: [], tail: "先拆" });
    expect(splitReasoningLive("先拆命题。再看")).toEqual({
      closed: ["先拆命题。"],
      tail: "再看",
    });
    expect(splitReasoningLive("先拆命题。")).toEqual({ closed: ["先拆命题。"], tail: "" });
  });

  it("createLiveThoughtPump: emits the growing tail then closed sentences", () => {
    const events: Array<{ content: string; seq: number; partial: boolean }> = [];
    const pump = createLiveThoughtPump((content, seq, partial) => {
      events.push({ content, seq, partial });
    });
    pump.push("先");
    pump.push("先拆命题。对照");
    expect(events[0]).toEqual({ content: "先", seq: 0, partial: true });
    expect(events.some((e) => e.content === "先拆命题。" && e.seq === 0)).toBe(true);
    expect(events.at(-1)).toEqual({ content: "对照", seq: 1, partial: true });
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

  it("collectReasoningSentences: stream order, dedup, no invented copy", () => {
    expect(collectReasoningSentences(null)).toEqual([]);
    expect(
      collectReasoningSentences([
        { reasoning: ["原句拆成可核对判断。", "原句拆成可核对判断。"] },
        { reasoning: ["对照公开报道。"] },
        {},
      ])
    ).toEqual(["原句拆成可核对判断。", "对照公开报道。"]);
    expect(collectReasoningSentences([{ reasoning: ["对照公开报道。"] }]).join("")).not.toMatch(
      /jwt\.verify/
    );
  });
});
