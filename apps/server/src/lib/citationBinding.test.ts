import { describe, expect, it } from "vitest";
import {
  bindLocalCitations,
  bindDualBucketCitations,
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

describe("bindDualBucketCitations", () => {
  it("Case A：supporting=[A] contradicting=[B]，[1] 与 [2] 都保留并指向正确来源", () => {
    const bound = bindDualBucketCitations(
      "A 支持一部分[1]；B 反驳核心[2]。",
      [{ url: "https://a.example", title: "A", snippet: "sa" }],
      [{ url: "https://b.example", title: "B", snippet: "sb" }]
    );
    expect(bound.supportingSources.map((s) => s.url)).toEqual(["https://a.example"]);
    expect(bound.contradictingSources.map((s) => s.url)).toEqual(["https://b.example"]);
    expect(bound.text).toBe("A 支持一部分[1]；B 反驳核心[2]。");
  });

  it("Case B：whitelist 删掉前桶某一来源后，跨桶 [2]→[1]、[3]→[2]", () => {
    const bound = bindDualBucketCitations(
      "坏[1] 好[2] 反[3]。",
      [
        { url: "https://bad.example", title: "bad", snippet: "" },
        { url: "https://a.example", title: "A", snippet: "" },
      ],
      [{ url: "https://b.example", title: "B", snippet: "" }],
      new Set(["https://a.example", "https://b.example"])
    );
    expect(bound.supportingSources.map((s) => s.url)).toEqual(["https://a.example"]);
    expect(bound.contradictingSources.map((s) => s.url)).toEqual(["https://b.example"]);
    expect(bound.remap.get(2)).toBe(1);
    expect(bound.remap.get(3)).toBe(2);
    expect(bound.remap.get(1)).toBeUndefined();
    expect(bound.text).toBe("坏 好[1] 反[2]。");
  });

  it("only support 不丢编号", () => {
    const bound = bindDualBucketCitations(
      "支持[1]。",
      [{ url: "https://a.example", title: "A", snippet: "" }],
      []
    );
    expect(bound.supportingSources.map((s) => s.url)).toEqual(["https://a.example"]);
    expect(bound.contradictingSources).toEqual([]);
    expect(bound.text).toBe("支持[1]。");
  });

  it("only contradict 从 [1] 起编", () => {
    const bound = bindDualBucketCitations(
      "反驳[1]。",
      [],
      [{ url: "https://b.example", title: "B", snippet: "" }]
    );
    expect(bound.supportingSources).toEqual([]);
    expect(bound.contradictingSources.map((s) => s.url)).toEqual(["https://b.example"]);
    expect(bound.text).toBe("反驳[1]。");
  });

  it("同 URL 跨桶：两条 relation 都保留，[1] 与 [2] 都在", () => {
    const x = { url: "https://x.example", title: "X", snippet: "both" };
    const bound = bindDualBucketCitations(
      "同一来源支持一部分[1]，也反驳另一部分[2]。",
      [x],
      [x]
    );
    expect(bound.supportingSources.map((s) => s.url)).toEqual(["https://x.example"]);
    expect(bound.contradictingSources.map((s) => s.url)).toEqual(["https://x.example"]);
    expect(bound.remap.get(1)).toBe(1);
    expect(bound.remap.get(2)).toBe(2);
    expect(bound.text).toBe("同一来源支持一部分[1]，也反驳另一部分[2]。");
  });

  it("每桶独立 cap：5 条 support + 1 条 contradict，C1 不得因合计超过 5 被丢掉", () => {
    const supporting = [1, 2, 3, 4, 5].map((n) => ({
      url: `https://s.example/${n}`,
      title: `S${n}`,
      snippet: "",
    }));
    const contradicting = [{ url: "https://c.example/1", title: "C1", snippet: "" }];
    const bound = bindDualBucketCitations(
      "S1[1] S2[2] S3[3] S4[4] S5[5] C1[6]。",
      supporting,
      contradicting
    );
    expect(bound.supportingSources.map((s) => s.url)).toEqual(supporting.map((s) => s.url));
    expect(bound.contradictingSources.map((s) => s.url)).toEqual(["https://c.example/1"]);
    expect(bound.remap.get(6)).toBe(6);
    expect(bound.text).toBe("S1[1] S2[2] S3[3] S4[4] S5[5] C1[6]。");
  });

  it("同 bucket 重复 URL 仍按旧逻辑 dedupe", () => {
    const bound = bindDualBucketCitations(
      "先[1] 再[2]。",
      [
        { url: "https://x.example", title: "X1", snippet: "" },
        { url: "https://x.example", title: "X2", snippet: "" },
      ],
      []
    );
    expect(bound.supportingSources).toHaveLength(1);
    expect(bound.supportingSources[0]?.url).toBe("https://x.example");
    expect(bound.contradictingSources).toEqual([]);
    expect(bound.remap.get(1)).toBe(1);
    expect(bound.remap.get(2)).toBe(1);
    expect(bound.text).toBe("先[1] 再[1]。");
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

  it("includes contradictingSources in global first-seen order", () => {
    const { text, sources } = bindGlobalConclusion("该说法不成立[1]。", [
      {
        supportingSources: [],
        contradictingSources: [{ url: "https://contra.example", title: "辟谣", snippet: "不实" }],
      },
    ]);
    expect(sources.map((s) => s.url)).toEqual(["https://contra.example"]);
    expect(text).toContain("[1]");
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
  it("同 URL 跨桶：两桶都保留，全局 citationSources 仍按 URL 去重", () => {
    const x = { url: "https://x.example", title: "X", snippet: "both" };
    const report: Record<string, unknown> = {
      conclusion: "综合[1]。",
      subclaimVerdicts: [
        {
          claimAtom: "原子A",
          verdict: "partial",
          evidence: "同一来源支持一部分[1]，也反驳另一部分[2]。",
          supportingSources: [x],
          contradictingSources: [x],
        },
      ],
    };
    normalizeReportCitations(report);
    const v = (report.subclaimVerdicts as Array<{
      evidence: string;
      supportingSources: Array<{ url: string }>;
      contradictingSources: Array<{ url: string }>;
    }>)[0];
    expect(v.supportingSources.map((s) => s.url)).toEqual(["https://x.example"]);
    expect(v.contradictingSources.map((s) => s.url)).toEqual(["https://x.example"]);
    expect(v.evidence).toBe("同一来源支持一部分[1]，也反驳另一部分[2]。");
    expect((report.citationSources as Array<{ url: string }>).map((s) => s.url)).toEqual([
      "https://x.example",
    ]);
  });

  it("dual-bucket：supporting + contradicting 的 [1][2] 都保留", () => {
    const report: Record<string, unknown> = {
      conclusion: "综合[1][2]。",
      subclaimVerdicts: [
        {
          claimAtom: "原子A",
          verdict: "partial",
          evidence: "A 支持一部分[1]；B 反驳核心[2]。",
          supportingSources: [{ url: "https://a.example", title: "A", snippet: "sa" }],
          contradictingSources: [{ url: "https://b.example", title: "B", snippet: "sb" }],
        },
      ],
    };
    normalizeReportCitations(report);
    expect((report.subclaimVerdicts as Array<{ evidence: string }>)[0].evidence).toBe(
      "A 支持一部分[1]；B 反驳核心[2]。"
    );
    expect((report.citationSources as Array<{ url: string }>).map((s) => s.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("keeps [n] when only contradictingSources are cited", () => {
    const report: Record<string, unknown> = {
      conclusion: "该说法不成立[1]。",
      subclaimVerdicts: [
        {
          claimAtom: "每次感冒都应当输液",
          verdict: "false",
          evidence: "感冒通常不需要输液[1]。",
          supportingSources: [],
          contradictingSources: [{ url: "https://health.example/iv", title: "输液", snippet: "通常不需要" }],
        },
      ],
    };
    normalizeReportCitations(report);
    expect((report.citationSources as Array<{ url: string }>)[0].url).toBe("https://health.example/iv");
    expect(report.conclusion).toBe("该说法不成立[1]。");
    expect((report.subclaimVerdicts as Array<{ evidence: string }>)[0].evidence).toBe("感冒通常不需要输液[1]。");
  });

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
