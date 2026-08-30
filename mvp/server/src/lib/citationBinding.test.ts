import { describe, expect, it } from "vitest";
import {
  bindLocalCitations,
  bindRelatedSourcesOnly,
  bindGlobalConclusion,
  normalizeReportCitations,
  remapCitationMarkers,
  filterSourcesWithRemap,
} from "./citationBinding";

describe("filterSourcesWithRemap", () => {
  it("drops hallucinated URLs and remaps later indices", () => {
    const { sources, remap } = filterSourcesWithRemap(
      [
        { url: "https://a.example", title: "A", snippet: "sa" },
        { url: "https://fake.example", title: "Fake", snippet: "x" },
        { url: "https://b.example", title: "B", snippet: "sb" },
      ],
      new Set(["https://a.example", "https://b.example"])
    );
    expect(sources.map((s) => s.url)).toEqual(["https://a.example", "https://b.example"]);
    expect(remap.get(1)).toBe(1);
    expect(remap.get(2)).toBeUndefined();
    expect(remap.get(3)).toBe(2);
  });

  it("dedupes URL and maps both old indices to first", () => {
    const { sources, remap } = filterSourcesWithRemap([
      { url: "https://a.example", title: "A1", snippet: "" },
      { url: "https://a.example", title: "A2", snippet: "" },
    ]);
    expect(sources).toHaveLength(1);
    expect(remap.get(1)).toBe(1);
    expect(remap.get(2)).toBe(1);
  });
});

describe("remapCitationMarkers", () => {
  it("rewrites survivors and strips dead markers", () => {
    const remap = new Map([
      [1, 1],
      [3, 2],
    ]);
    expect(remapCitationMarkers("甲[1]乙[2]丙[3]", remap)).toBe("甲[1]乙丙[2]");
  });
});

describe("bindLocalCitations", () => {
  it("aligns evidence [n] to surviving sources", () => {
    const bound = bindLocalCitations(
      "支持该点[1]，另一点见[2]，第三点[3]。",
      [
        { url: "https://a.example", title: "A", snippet: "sa" },
        { url: "https://fake.example", title: "Fake", snippet: "" },
        { url: "https://b.example", title: "B", snippet: "sb" },
      ],
      new Set(["https://a.example", "https://b.example"])
    );
    expect(bound.sources.map((s) => s.url)).toEqual(["https://a.example", "https://b.example"]);
    expect(bound.text).toBe("支持该点[1]，另一点见，第三点[2]。");
  });
});

describe("bindRelatedSourcesOnly", () => {
  it("strips markers when auto-filling retrieval hits", () => {
    const bound = bindRelatedSourcesOnly("模型写了[1]但未列来源。", [
      { url: "https://r.example", title: "R", snippet: "sr" },
    ]);
    expect(bound.relatedOnly).toBe(true);
    expect(bound.text).not.toMatch(/\[\d+\]/);
    expect(bound.sources[0].url).toBe("https://r.example");
  });
});

describe("bindGlobalConclusion", () => {
  it("numbers by first-seen unique supportingSources", () => {
    const { text, sources } = bindGlobalConclusion("综合看 A[1] 与 B[2] 成立。", [
      {
        supportingSources: [
          { url: "https://a.example", title: "A", snippet: "" },
          { url: "https://b.example", title: "B", snippet: "" },
        ],
      },
      {
        supportingSources: [{ url: "https://a.example", title: "A again", snippet: "" }],
      },
    ]);
    expect(sources.map((s) => s.url)).toEqual(["https://a.example", "https://b.example"]);
    expect(text).toContain("[1]");
    expect(text).toContain("[2]");
  });

  it("drops out-of-range markers", () => {
    const { text } = bindGlobalConclusion("无效编号[9]。", [
      { supportingSources: [{ url: "https://a.example", title: "A", snippet: "" }] },
    ]);
    expect(text).not.toMatch(/\[9\]/);
  });

  it("excludes relatedOnly (retrieval fill) sources from global references", () => {
    const { sources } = bindGlobalConclusion("结论。", [
      {
        supportingSources: [{ url: "https://cited.example", title: "Cited", snippet: "" }],
      },
      {
        sourcesRelatedOnly: true,
        supportingSources: [{ url: "https://fill.example", title: "Fill", snippet: "" }],
      },
    ]);
    expect(sources.map((s) => s.url)).toEqual(["https://cited.example"]);
  });
});

describe("normalizeReportCitations", () => {
  it("writes citationSources and rewrites chain evidence markers", () => {
    const report: Record<string, unknown> = {
      conclusion: "结论依赖[1]。",
      subclaimVerdicts: [
        {
          claimAtom: "原子A",
          verdict: "true",
          evidence: "证据[1]。",
          boundary: "",
          supportingSources: [{ url: "https://a.example", title: "A", snippet: "sa" }],
        },
      ],
      evidenceChain: [
        {
          layer: "搜索",
          finding: "f",
          evidence: "链上[1][2]。",
          boundary: "b",
          sourceRefs: ["https://a.example", "not-a-url"],
        },
      ],
    };
    normalizeReportCitations(report);
    expect((report.citationSources as any[])[0].url).toBe("https://a.example");
    expect(report.conclusion).toBe("结论依赖[1]。");
    const layer = (report.evidenceChain as any[])[0];
    expect(layer.evidence).toBe("链上[1]。");
    expect(layer.sourceRefs).toEqual(["https://a.example"]);
    expect(layer._citeSources[0].url).toBe("https://a.example");
  });
});
