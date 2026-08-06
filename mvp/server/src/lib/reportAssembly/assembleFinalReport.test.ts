import { describe, expect, it } from "vitest";
import { assembleFinalReport, buildClaimItems } from "./assembleFinalReport";

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
