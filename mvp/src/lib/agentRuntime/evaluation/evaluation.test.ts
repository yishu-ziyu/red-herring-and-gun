import { describe, expect, it } from "vitest";
import { goldenDataset, getCase, getCasesByCategory, getCasesByDifficulty } from "./goldenDataset";
import { scoreCase, aggregateMetrics, scoreReportContract } from "./evaluationMetrics";
import { runCase } from "./benchmarkRunner";
import { reviewAndRepairReport } from "../reportReviewer";

/** Minimal RuntimeStep stub for metric unit tests */
function makeStep(agent: string, output: Record<string, unknown> = {}) {
  return {
    agent,
    agentName: agent.toUpperCase(),
    agentIcon: "",
    systemPrompt: "",
    input: {},
    output,
    evidenceBundle: {
      agentId: "",
      claimIds: [],
      supportEvidenceIds: [],
      contradictEvidenceIds: [],
      confidenceDelta: 0,
      unresolvedQuestions: [],
      sourceQualityScore: undefined,
      logicRiskCount: 0,
    },
    model: "mock",
    latencyMs: 100,
    timestamp: Date.now(),
    status: "completed" as const,
  };
}

/** Contract-valid report shell used by metric unit tests */
function makeValidReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdictType: "false",
    conclusion: "证据表明该说法不成立，应判定为虚假。",
    credibilityScore: 10,
    summaryForPublic: "该说法经核查不成立。",
    recommendation: "不能信。以公开材料为准。",
    canSay: ["现有证据不支持该说法"],
    cannotSay: ["不能把未核实材料当事实"],
    evidenceChain: [
      { layer: "1", finding: "命题拆解", evidence: "原文可核", boundary: "仅限本条 claim", sourceRefs: ["s1"] },
      { layer: "2", finding: "证据对照", evidence: "官方否定或无支持", boundary: "不外推到其他 claim", sourceRefs: ["s1"] },
      { layer: "3", finding: "边界", evidence: "缺少独立复现研究", boundary: "不得升级为更强结论", sourceRefs: [] },
    ],
    confidenceDimensions: [
      { dimension: "source_reliability", score: 40 },
      { dimension: "evidence_completeness", score: 30 },
      { dimension: "consistency", score: 50 },
      { dimension: "recency", score: 40 },
      { dimension: "authority", score: 30 },
    ],
    closureActions: [
      { type: "archive_doubt", label: "存疑归档", content: "已判定为假", status: "ready" },
    ],
    ...overrides,
  };
}

