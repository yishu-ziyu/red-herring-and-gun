import { describe, expect, it } from "vitest";
import { assembleFinalReport, buildClaimItems, deriveOverallVerdict } from "./assembleFinalReport";
import { resolveImageOrigin } from "../imageOrigin/imageOrigin";

describe("assembleFinalReport", () => {
  it("可核查进 subclaimVerdicts，立场进 nonVerifiableAtoms，claimItems 原句序", () => {
    const finalReport: Record<string, unknown> = {};
    const result = assembleFinalReport({
      finalReport,
      rumorStep: {
        output: {
          claimAtoms: ["事实A", "价值B", "事实C"],
          claimAtomTypes: [
            { text: "事实A", verifiable: true, type: "fact" },
            { text: "价值B", verifiable: false, type: "value" },
            { text: "事实C", verifiable: true, type: "fact" },
          ],
          stanceClaimType: { verifiable: true, type: "mixed", reason: "mixed" },
        },
      },
      verdicts: [
        { claimAtom: "事实A", verdict: "true", evidence: "e", boundary: "b" },
        { claimAtom: "价值B", verdict: "false", evidence: "should drop", boundary: "x" },
      ],
    });

    expect(result.subclaimVerdicts.map((v) => v.claimAtom)).toEqual(["事实A", "事实C"]);
    expect(result.nonVerifiableAtoms).toEqual([{ text: "价值B", type: "value" }]);
    expect(result.claimItems.map((i) => i.text)).toEqual(["事实A", "价值B", "事实C"]);
    expect(result.claimItems[1].verifiable).toBe(false);
    expect(finalReport.stanceClaimType).toEqual({
      verifiable: true,
      type: "mixed",
      reason: "mixed",
    });
    expect(finalReport.faceVerdict).toBe("还查不清");
  });

  it("faceVerdict 跟随 verdictType", () => {
    const finalReport: Record<string, unknown> = { verdictType: "false" };
    assembleFinalReport({
      finalReport,
      rumorStep: { output: { claimAtoms: ["A"], claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }] } },
      verdicts: [{ claimAtom: "A", verdict: "false", evidence: "e", boundary: "b" }],
    });
    expect(finalReport.faceVerdict).toBe("不能信");
  });

  it("截图 origin 只来自 imageOrigin，文字检索 URL 不当成这张图的来源", () => {
    const secondHand = "https://weibo.com/second-hand-repost";
    const finalReport: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: `这张图的来源是 ${secondHand}。配文还查不清。`,
    };
    assembleFinalReport({
      finalReport,
      rumorStep: {
        output: {
          claimAtoms: ["某地地铁已经开通"],
          claimAtomTypes: [{ text: "某地地铁已经开通", verifiable: true, type: "fact" }],
        },
      },
      verdicts: [{ claimAtom: "某地地铁已经开通", verdict: "unverified", evidence: "e", boundary: "b" }],
      searchSources: [{ url: secondHand }],
      imageOrigin: resolveImageOrigin({
        reverseImageHits: [],
        textSearchHits: [{ url: secondHand, title: "转发帖" }],
      }),
    });
    const origin = finalReport.imageOrigin as { url?: string; label?: string };
    expect(origin.url).toBeUndefined();
    expect(origin.label).toMatch(/原图没查到|原图出处未查到/);
    expect(String(finalReport.conclusion)).not.toMatch(/这张图的来源/);
  });
});

describe("buildClaimItems", () => {
  it("只保留 merge 后仍存在的原子", () => {
    const items = buildClaimItems(
      ["A", "B", "C"],
      [{ claimAtom: "A" }],
      [{ text: "C", type: "value" }]
    );
    expect(items.map((i) => i.text)).toEqual(["A", "C"]);
  });
});

