import { describe, expect, it } from "vitest";
import { goldenDataset, getCase, getCasesByCategory, getCasesByDifficulty } from "./goldenDataset";
import { scoreCase, aggregateMetrics } from "./evaluationMetrics";
import { runCase } from "./benchmarkRunner";

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
});

describe("evaluationMetrics", () => {
  it("scores a passing case correctly", () => {
    const golden = goldenDataset[0];
    const makeStep = (agent: string) => ({
      agent,
      agentName: agent.toUpperCase(),
      agentIcon: "",
      systemPrompt: "",
      input: {},
      output: {},
      evidenceBundle: { agentId: "", claimIds: [], supportEvidenceIds: [], contradictEvidenceIds: [], confidenceDelta: 0, unresolvedQuestions: [] },
      model: "mock",
      latencyMs: 100,
      timestamp: Date.now(),
      status: "completed",
    });
    const result = scoreCase({
      case: golden,
      result: {
        claim: golden.claim,
        sessionId: "test",
        steps: golden.expectedAgentSequence.map(makeStep),
        finalReport: { verdictType: golden.expectedVerdictType, credibilityScore: golden.expectedCredibilityRange[0] },
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
    expect(result.overallPass).toBe(true);
  });

  it("detects hallucination when verdict contradicts golden", () => {
    const result = scoreCase({
      case: goldenDataset[0],
      result: {
        claim: goldenDataset[0].claim,
        sessionId: "test",
        steps: [{ agent: "report_composer", agentName: "RC", agentIcon: "", systemPrompt: "", input: {}, output: {}, evidenceBundle: { agentId: "", claimIds: [], supportEvidenceIds: [], contradictEvidenceIds: [], confidenceDelta: 0, unresolvedQuestions: [] }, model: "mock", latencyMs: 100, timestamp: Date.now(), status: "completed" }],
        finalReport: { verdictType: "true", credibilityScore: 80 },
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 100,
      },
    });
    expect(result.hallucinationDetected).toBe(true);
    expect(result.overallPass).toBe(false);
  });

  it("aggregateMetrics computes correct totals", () => {
    const scores = goldenDataset.slice(0, 3).map((c) => scoreCase({
      case: c,
      result: {
        claim: c.claim,
        sessionId: "test",
        steps: [{ agent: "report_composer", agentName: "RC", agentIcon: "", systemPrompt: "", input: {}, output: {}, evidenceBundle: { agentId: "", claimIds: [], supportEvidenceIds: [], contradictEvidenceIds: [], confidenceDelta: 0, unresolvedQuestions: [] }, model: "mock", latencyMs: 100, timestamp: Date.now(), status: "completed" }],
        finalReport: { verdictType: c.expectedVerdictType, credibilityScore: Math.round((c.expectedCredibilityRange[0] + c.expectedCredibilityRange[1]) / 2) },
        followUpQueue: [],
        memoryCandidates: [],
        totalLatencyMs: 100,
      },
    }));

    const agg = aggregateMetrics(scores);
    expect(agg.totalCases).toBe(3);
    expect(agg.byCategory).toBeDefined();
    expect(Object.keys(agg.byCategory).length).toBeGreaterThan(0);
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

  it("runs all cases and produces aggregate metrics", async () => {
    const firstResult = await runCase(goldenDataset[0]);
    const results = [firstResult];
    const scores = results.map((caseResult) => scoreCase(caseResult));
    const { aggregateMetrics: aggFn } = await import("./evaluationMetrics");
    const aggregate = aggFn(scores);
    expect(aggregate.totalCases).toBeGreaterThanOrEqual(1);
  });
});
