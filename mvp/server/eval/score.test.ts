import { describe, expect, it } from "vitest";
import { goldenDataset } from "./golden";
import { aggregateMetrics, aggregateRepeats, compareToBaseline, scoreCase, type CaseResult } from "./score";

describe("production golden dataset contract", () => {
  it("keeps the production cases unique and structurally complete", () => {
    expect(goldenDataset.length).toBeGreaterThanOrEqual(20);
    expect(new Set(goldenDataset.map((c) => c.id)).size).toBe(goldenDataset.length);
    expect(new Set(goldenDataset.map((c) => c.category)).size).toBeGreaterThanOrEqual(2);

    for (const golden of goldenDataset) {
      expect(golden.traps.length, `${golden.id} should document at least one trap`).toBeGreaterThanOrEqual(1);
      expect(golden.expectedCredibilityRange[0]).toBeGreaterThanOrEqual(0);
      expect(golden.expectedCredibilityRange[1]).toBeLessThanOrEqual(100);
      expect(golden.expectedCredibilityRange[0]).toBeLessThanOrEqual(golden.expectedCredibilityRange[1]);
    }
  });

  it("retains causal routing expectations and the known RUMOR-010 case", () => {
    const causalCases = goldenDataset.filter((c) => c.category === "causal");
    expect(causalCases.length).toBeGreaterThanOrEqual(3);
    for (const golden of causalCases) {
      expect(golden.expectedAgentSequence).toContain("alternative_explanation_searcher");
      expect(golden.expectedAgentSequence).toContain("counter_evidence_grader");
    }

    const rumor010 = goldenDataset.find((c) => c.id === "RUMOR-010");
    expect(rumor010).toBeDefined();
    expect(rumor010?.claim).toBe("常穿黑色内衣易患癌");
    expect(rumor010?.category).toBe("causal");
  });
});

describe("aggregateRepeats", () => {
  it("verdict 取多数票，credibility 取中位数", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 4 },
      { verdict: "unverified", credibility: 30 },
      { verdict: "false", credibility: 9 },
    ]);
    expect(result.verdict).toBe("false");
    expect(result.credibility).toBe(9);
    expect(result.verdictVotes).toEqual({ false: 2, unverified: 1 });
    expect(result.error).toBeUndefined();
  });

  it("偶数样本 credibility 取中间两值平均并四舍五入", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 4 },
      { verdict: "false", credibility: 10 },
    ]);
    expect(result.credibility).toBe(7);
  });

  it("全部 error 时返回 ERROR", () => {
    const result = aggregateRepeats([
      { verdict: "?", credibility: 0, error: "timeout" },
      { verdict: "?", credibility: 0, error: "timeout" },
    ]);
    expect(result.verdict).toBe("ERROR");
    expect(result.error).toBe("timeout");
  });

  it("部分 error 时只聚合成功轮次", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 6 },
      { verdict: "?", credibility: 0, error: "boom" },
      { verdict: "mixed_misleading", credibility: 20 },
    ]);
    // 并列 1:1 时按字典序取更小者（false < mixed_misleading）
    expect(result.verdict).toBe("false");
    expect(result.credibility).toBe(13);
    expect(result.error).toBeUndefined();
  });
});

function mkLoopCase(
  id: string,
  expectsLoop: boolean,
  loop?: CaseResult["evidenceLoop"]
): CaseResult {
  return {
    case: {
      id,
      claim: `claim-${id}`,
      category: "event",
      difficulty: "hard",
      expectedVerdictType: "false",
      expectedCredibilityRange: [0, 25],
      expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
      expectsEvidenceLoop: expectsLoop,
    },
    steps: [
      { agent: "rumor_detector" },
      { agent: "fact_checker" },
      { agent: "source_validator" },
      { agent: "report_composer" },
    ],
    finalReport: {
      verdictType: "false",
      credibilityScore: 5,
      _review: { passed: true, errorCount: 0, issueCount: 0 },
    },
    evidenceLoop: loop,
  };
}