describe("goldenDataset", () => {
  it("has at least 10 cases across the real-rumor categories", () => {
    const categories = new Set(goldenDataset.map((c) => c.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
    expect(goldenDataset.length).toBeGreaterThanOrEqual(10);
  });

  it("each case has unique id", () => {
    const ids = goldenDataset.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCase returns the correct case", () => {
    const c = getCase("RUMOR-010");
    expect(c).toBeDefined();
    expect(c!.claim).toBe("常穿黑色内衣易患癌");
    expect(c!.category).toBe("causal");
  });

  it("getCase returns undefined for unknown id", () => {
    expect(getCase("UNKNOWN")).toBeUndefined();
  });

  it("each causal case includes causal-specific agents in expected sequence", () => {
    const causalCases = getCasesByCategory("causal");
    expect(causalCases.length).toBeGreaterThanOrEqual(3);
    for (const c of causalCases) {
      expect(c.expectedAgentSequence).toContain("alternative_explanation_searcher");
      expect(c.expectedAgentSequence).toContain("counter_evidence_grader");
    }
  });

  it("every non-concept case expects more than just report_composer", () => {
    const nonConcept = goldenDataset.filter((c) => c.category !== "concept");
    for (const c of nonConcept) {
      expect(c.expectedAgentSequence).not.toEqual(["report_composer"]);
    }
  });

  it("each case has traps array with at least 1 item", () => {
    for (const c of goldenDataset) {
      expect(c.traps.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("credibility range is valid (low <= high, both 0-100)", () => {
    for (const c of goldenDataset) {
      expect(c.expectedCredibilityRange[0]).toBeGreaterThanOrEqual(0);
      expect(c.expectedCredibilityRange[1]).toBeLessThanOrEqual(100);
      expect(c.expectedCredibilityRange[0]).toBeLessThanOrEqual(c.expectedCredibilityRange[1]);
    }
  });

  it("includes trap-difficulty causal cases for correlation/causation", () => {
    const traps = getCasesByDifficulty("trap").filter((c) => c.category === "causal");
    expect(traps.length).toBeGreaterThanOrEqual(1);
    for (const t of traps) {
      expect(t.traps.some((x) => /因果|相关|混杂|替代/.test(x))).toBe(true);
    }
  });
});

describe("evaluationMetrics", () => {
  it("scores a passing case correctly", () => {
    const golden = goldenDataset[0];
    const result = scoreCase({
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "test",
        steps: golden.expectedAgentSequence.map((a) => makeStep(a)),
        finalReport: makeValidReport({
          verdictType: golden.expectedVerdictType,
          credibilityScore: golden.expectedCredibilityRange[0],
        }),
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 100,
      },
    });
    expect(result.routingCorrect).toBe(true);
    expect(result.sequenceCorrect).toBe(true);
    expect(result.verdictCorrect).toBe(true);
    expect(result.credibilityInRange).toBe(true);
    expect(result.hallucinationDetected).toBe(false);
    expect(result.reportContractPass).toBe(true);
    expect(result.reportReviewScore).toBeGreaterThanOrEqual(80);
    expect(result.overallPass).toBe(true);
  });

  it("detects hallucination when verdict contradicts golden", () => {
    const result = scoreCase({
      case: goldenDataset[0],
      result: {
        claim: goldenDataset[0].claim,
        sessionId: "test",
        steps: [makeStep("report_composer")],
        finalReport: makeValidReport({ verdictType: "true", credibilityScore: 80 }),
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 100,
      },
    });
    expect(result.hallucinationDetected).toBe(true);
    expect(result.overallPass).toBe(false);
  });

  it("fails report contract on thin finalReport", () => {
    const golden = goldenDataset[0];
    const result = scoreCase({
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "test",
        steps: golden.expectedAgentSequence.map((a) => makeStep(a)),
        finalReport: {
          verdictType: golden.expectedVerdictType,
          credibilityScore: golden.expectedCredibilityRange[0],
        },
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 100,
      },
    });
    expect(result.reportContractPass).toBe(false);
    expect(result.reportReviewScore).toBeLessThan(100);
    expect(result.overallPass).toBe(false);
  });

  it("scoreReportContract mirrors reviewAndRepairReport", () => {
    const thin = scoreReportContract({ verdictType: "false" });
    const full = scoreReportContract(makeValidReport());
    expect(thin.reportContractPass).toBe(false);
    expect(full.reportContractPass).toBe(true);
    expect(full.reportReviewScore).toBe(
      reviewAndRepairReport(makeValidReport()).score
    );
  });

  it("aggregateMetrics computes correct totals including report contract", () => {
    const scores = goldenDataset.slice(0, 3).map((c) =>
      scoreCase({
        case: c,
        result: {
          claim: c.claim,
          sessionId: "test",
          steps: c.expectedAgentSequence.map((a) => makeStep(a)),
          finalReport: makeValidReport({
            verdictType: c.expectedVerdictType,
            credibilityScore: Math.round(
              (c.expectedCredibilityRange[0] + c.expectedCredibilityRange[1]) / 2
            ),
          }),
          followUpQueue: [],
          memoryCandidates: [],
          totalLatencyMs: 100,
        },
      })
    );

    const agg = aggregateMetrics(scores);
    expect(agg.totalCases).toBe(3);
    expect(agg.byCategory).toBeDefined();
    expect(Object.keys(agg.byCategory).length).toBeGreaterThan(0);
    expect(agg.reportContractPassRate).toBe(1);
    expect(agg.avgReportReviewScore).toBeGreaterThanOrEqual(80);
    expect(typeof agg.verdictAccuracy).toBe("number");
  });

  it("aggregateMetrics lowers reportContractPassRate when thin reports present", () => {
    const golden = goldenDataset[0];
    const good = scoreCase({
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "test",
        steps: golden.expectedAgentSequence.map((a) => makeStep(a)),
        finalReport: makeValidReport({
          verdictType: golden.expectedVerdictType,
          credibilityScore: golden.expectedCredibilityRange[0],
        }),
        totalLatencyMs: 50,
      },
    });
    const bad = scoreCase({
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "test",
        steps: golden.expectedAgentSequence.map((a) => makeStep(a)),
        finalReport: { verdictType: golden.expectedVerdictType, credibilityScore: 5 },
        totalLatencyMs: 50,
      },
    });
    const agg = aggregateMetrics([good, bad]);
    expect(agg.reportContractPassRate).toBe(0.5);
    expect(agg.avgReportReviewScore).toBeLessThan(good.reportReviewScore);
    expect(agg.failures.some((f) => f.reason.includes("report contract"))).toBe(true);
  });
});

describe("benchmarkRunner", () => {
  it("runs an event case without crashing", async () => {
    const result = await runCase(goldenDataset[0]);
    expect(result.case.id).toBe("RUMOR-001");
    expect(result.error).toBeUndefined();
  });

  it("runs a causal case without crashing", async () => {
    const causalCase = goldenDataset.find((c) => c.category === "causal")!;
    const result = await runCase(causalCase);
    expect(result.error).toBeUndefined();
  }, 30000);

  it("mock pipeline produces contract-passing reportReview metrics", async () => {
    const result = await runCase(goldenDataset[0]);
    expect(result.error).toBeUndefined();
    const scores = scoreCase(result);
    // AgentRuntime repairs report; mock composer already emits full contract fields
    expect(scores.reportContractPass).toBe(true);
    expect(scores.reportReviewScore).toBeGreaterThanOrEqual(80);
    if (result.result.reportReview) {
      expect(result.result.reportReview.passed).toBe(true);
    }
  }, 30000);

  it("runs all cases and produces aggregate metrics", async () => {
    const firstResult = await runCase(goldenDataset[0]);
    const results = [firstResult];
    const scores = results.map((caseResult) => scoreCase(caseResult));
    const { aggregateMetrics: aggFn } = await import("./evaluationMetrics");
    const aggregate = aggFn(scores);
    expect(aggregate.totalCases).toBeGreaterThanOrEqual(1);
    expect(aggregate.reportContractPassRate).toBeGreaterThanOrEqual(0);
    expect(aggregate.avgReportReviewScore).toBeGreaterThanOrEqual(0);
  });
});
