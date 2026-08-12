import { describe, expect, it } from "vitest";
import {
  MAX_ATOM_SEARCHES,
  selectAtomsToSearch,
  buildAtomSearchBundle,
  bindAtomEvidenceToVerdicts,
} from "./atomSearch";

const key = (s: string) => s.replace(/\u3000/g, " ").slice(0, 180);

describe("selectAtomsToSearch", () => {
  it("去重并截断到 MAX_ATOM_SEARCHES", () => {
    const atoms = Array.from({ length: 10 }, (_, i) => `原子${i}`);
    atoms.push("原子0");
    const selected = selectAtomsToSearch(atoms);
    expect(selected).toHaveLength(MAX_ATOM_SEARCHES);
    expect(selected[0]).toBe("原子0");
    expect(new Set(selected).size).toBe(MAX_ATOM_SEARCHES);
  });
});

describe("buildAtomSearchBundle", () => {
  it("按原子归档来源并聚合去重 URL", () => {
    const bundle = buildAtomSearchBundle(
      [
        {
          atom: "药能治失眠",
          result: {
            answer: "有研究",
            model: "p1",
            sources: [
              { url: "https://a.example/1", title: "A", snippet: "sa" },
              { url: "https://shared.example", title: "S", snippet: "ss" },
            ],
          },
        },
        {
          atom: "已获批",
          result: {
            answer: "批文",
            model: "p2",
            sources: [
              { url: "https://b.example/2", title: "B", snippet: "sb" },
              { url: "https://shared.example", title: "S2", snippet: "ss2" },
            ],
          },
        },
      ],
      key
    );

    expect(bundle.atomsSearched).toEqual(["药能治失眠", "已获批"]);
    expect(bundle.byAtomKey[key("药能治失眠")]).toHaveLength(2);
    expect(bundle.byAtomKey[key("已获批")]).toHaveLength(2);
    expect(bundle.aggregate.sources).toHaveLength(3); // shared 去重
    expect(bundle.aggregate._source).toBe("per-atom-search");
    expect(bundle.forAgent).toHaveLength(2);
    expect(bundle.forAgent[0].sources[0].url).toBe("https://a.example/1");
    expect(bundle.filterMeta?.totals.before).toBe(4);
    expect(bundle.filterMeta?.totals.afterTopK).toBe(4);
    expect(bundle.aggregate.traceText).toMatch(/筛选/);
  });

  it("硬过滤 + 去重 + topK：噪声与重复不进 byAtomKey", () => {
    const bundle = buildAtomSearchBundle(
      [
        {
          atom: "测试原子",
          result: {
            sources: [
              { url: "", title: "无链", snippet: "x" }, // asSourceList 已丢
              { url: "javascript:void(0)", title: "js", snippet: "x" }, // S1 丢
              { url: "https://dup.example/a?utm_source=1", title: "Dup", snippet: "short" },
              { url: "https://dup.example/a", title: "Dup", snippet: "longer snippet here", credibility: "高" },
              { url: "https://bit.ly/spam", title: "shortlink", snippet: "ads" }, // denylist
              { url: "https://ok.example/b", title: "OK", snippet: "body enough text" },
            ],
          },
        },
      ],
      key
    );
    const src = bundle.byAtomKey[key("测试原子")] ?? [];
    expect(src.every((s) => /^https?:\/\//.test(s.url))).toBe(true);
    expect(src.some((s) => s.url.includes("bit.ly"))).toBe(false);
    expect(src.filter((s) => s.url.includes("dup.example"))).toHaveLength(1);
    // asSourceList 丢空 URL → before=5；S1 丢 js + bit.ly、S2 并 dup → afterTopK=2
    expect(bundle.filterMeta?.totals.before).toBe(5);
    expect(bundle.filterMeta?.totals.afterTopK).toBe(2);
    expect(src).toHaveLength(2);
  });
});

describe("bindAtomEvidenceToVerdicts", () => {
  const byAtom = {
    [key("原子A")]: [{ url: "https://a.example", title: "A", snippet: "sa" }],
    [key("原子B")]: [] as Array<{ url: string; title: string; snippet: string }>,
  };

  it("模型空来源时用该原子检索结果填充 supportingSources", () => {
    const out = bindAtomEvidenceToVerdicts(
      [
        {
          claimAtom: "原子A",
          verdict: "true",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      byAtom,
      key
    );
    expect(out[0].supportingSources).toEqual(byAtom[key("原子A")]);
  });

  it("丢掉不在该原子检索池内的模型 URL，并重写 evidence [n]", () => {
    const out = bindAtomEvidenceToVerdicts(
      [
        {
          claimAtom: "原子A",
          evidence: "真来源[1]，幻觉[2]。",
          supportingSources: [
            { url: "https://a.example", title: "ok", snippet: "" },
            { url: "https://hallucinated.example", title: "no", snippet: "" },
          ],
          contradictingSources: [],
        },
      ],
      byAtom,
      key
    );
    expect(out[0].supportingSources?.map((s) => s.url)).toEqual(["https://a.example"]);
    expect(out[0].evidence).toBe("真来源[1]，幻觉。");
    expect(out[0].sourcesRelatedOnly).toBe(false);
  });

  it("检索填充时剥离 [n]，标记 sourcesRelatedOnly", () => {
    const out = bindAtomEvidenceToVerdicts(
      [
        {
          claimAtom: "原子A",
          evidence: "模型空来源却写了[1]。",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      byAtom,
      key
    );
    expect(out[0].sourcesRelatedOnly).toBe(true);
    expect(out[0].evidence).not.toMatch(/\[\d+\]/);
    expect(out[0].supportingSources?.map((s) => s.url)).toEqual(["https://a.example"]);
  });

  it("检索为空时写入定向检索无结果缺口", () => {
    const out = bindAtomEvidenceToVerdicts(
      [
        {
          claimAtom: "原子B",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      byAtom,
      key
    );
    expect(out[0].supportingSources).toEqual([]);
    expect(out[0].evidenceGaps?.some((g) => String(g).includes("定向检索无结果"))).toBe(true);
  });
});
