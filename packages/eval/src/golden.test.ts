import { describe, expect, it } from "vitest";
import { qualificationFingerprintOf } from "./gate.js";
import { goldenDataset, retiredFromExam } from "./golden.js";
import { qualificationOf } from "./score.js";

describe("exam golden set", () => {
  it("gives every scoring case exactly one qualification", () => {
    for (const row of goldenDataset) {
      expect(qualificationOf(row), row.id).not.toBe("unlabeled");
      expect(Boolean(row.expectsEnterCheck) !== Boolean(row.expectsEarlyStop), row.id).toBe(true);
    }
    const fingerprint = qualificationFingerprintOf(
      goldenDataset.map((row) => ({ id: row.id, qualification: qualificationOf(row) })),
    );
    expect(fingerprint.split(",").some((part) => part.endsWith(":unlabeled"))).toBe(false);
  });

  it("keeps retired placeholder claims out of the scoring set", () => {
    expect(retiredFromExam.map((row) => row.id).sort()).toEqual(["TINY-005", "TINY-006"]);
    const ids = new Set(goldenDataset.map((row) => row.id));
    expect(ids.has("TINY-005")).toBe(false);
    expect(ids.has("TINY-006")).toBe(false);
    expect(goldenDataset).toHaveLength(24);
    for (const row of retiredFromExam) {
      expect(row.reason.length).toBeGreaterThan(8);
    }
  });
});