describe("scoreCase evidenceLoop metrics", () => {
  it("ran=true + 任一原子 evidence-found → rescued", () => {
    const score = scoreCase(
      mkLoopCase("LOOP-1", true, {
        ran: true,
        atoms: [
          { atom: "A", trigger: "unverified", stopReason: "evidence-found", rounds: 1 },
          { atom: "B", trigger: "unverified", stopReason: "no-new-evidence", rounds: 2 },
        ],
        totalNewSources: 2,
        recheckFactChecker: true,
      })
    );
    expect(score.evidenceLoopExpected).toBe(true);
    expect(score.evidenceLoopRan).toBe(true);
    expect(score.evidenceLoopRescued).toBe(true);
  });

  it("ran=true 但全部判停 → 不算 rescued", () => {
    const score = scoreCase(
      mkLoopCase("LOOP-2", true, {
        ran: true,
        atoms: [{ atom: "A", trigger: "unverified", stopReason: "no-new-evidence", rounds: 2 }],
        totalNewSources: 0,
        recheckFactChecker: false,
      })
    );
    expect(score.evidenceLoopRan).toBe(true);
    expect(score.evidenceLoopRescued).toBe(false);
  });

  it("无 loop 数据 / error → ran=false", () => {
    expect(scoreCase(mkLoopCase("LOOP-3", true))?.evidenceLoopRan).toBe(false);
    const errored = mkLoopCase("LOOP-4", true);
    errored.error = "provider dead";
    expect(scoreCase(errored)?.evidenceLoopRan).toBe(false);
  });

  it("不期望 loop 的 case 不进聚合分母", () => {
    const agg = aggregateMetrics([
      scoreCase(mkLoopCase("R-1", false)),
      scoreCase(mkLoopCase("R-2", false)),
    ]);
    expect(agg.evidenceLoopExpectedCount).toBe(0);
    expect(agg.evidenceLoopTriggerRate).toBe(0);
  });

  it("聚合：trigger/rescue 只在期望 case 上算", () => {
    const agg = aggregateMetrics([
      scoreCase(
        mkLoopCase("LOOP-A", true, {
          ran: true,
          atoms: [{ atom: "A", trigger: "unverified", stopReason: "evidence-found" }],
          totalNewSources: 1,
          recheckFactChecker: true,
        })
      ),
      scoreCase(
        mkLoopCase("LOOP-B", true, {
          ran: true,
          atoms: [{ atom: "B", trigger: "conflict", stopReason: "search-failed" }],
          totalNewSources: 0,
          recheckFactChecker: false,
        })
      ),
      scoreCase(mkLoopCase("R-3", false)),
    ]);
    expect(agg.evidenceLoopExpectedCount).toBe(2);
    expect(agg.evidenceLoopTriggerRate).toBe(1);
    expect(agg.evidenceLoopRescueRate).toBe(0.5);
  });
});

const MAIN_STEPS = [
  { agent: "rumor_detector" },
  { agent: "fact_checker" },
  { agent: "source_validator" },
  { agent: "report_composer" },
];

function passingReview() {
  return { passed: true, errorCount: 0, issueCount: 0 };
}

function rumor011() {
  const c = goldenDataset.find((x) => x.id === "RUMOR-011");
  if (!c) throw new Error("missing RUMOR-011");
  return c;
}

function scoreRumor011(
  subclaims: Array<{
    claimAtom: string;
    verdict: string;
    supportingSources?: Array<{ url: string }>;
    sourcesRelatedOnly?: boolean;
  }>
) {
  const c = rumor011();
  return scoreCase({
    case: {
      id: c.id,
      claim: c.claim,
      category: c.category,
      difficulty: c.difficulty,
      expectedVerdictType: c.expectedVerdictType,
      expectedCredibilityRange: c.expectedCredibilityRange,
      expectedAgentSequence: c.expectedAgentSequence,
      expectedAtoms: c.expectedAtoms,
    },
    steps: MAIN_STEPS,
    finalReport: {
      verdictType: "mixed_misleading",
      credibilityScore: 20,
      _review: passingReview(),
      subclaimVerdicts: subclaims,
    },
  });
}

