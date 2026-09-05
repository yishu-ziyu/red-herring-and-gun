import { describe, expect, it } from "vitest";
import { investigationForEntry } from "./caseHandlers.js";
import { validateInvestigationSnapshot } from "./investigation/index.js";
import type { CaseEntry } from "./caseStore.js";

/**
 * Issue #51：打开旧历史调查——新数据直接读 investigation，
 * 旧数据确定性重建（不启动模型/搜索）；error-boundary 重建为 interrupted。
 */
function makeEntry(report: unknown, claim = "某说法"): CaseEntry {
  return {
    caseId: "test0001",
    claim,
    report: report as CaseEntry["report"],
    claimReview: {} as CaseEntry["claimReview"],
    credibilityScore: 50,
    createdAt: Date.now(),
  };
}

describe("investigationForEntry（历史兼容）", () => {
  it("旧报告（无 investigation 字段）确定性重建为 complete", () => {
    const stored = {
      conclusion: "只有前半截能站住。",
      verdictType: "mixed_misleading",
      claimItems: [
        {
          text: "某产品不含添加剂",
          verifiable: true,
          type: "fact",
          verdict: {
            claimAtom: "某产品不含添加剂",
            verdict: "true",
            evidence: "配料表与检测报告一致[1]。",
            supportingSources: [{ url: "https://t.test/report", title: "检测报告", snippet: "s" }],
            contradictingSources: [],
            evidenceGaps: [],
          },
        },
        { text: "添加剂都有害", verifiable: false, type: "价值" },
      ],
      subclaimVerdicts: [
        {
          claimAtom: "某产品不含添加剂",
          verdict: "true",
          evidence: "配料表与检测报告一致[1]。",
          supportingSources: [{ url: "https://t.test/report", title: "检测报告", snippet: "s" }],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      nonVerifiableAtoms: [{ text: "添加剂都有害", type: "价值" }],
      checkedAt: "2026-08-01T10:00:00.000Z",
    };
    const investigation = investigationForEntry(makeEntry(stored, "某产品不含添加剂，添加剂都有害"));
    expect(investigation).toBeDefined();
    const snapshot = validateInvestigationSnapshot(investigation);
    expect(snapshot.phase).toBe("complete");
    expect(snapshot.originalClaim).toBe("某产品不含添加剂，添加剂都有害");
    const supported = snapshot.claims.find((c) => c.text === "某产品不含添加剂")!;
    expect(supported.judgment).toBe("supported");
    expect(supported.evidence.map((l) => l.role)).toContain("support");
    expect(snapshot.claims.find((c) => c.text === "添加剂都有害")!.judgment).toBe("not-applicable");
    expect(snapshot.conclusion?.directAnswer).toBe("只有前半截能站住。");
  });

  it("新报告带 investigation 字段：原样返回（校验通过）", () => {
    const storedInvestigation = {
      schemaVersion: 1,
      originalClaim: "x",
      phase: "complete",
      claims: [],
      sources: [],
      conflicts: [],
      checkedAt: "2026-09-06T00:00:00.000Z",
    };
    const stored = { conclusion: "c", verdictType: "unverified", investigation: storedInvestigation };
    const investigation = investigationForEntry(makeEntry(stored, "x"));
    expect(investigation).toEqual(storedInvestigation);
  });

  it("旧 error-boundary 报告重建为 interrupted，无 conclusion", () => {
    const stored = { _source: "error-boundary", conclusion: "核查超过时限，先给中间结论。", verdictType: "unverified" };
    const snapshot = validateInvestigationSnapshot(investigationForEntry(makeEntry(stored, "超时句")));
    expect(snapshot.phase).toBe("interrupted");
    expect(snapshot.conclusion).toBeUndefined();
    expect(snapshot.claims).toEqual([]);
  });

  it("报告形状损坏：返回 undefined，不伪造", () => {
    expect(investigationForEntry(makeEntry(null))).toBeUndefined();
    expect(investigationForEntry(makeEntry("not-a-report"))).toBeUndefined();
  });
});
