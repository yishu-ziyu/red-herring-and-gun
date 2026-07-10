import { describe, it, expect } from "vitest";
import { aggregateInferences } from "./inferenceLicense";
import type { GradedEvidence, Subclaim } from "./schemas";

function makeGrade(overrides: Partial<GradedEvidence>): GradedEvidence {
  return {
    candidateId: "c1",
    subclaimId: "s1",
    matchedEvidenceNeed: "task exposure",
    evidenceRole: "支持",
    usageLevel: "辅助证据",
    scores: {
      relevance: "中",
      traceability: "高",
      methodFit: "中",
      contextFit: "中",
      independence: "中",
    },
    inferenceAllowed: [],
    inferenceBlocked: [],
    limitations: [],
    evidenceGap: [],
    graderDecision: "ok",
    ...overrides,
  };
}

describe("aggregateInferences", () => {
  it("returns empty license when grades are empty", () => {
    const result = aggregateInferences([]);
    expect(result.allowed).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.coverage).toEqual({ withAllowed: 0, totalSubclaims: 0 });
    expect(result.source).toBe("graded_evidence");
  });

  it("aggregates allowed items across multiple grades with dedup", () => {
    const grades: GradedEvidence[] = [
      makeGrade({
        candidateId: "c1",
        inferenceAllowed: ["AI 影响写作任务结构", "短期内仍需人工核查"],
      }),
      makeGrade({
        candidateId: "c2",
        inferenceAllowed: ["AI 影响写作任务结构", "企业降本是替代解释之一"],
      }),
    ];
    const result = aggregateInferences(grades);
    expect(result.allowed.length).toBe(3);
    expect(result.allowed.map((a) => a.text)).toEqual([
      "AI 影响写作任务结构",
      "短期内仍需人工核查",
      "企业降本是替代解释之一",
    ]);
  });

  it("aggregates blocked items independently from allowed", () => {
    const grades: GradedEvidence[] = [
      makeGrade({
        inferenceAllowed: ["AI 可能影响任务结构"],
        inferenceBlocked: ["不能确认岗位已经减少"],
      }),
    ];
    const result = aggregateInferences(grades);
    expect(result.allowed.length).toBe(1);
    expect(result.blocked.length).toBe(1);
    expect(result.coverage.withAllowed).toBe(1);
  });

  it("confidence = low when any grade has more blocked than allowed", () => {
    const grades: GradedEvidence[] = [
      makeGrade({
        inferenceAllowed: ["x"],
        inferenceBlocked: ["y1", "y2", "y3"],
      }),
    ];
    const result = aggregateInferences(grades);
    expect(result.confidence).toBe("low");
  });

  it("confidence = high when ≥3 grades have allowed and 0 have blocked", () => {
    const grades: GradedEvidence[] = [
      makeGrade({ candidateId: "c1", inferenceAllowed: ["a1"] }),
      makeGrade({ candidateId: "c2", inferenceAllowed: ["a2"] }),
      makeGrade({ candidateId: "c3", inferenceAllowed: ["a3"] }),
    ];
    const result = aggregateInferences(grades);
    expect(result.confidence).toBe("high");
  });

  it("confidence = medium in default case", () => {
    const grades: GradedEvidence[] = [
      makeGrade({ candidateId: "c1", inferenceAllowed: ["a1"], inferenceBlocked: ["b1"] }),
    ];
    const result = aggregateInferences(grades);
    expect(result.confidence).toBe("medium");
  });

  it("caps allowed and blocked at 12 items each", () => {
    const manyAllowed = Array.from({ length: 20 }, (_, i) => `allowed-${i}`);
    const manyBlocked = Array.from({ length: 20 }, (_, i) => `blocked-${i}`);
    const grades: GradedEvidence[] = [
      makeGrade({ inferenceAllowed: manyAllowed, inferenceBlocked: manyBlocked }),
    ];
    const result = aggregateInferences(grades);
    expect(result.allowed.length).toBe(12);
    expect(result.blocked.length).toBe(12);
  });

  it("uses subclaims param for totalSubclaims coverage", () => {
    const grades: GradedEvidence[] = [
      makeGrade({ subclaimId: "s1", inferenceAllowed: ["a"] }),
    ];
    const subclaims: Subclaim[] = [
      { id: "s1", text: "sub1", type: "概念", roleInArgument: "r" },
      { id: "s2", text: "sub2", type: "概念", roleInArgument: "r" },
      { id: "s3", text: "sub3", type: "概念", roleInArgument: "r" },
    ];
    const result = aggregateInferences(grades, subclaims);
    expect(result.coverage.totalSubclaims).toBe(3);
    expect(result.coverage.withAllowed).toBe(1);
  });

  it("does not throw on malformed grade", () => {
    const grades = [
      makeGrade({ inferenceAllowed: undefined as unknown as string[] }),
      makeGrade({ inferenceBlocked: undefined as unknown as string[] }),
    ];
    expect(() => aggregateInferences(grades)).not.toThrow();
  });
});