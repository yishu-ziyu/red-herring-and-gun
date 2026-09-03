import { describe, expect, it } from "vitest";
import { compareGate, GATE_METRIC_NAMES, parseBaseline, type GateSnapshot } from "./gate.js";

const four: GateSnapshot = {
  verdictAccuracy: 0.8,
  credibilityAccuracy: 0.9,
  hallucinationRate: 0.1,
  reportContractPassRate: 0.95,
};

describe("compareGate", () => {
  it("compares only the four gate metrics and ignores routingAccuracy", () => {
    expect(GATE_METRIC_NAMES).toEqual([
      "verdictAccuracy",
      "credibilityAccuracy",
      "hallucinationRate",
      "reportContractPassRate",
    ]);
    const { passed, rows } = compareGate(four, four);
    expect(passed).toBe(true);
    expect(rows.map((row) => row.name)).toEqual([...GATE_METRIC_NAMES]);
    expect(rows.some((row) => (row.name as string) === "routingAccuracy")).toBe(false);
  });

  it("treats a rise in hallucinationRate as a regression", () => {
    const { passed, rows } = compareGate(four, { ...four, hallucinationRate: 0.13 });
    expect(passed).toBe(false);
    expect(rows.find((row) => row.name === "hallucinationRate")?.ok).toBe(false);
  });

  it("allows a 0.02 regression on the boundary", () => {
    expect(compareGate(four, { ...four, verdictAccuracy: 0.78 }).passed).toBe(true);
    expect(compareGate(four, { ...four, hallucinationRate: 0.12 }).passed).toBe(true);
  });

  it("fails when regression is 0.021", () => {
    expect(compareGate(four, { ...four, verdictAccuracy: 0.779 }).passed).toBe(false);
    expect(compareGate(four, { ...four, hallucinationRate: 0.121 }).passed).toBe(false);
  });
});

describe("parseBaseline", () => {
  it("reads the old mvp baseline shape at the top level", () => {
    expect(
      parseBaseline({
        totalCases: 26,
        routingAccuracy: 1,
        verdictAccuracy: 0.69,
        credibilityAccuracy: 0.92,
        hallucinationRate: 0.03,
        reportContractPassRate: 0.96,
      }),
    ).toEqual({
      verdictAccuracy: 0.69,
      credibilityAccuracy: 0.92,
      hallucinationRate: 0.03,
      reportContractPassRate: 0.96,
    });
  });

  it("reads the new run JSON summary wrapper", () => {
    expect(
      parseBaseline({
        runId: "eval-1",
        summary: {
          routingAccuracy: 0.2,
          verdictAccuracy: 0.5,
          credibilityAccuracy: 0.6,
          hallucinationRate: 0.1,
          reportContractPassRate: 0.8,
          groundingRate: 0.4,
        },
      }),
    ).toEqual({
      verdictAccuracy: 0.5,
      credibilityAccuracy: 0.6,
      hallucinationRate: 0.1,
      reportContractPassRate: 0.8,
    });
  });
});
