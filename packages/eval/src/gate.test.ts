import { describe, expect, it } from "vitest";
import {
  compareGate,
  GATE_METRIC_NAMES,
  METRIC_SEMVER,
  parseBaseline,
  qualificationFingerprintOf,
  snapshotFromSummary,
  type GateSnapshot,
} from "./gate.js";

const four: GateSnapshot = {
  metricSemver: METRIC_SEMVER,
  caseIds: ["A", "B"],
  qualificationFingerprint: "A:enter_check,B:enter_check",
  verdictAccuracy: 0.8,
  credibilityAccuracy: 0.9,
  citationIntegrityErrorRate: 0.1,
  reportContractPassRate: 0.95,
};

describe("compareGate", () => {
  it("compares only the four gate metrics and ignores routingAccuracy", () => {
    expect(GATE_METRIC_NAMES).toEqual([
      "verdictAccuracy",
      "credibilityAccuracy",
      "citationIntegrityErrorRate",
      "reportContractPassRate",
    ]);
    expect(GATE_METRIC_NAMES).not.toContain("hallucinationRate");
    expect(METRIC_SEMVER.startsWith("5.")).toBe(true);
    const { passed, rows } = compareGate(four, four);
    expect(passed).toBe(true);
    expect(rows.map((row) => row.name)).toEqual([...GATE_METRIC_NAMES]);
    expect(rows.some((row) => (row.name as string) === "routingAccuracy")).toBe(false);
  });

  it("treats a rise in citationIntegrityErrorRate as a regression", () => {
    const { passed, rows } = compareGate(four, { ...four, citationIntegrityErrorRate: 0.13 });
    expect(passed).toBe(false);
    expect(rows.find((row) => row.name === "citationIntegrityErrorRate")?.ok).toBe(false);
  });

  it("allows a 0.02 regression on the boundary", () => {
    expect(compareGate(four, { ...four, verdictAccuracy: 0.78 }).passed).toBe(true);
    expect(compareGate(four, { ...four, citationIntegrityErrorRate: 0.12 }).passed).toBe(true);
  });

  it("fails when regression is 0.021", () => {
    expect(compareGate(four, { ...four, verdictAccuracy: 0.779 }).passed).toBe(false);
    expect(compareGate(four, { ...four, citationIntegrityErrorRate: 0.121 }).passed).toBe(false);
  });
});

describe("parseBaseline", () => {
  it("rejects a 3.0.0 snapshot that still names hallucinationRate", () => {
    expect(() =>
      parseBaseline({
        metricSemver: "3.0.0",
        caseIds: ["A"],
        qualificationFingerprint: "A:enter_check",
        verdictAccuracy: 0.8,
        credibilityAccuracy: 0.9,
        hallucinationRate: 0.1,
        reportContractPassRate: 0.95,
      }),
    ).toThrow(/citationIntegrityErrorRate/);
  });

  it("rejects comparing a 3.0.0 snapshot against the current metricSemver", () => {
    const { passed, rejectReason, rows } = compareGate(
      { ...four, metricSemver: "3.0.0" },
      four,
    );
    expect(passed).toBe(false);
    expect(rejectReason).toMatch(/metricSemver/);
    expect(rows).toEqual([]);
  });

  it("rejects a numeric-only baseline that has no metricSemver or caseIds", () => {
    expect(() =>
      parseBaseline({
        totalCases: 26,
        routingAccuracy: 1,
        verdictAccuracy: 0.69,
        credibilityAccuracy: 0.92,
        citationIntegrityErrorRate: 0.03,
        reportContractPassRate: 0.96,
      }),
    ).toThrow(/metricSemver|caseIds/);
  });

  it("rejects a snapshot that has caseIds but no qualification fingerprint", () => {
    expect(() =>
      parseBaseline({
        metricSemver: METRIC_SEMVER,
        caseIds: ["RUMOR-001", "RUMOR-002"],
        verdictAccuracy: 0.69,
        credibilityAccuracy: 0.92,
        citationIntegrityErrorRate: 0.03,
        reportContractPassRate: 0.96,
      }),
    ).toThrow(/qualificationFingerprint/);
  });

  it("reads a snapshot that declares metricSemver, caseIds, and qualification fingerprint", () => {
    expect(
      parseBaseline({
        metricSemver: METRIC_SEMVER,
        caseIds: ["RUMOR-001", "RUMOR-002"],
        qualificationFingerprint: "RUMOR-001:enter_check,RUMOR-002:early_stop",
        verdictAccuracy: 0.69,
        credibilityAccuracy: 0.92,
        citationIntegrityErrorRate: 0.03,
        reportContractPassRate: 0.96,
      }),
    ).toEqual({
      metricSemver: METRIC_SEMVER,
      caseIds: ["RUMOR-001", "RUMOR-002"],
      qualificationFingerprint: "RUMOR-001:enter_check,RUMOR-002:early_stop",
      verdictAccuracy: 0.69,
      credibilityAccuracy: 0.92,
      citationIntegrityErrorRate: 0.03,
      reportContractPassRate: 0.96,
    });
  });

  it("reads the new run JSON summary wrapper when version, caseIds, and fingerprint are present", () => {
    expect(
      parseBaseline({
        runId: "eval-1",
        metricSemver: METRIC_SEMVER,
        caseIds: ["RUMOR-001"],
        qualificationFingerprint: "RUMOR-001:enter_check",
        summary: {
          routingAccuracy: 0.2,
          verdictAccuracy: 0.5,
          credibilityAccuracy: 0.6,
          citationIntegrityErrorRate: 0.1,
          reportContractPassRate: 0.8,
          groundingRate: 0.4,
        },
      }),
    ).toEqual({
      metricSemver: METRIC_SEMVER,
      caseIds: ["RUMOR-001"],
      qualificationFingerprint: "RUMOR-001:enter_check",
      verdictAccuracy: 0.5,
      credibilityAccuracy: 0.6,
      citationIntegrityErrorRate: 0.1,
      reportContractPassRate: 0.8,
    });
  });
});