describe("assembleFinalReport 检索预算", () => {
  it("7 条可核查时未入选条按原句序出现且 unverified", () => {
    const atoms = [
      "背景一",
      "背景二",
      "背景三",
      "背景四",
      "背景五",
      "背景六",
      "隔夜菜导致癌症",
    ];
    const finalReport: Record<string, unknown> = {};
    const result = assembleFinalReport({
      finalReport,
      rumorStep: {
        output: {
          claimAtoms: atoms,
          claimAtomTypes: atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
        },
      },
      verdicts: atoms.map((claimAtom) => ({
        claimAtom,
        verdict: "true",
        evidence: "e",
        boundary: "b",
      })),
    });
    expect(result.claimItems.map((item) => item.text)).toEqual(atoms);
    const dropped = result.subclaimVerdicts.find((row) => row.claimAtom === "背景六");
    const keptCausal = result.subclaimVerdicts.find((row) => row.claimAtom === "隔夜菜导致癌症");
    expect(dropped?.verdict).toBe("unverified");
    expect(dropped?.evidenceGaps?.some((gap) => String(gap).includes("检索预算未覆盖"))).toBe(true);
    expect(keptCausal).toBeTruthy();
    expect(keptCausal?.evidenceGaps?.some((gap) => String(gap).includes("检索预算未覆盖"))).toBe(false);
  });

  it("立场条不进 subclaimVerdicts，claimItems 仍原句序", () => {
    const finalReport: Record<string, unknown> = {
      verdictType: "unverified",
      faceVerdict: "立场型 / 不适用真/假判断",
    };
    const result = assembleFinalReport({
      finalReport,
      rumorStep: {
        output: {
          claimAtoms: ["隔夜菜含细菌", "不该吃隔夜菜"],
          claimAtomTypes: [
            { text: "隔夜菜含细菌", verifiable: true, type: "fact" },
            { text: "不该吃隔夜菜", verifiable: false, type: "value" },
          ],
          stanceClaimType: { verifiable: false, type: "value", reason: "整句为价值判断" },
        },
      },
      verdicts: [{ claimAtom: "隔夜菜含细菌", verdict: "true", evidence: "e", boundary: "b" }],
    });
    expect(result.nonVerifiableAtoms).toEqual([{ text: "不该吃隔夜菜", type: "value" }]);
    expect(result.subclaimVerdicts.map((row) => row.claimAtom)).toEqual(["隔夜菜含细菌"]);
    expect(result.claimItems.map((item) => item.text)).toEqual(["隔夜菜含细菌", "不该吃隔夜菜"]);
    expect(result.claimItems[1].verifiable).toBe(false);
    expect(result.stanceClaimType).toEqual({
      verifiable: false,
      type: "value",
      reason: "整句为价值判断",
    });
  });
});

describe("deriveOverallVerdict", () => {
  const sourced = { url: "https://gov.cn/1" };

  it("有据 true + 有据 false → partial（mixed 救回，RUMOR-011 形态）", () => {
    expect(
      deriveOverallVerdict([
        { verdict: "false", supportingSources: [sourced] },
        { verdict: "true", supportingSources: [sourced] },
        { verdict: "partial", supportingSources: [sourced] },
      ])
    ).toBe("partial");
    expect(
      deriveOverallVerdict([
        { verdict: "true", supportingSources: [sourced] },
        { verdict: "false", supportingSources: [sourced] },
      ])
    ).toBe("partial");
  });

  it("真但无据 + 有据之假 → false（无据不救，纯谣言不受零星 true 干扰）", () => {
    expect(
      deriveOverallVerdict([
        { verdict: "false", supportingSources: [sourced] },
        { verdict: "true", supportingSources: [] },
      ])
    ).toBe("false");
  });

  it("检索垫的 related-only 来源不算有据（sourcesRelatedOnly=true 不救）", () => {
    expect(
      deriveOverallVerdict([
        { verdict: "false" },
        { verdict: "true", supportingSources: [sourced], sourcesRelatedOnly: true },
      ])
    ).toBeNull();
    expect(
      deriveOverallVerdict([
        { verdict: "false", supportingSources: [sourced] },
        { verdict: "true", supportingSources: [sourced], sourcesRelatedOnly: true },
      ])
    ).toBe("false");
  });

  it("两条无来源 false → null", () => {
    expect(deriveOverallVerdict([{ verdict: "false" }, { verdict: "false" }])).toBeNull();
  });

  it("单独一条有据 false → false", () => {
    expect(deriveOverallVerdict([{ verdict: "false", supportingSources: [sourced] }])).toBe("false");
    expect(deriveOverallVerdict([{ verdict: "false", contradictingSources: [sourced] }])).toBe("false");
  });

  it("全 true 且至少一条有据 → true；全无据 true → null", () => {
    expect(deriveOverallVerdict([{ verdict: "true", supportingSources: [sourced] }, { verdict: "true" }])).toBe("true");
    expect(deriveOverallVerdict([{ verdict: "true" }, { verdict: "true", supportingSources: [] }])).toBeNull();
  });

  it("仅 partial/exaggerated（无假）→ partial", () => {
    expect(deriveOverallVerdict([{ verdict: "exaggerated" }, { verdict: "partial" }])).toBe("partial");
  });

  it("无肯定判词（空/unverified/unknown）→ null 保留 LLM 整体字段", () => {
    expect(deriveOverallVerdict([])).toBeNull();
    expect(deriveOverallVerdict([{ verdict: "unverified" }, { verdict: "" }])).toBeNull();
    expect(deriveOverallVerdict([{ verdict: "unknown" }])).toBeNull();
  });
});