describe("golden 三类错案", () => {
  it("存在 RUMOR-011 按条期望、EVAL-UNVERIFIED-001、EVAL-TYPEGATE-001", () => {
    const mixed = rumor011();
    expect(mixed.expectedAtoms?.length).toBeGreaterThanOrEqual(2);
    expect(mixed.expectedAtoms?.some((a) => a.expectedVerdict === "true" && a.requireBoundUrl)).toBe(true);
    expect(mixed.expectedAtoms?.some((a) => a.expectedVerdict === "false")).toBe(true);

    const unverified = goldenDataset.find((c) => c.id === "EVAL-UNVERIFIED-001");
    expect(unverified?.expectedVerdictType).toBe("unverified");

    const typegate = goldenDataset.find((c) => c.id === "EVAL-TYPEGATE-001");
    expect(typegate?.mustSearch?.length).toBeGreaterThan(0);
  });
});

describe("scoreCase 半真半假按条", () => {
  it("原子对调 → overallPass false", () => {
    const score = scoreRumor011([
      {
        claimAtom: "每天喝红酒可以预防心脏病",
        verdict: "true",
        supportingSources: [{ url: "https://example.com/wine" }],
      },
      { claimAtom: "法国人喝红酒且心脏病少", verdict: "false" },
    ]);
    expect(score.verdictCorrect).toBe(true);
    expect(score.atomMatchPass).toBe(false);
    expect(score.overallPass).toBe(false);
  });

  it("原子正确且真侧有绑定 URL → 不因按条规则失败", () => {
    const score = scoreRumor011([
      { claimAtom: "每天喝红酒可以预防心脏病", verdict: "false" },
      {
        claimAtom: "法国人喝红酒且心脏病少",
        verdict: "true",
        supportingSources: [{ url: "https://example.com/french-paradox" }],
      },
    ]);
    expect(score.atomMatchPass).toBe(true);
    expect(score.overallPass).toBe(true);
  });

  it("原子正确但真侧无绑定 URL → 按条规则失败", () => {
    const score = scoreRumor011([
      { claimAtom: "每天喝红酒可以预防心脏病", verdict: "false" },
      { claimAtom: "法国人喝红酒且心脏病少", verdict: "true" },
    ]);
    expect(score.atomMatchPass).toBe(false);
    expect(score.overallPass).toBe(false);
  });

  it("真侧只有 related-only URL → 按条规则失败", () => {
    const score = scoreRumor011([
      { claimAtom: "每天喝红酒可以预防心脏病", verdict: "false" },
      {
        claimAtom: "法国人喝红酒且心脏病少",
        verdict: "true",
        supportingSources: [{ url: "https://example.com/related" }],
        sourcesRelatedOnly: true,
      },
    ]);
    expect(score.atomMatchPass).toBe(false);
    expect(score.overallPass).toBe(false);
  });
});

function unverifiedCase(actualVerdict: string, credibility = 40): CaseResult {
  return {
    case: {
      id: "EVAL-UNVERIFIED-001",
      claim: "同事群里说我们公司下周一会被收购，没有公告也没有监管披露",
      category: "event",
      difficulty: "hard",
      expectedVerdictType: "unverified",
      expectedCredibilityRange: [10, 70],
      expectedAgentSequence: ["rumor_detector", "fact_checker", "source_validator", "report_composer"],
    },
    steps: MAIN_STEPS,
    finalReport: {
      verdictType: actualVerdict,
      credibilityScore: credibility,
      _review: passingReview(),
      subclaimVerdicts: [],
    },
    atomSearchBundle: { atomsSearched: [], byAtomKey: {} },
  };
}

describe("scoreCase 期望 unverified", () => {
  it("期望 unverified 却写成 false（0 URL）→ hallucination + fail", () => {
    const score = scoreCase(unverifiedCase("false", 12));
    expect(score.hallucinationDetected).toBe(true);
    expect(score.overallPass).toBe(false);
  });

  it("期望 unverified 且实际 unverified（0 URL）→ pass", () => {
    const score = scoreCase(unverifiedCase("unverified", 40));
    expect(score.hallucinationDetected).toBe(false);
    expect(score.verdictCorrect).toBe(true);
    expect(score.overallPass).toBe(true);
  });
});