describe("compareGate identity", () => {
  it("rejects metricSemver mismatch without comparing numbers", () => {
    const { passed, rejectReason, rows } = compareGate(four, { ...four, metricSemver: "other" });
    expect(passed).toBe(false);
    expect(rejectReason).toMatch(/metricSemver/);
    expect(rows).toEqual([]);
  });

  it("rejects case set mismatch", () => {
    const { passed, rejectReason, rows } = compareGate(four, { ...four, caseIds: ["A"] });
    expect(passed).toBe(false);
    expect(rejectReason).toMatch(/case/);
    expect(rows).toEqual([]);
  });

  it("rejects matching caseIds with a different qualification fingerprint", () => {
    const { passed, rejectReason, rows } = compareGate(four, {
      ...four,
      qualificationFingerprint: "A:unlabeled,B:enter_check",
    });
    expect(passed).toBe(false);
    expect(rejectReason).toMatch(/qualification/);
    expect(rows).toEqual([]);
  });

  it("rejects unlabeled qualification even when fingerprints match", () => {
    const unlabeled: GateSnapshot = {
      ...four,
      qualificationFingerprint: "A:unlabeled,B:unlabeled",
    };
    const { passed, rejectReason, rows } = compareGate(unlabeled, unlabeled);
    expect(passed).toBe(false);
    expect(rejectReason).toMatch(/unlabeled/);
    expect(rows).toEqual([]);
  });
});

describe("old pipeline scorecard", () => {
  it("rejects a numeric-only apps/server eval dump that has no metricSemver", () => {
    expect(() =>
      parseBaseline({
        totalCases: 26,
        routingAccuracy: 1,
        verdictAccuracy: 0.69,
        credibilityAccuracy: 0.92,
        hallucinationRate: 0.03,
        reportContractPassRate: 0.96,
      }),
    ).toThrow(/metricSemver/);
  });
});

describe("packages/eval/baseline.json", () => {
  it("parses the recorded live scorecard with no unlabeled cases", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const path = join(dirname(fileURLToPath(import.meta.url)), "../baseline.json");
    const parsed = parseBaseline(JSON.parse(readFileSync(path, "utf8")));
    expect(parsed.metricSemver).toBe(METRIC_SEMVER);
    expect(parsed.caseIds).toHaveLength(24);
    expect(parsed.qualificationFingerprint.split(",").some((part) => part.endsWith(":unlabeled"))).toBe(false);
    expect(typeof parsed.verdictAccuracy).toBe("number");
    expect(typeof parsed.citationIntegrityErrorRate).toBe("number");
    const { passed, rows } = compareGate(parsed, parsed);
    expect(passed).toBe(true);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.delta === 0)).toBe(true);
  });
});

describe("snapshotFromSummary", () => {
  it("stamps metricSemver, caseIds, and qualification fingerprint onto the four gate numbers", () => {
    expect(
      snapshotFromSummary(
        {
          verdictAccuracy: 0.5,
          credibilityAccuracy: 0.6,
          citationIntegrityErrorRate: 0.1,
          reportContractPassRate: 0.8,
          routingAccuracy: null,
          groundingRate: null,
          quoteFidelity: null,
          provenanceDepth: null,
          latencyP50: null,
          latencyP95: null,
          entryAccuracy: 1,
        },
        [
          { id: "B", qualification: "enter_check" },
          { id: "A", qualification: "early_stop" },
          { id: "B", qualification: "enter_check" },
        ],
      ),
    ).toEqual({
      metricSemver: METRIC_SEMVER,
      caseIds: ["B", "A"],
      qualificationFingerprint: qualificationFingerprintOf([
        { id: "A", qualification: "early_stop" },
        { id: "B", qualification: "enter_check" },
      ]),
      verdictAccuracy: 0.5,
      credibilityAccuracy: 0.6,
      citationIntegrityErrorRate: 0.1,
      reportContractPassRate: 0.8,
    });
  });
});
