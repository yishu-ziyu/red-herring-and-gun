import { expect, it } from "vitest";
import { reviewAndRepairReport } from "./reportReviewer.js";

it("薄报告只报错，不伪造证据层或改判", () => {
  const result = reviewAndRepairReport({ verdictType: "maybe", conclusion: "ok", credibilityScore: 999 }, { claim: "测试命题" });
  expect(result.passed).toBe(false);
  expect(result.issues.some((issue) => issue.code === "missing_verdict")).toBe(true);
  expect(result.repaired.verdictType).toBe("maybe");
  expect(result.issues.some((issue) => issue.code === "bad_score")).toBe(true);
  expect(result.repaired.evidenceChain).toBeUndefined();
});

it("正式判词缺绑定来源时报错，仍由判定阶段负责决定", () => {
  const result = reviewAndRepairReport({ verdictType: "true", conclusion: "材料支持这句话。", credibilityScore: 80,
    subclaimVerdicts: [{ claimAtom: "甲", verdict: "true", sourcesRelatedOnly: true,
      supportingSources: [{ url: "https://example.org/related" }] }] });
  expect(result.issues.some((issue) => issue.code === "unsourced_hard_verdict")).toBe(true);
  expect(result.repaired.verdictType).toBe("true");
});

it("有来源的完整报告保持原判词和解释", () => {
  const result = reviewAndRepairReport({ verdictType: "false", conclusion: "原文明确反驳这句话[1]。",
    credibilityScore: 20, subclaimVerdicts: [{ claimAtom: "甲", verdict: "false",
      contradictingSources: [{ url: "https://example.org/quote" }] }],
    evidenceChain: ["命题", "原文", "边界"].map((layer) => ({ layer, finding: "材料", evidence: "材料", boundary: "边界", sourceRefs: [] })),
    canSay: ["原文反驳"], cannotSay: ["无法推出别的说法"],
    confidenceDimensions: ["source_reliability", "evidence_completeness", "consistency", "recency", "authority"].map((dimension) => ({ dimension })),
    closureActions: [{ type: "archive_doubt", label: "归档", content: "边界", status: "ready" }] });
  expect(result.repaired.verdictType).toBe("false");
  expect(result.repaired.conclusion).toContain("原文明确反驳");
});