function typegateCase(atomsSearched: string[]): CaseResult {
  const c = goldenDataset.find((x) => x.id === "EVAL-TYPEGATE-001");
  if (!c) throw new Error("missing EVAL-TYPEGATE-001");
  return {
    case: {
      id: c.id,
      claim: c.claim,
      category: c.category,
      difficulty: c.difficulty,
      expectedVerdictType: c.expectedVerdictType,
      expectedCredibilityRange: c.expectedCredibilityRange,
      expectedAgentSequence: c.expectedAgentSequence,
      mustSearch: c.mustSearch,
    },
    steps: MAIN_STEPS,
    finalReport: {
      verdictType: "false",
      credibilityScore: 8,
      _review: passingReview(),
    },
    atomSearchBundle: { atomsSearched },
  };
}

describe("scoreCase mustSearch", () => {
  it("mustSearch 未命中 → fail", () => {
    const score = scoreCase(typegateCase([]));
    expect(score.mustSearchPass).toBe(false);
    expect(score.overallPass).toBe(false);
  });

  it("mustSearch 命中 → 不因类型闸规则失败", () => {
    const result = typegateCase(["隔夜菜会致癌"]);
    result.finalReport.nonVerifiableAtoms = [{ text: "隔夜菜会致癌", type: "value" }];
    result.finalReport.claimItems = [{ text: "隔夜菜会致癌", verifiable: false, type: "value" }];
    const score = scoreCase(result);
    expect(score.mustSearchPass).toBe(true);
    expect(score.overallPass).toBe(true);
  });
});

describe("compareToBaseline", () => {
  it("totalCases 14 vs 当前条数 → 失败", () => {
    expect(goldenDataset.length).not.toBe(14);
    const result = compareToBaseline(
      { totalCases: 14, verdictAccuracy: 1, routingAccuracy: 1, reportContractPassRate: 1 },
      {
        totalCases: goldenDataset.length,
        verdictAccuracy: 1,
        routingAccuracy: 1,
        reportContractPassRate: 1,
      }
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "totalCases")?.ok).toBe(false);
  });

  it("条数一致且三项不退化 → 通过", () => {
    const result = compareToBaseline(
      { totalCases: goldenDataset.length, verdictAccuracy: 0.8, routingAccuracy: 1, reportContractPassRate: 1 },
      {
        totalCases: goldenDataset.length,
        verdictAccuracy: 0.8,
        routingAccuracy: 1,
        reportContractPassRate: 1,
      }
    );
    expect(result.passed).toBe(true);
  });
});

describe("scoreCase 旧案", () => {
  it("无新字段时行为不变", () => {
    const score = scoreCase(mkLoopCase("RUMOR-001", false));
    expect(score.atomMatchPass).toBe(true);
    expect(score.mustSearchPass).toBe(true);
    expect(score.overallPass).toBe(true);
  });

  it("mixed 写成 false 不算幻觉", () => {
    const score = scoreCase({
      case: {
        id: "RUMOR-011",
        claim: rumor011().claim,
        category: "causal",
        difficulty: "trap",
        expectedVerdictType: "mixed_misleading",
        expectedCredibilityRange: [10, 35],
        expectedAgentSequence: rumor011().expectedAgentSequence,
      },
      steps: MAIN_STEPS,
      finalReport: {
        verdictType: "false",
        credibilityScore: 20,
        _review: passingReview(),
      },
    });
    expect(score.hallucinationDetected).toBe(false);
    expect(score.verdictCorrect).toBe(false);
    expect(score.overallPass).toBe(false);
  });

  it("确定性 verdict 反转会被标记为 hallucination", () => {
    const result = mkLoopCase("RUMOR-001", false);
    result.finalReport.verdictType = "true";
    const score = scoreCase(result);
    expect(score.hallucinationDetected).toBe(true);
    expect(score.verdictCorrect).toBe(false);
    expect(score.overallPass).toBe(false);
  });

  it("聚合报告契约通过率并保留失败原因", () => {
    const good = scoreCase(mkLoopCase("RUMOR-001", false));
    const badResult = mkLoopCase("RUMOR-002", false);
    badResult.finalReport._review = { passed: false, errorCount: 1, issueCount: 1 };
    const bad = scoreCase(badResult);
    const aggregate = aggregateMetrics([good, bad]);

    expect(aggregate.reportContractPassRate).toBe(0.5);
    expect(aggregate.avgReportReviewScore).toBeLessThan(good.reportReviewScore);
    expect(aggregate.failures.some((failure) => failure.reason.includes("report contract"))).toBe(true);
  });
});
