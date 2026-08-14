import { describe, expect, it } from "vitest";
import {
  buildCiteRefs,
  buildGlobalSources,
  clampMarkersToSources,
  stripCitationMarkers,
} from "./citationBinding";

describe("buildCiteRefs", () => {
  it("numbers sources 1..N and marks cited chips", () => {
    const { text, refs } = buildCiteRefs("说法成立[1]，细节见[2]。", [
      { url: "https://a.example/x", title: "来源A", snippet: "摘要A" },
      { url: "https://b.example/y", title: "来源B" },
    ]);
    expect(text).toContain("[1]");
    expect(refs.map((r) => r.n)).toEqual([1, 2]);
    expect(refs[0].cited).toBe(true);
    expect(refs[0].host).toBe("a.example");
    expect(refs[1].cited).toBe(true);
  });

  it("drops out-of-range markers", () => {
    const { text, refs } = buildCiteRefs("坏编号[3]。", [
      { url: "https://a.example", title: "A" },
    ]);
    expect(text).not.toMatch(/\[3\]/);
    expect(refs).toHaveLength(1);
    expect(refs[0].cited).toBe(false);
  });

  it("relatedOnly strips all markers", () => {
    const { text, refs } = buildCiteRefs("检索填充[1]。", [{ url: "https://a.example", title: "A" }], {
      relatedOnly: true,
    });
    expect(text).not.toMatch(/\[\d+\]/);
    expect(refs[0].cited).toBe(false);
  });
});

describe("buildGlobalSources", () => {
  it("skips related-only groups for global numbering", () => {
    const global = buildGlobalSources([
      {
        sources: [{ url: "https://related.example", title: "R" }],
        relatedOnly: true,
      },
      {
        sources: [{ url: "https://cited.example", title: "C" }],
        relatedOnly: false,
      },
    ]);
    expect(global.map((s) => s.url)).toEqual(["https://cited.example"]);
  });
});

describe("clamp / strip", () => {
  it("strip removes markers", () => {
    expect(stripCitationMarkers("a[1]b[2]")).toBe("ab");
  });
  it("clamp keeps only in-range", () => {
    expect(clampMarkersToSources("a[1]b[9]", 1)).toBe("a[1]b");
  });
});
