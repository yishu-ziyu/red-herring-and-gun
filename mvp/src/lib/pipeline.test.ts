import { describe, expect, it } from "vitest";
import { runDemoPipeline, assertRelevantCase, getDemoCase } from "./pipeline";
import { demoCase } from "../data/demoCase";

describe("assertRelevantCase", () => {
  it("returns true when input is highly similar to first subclaim", () => {
    expect(assertRelevantCase("AI 是否导致内容岗位减少", demoCase)).toBe(true);
  });

  it("returns false when input is unrelated to all subclaims", () => {
    expect(assertRelevantCase("今天出门要不要带伞和穿厚外套", demoCase)).toBe(false);
  });

  it("returns true for short input (<10 chars) to avoid false positives", () => {
    expect(assertRelevantCase("AI", demoCase)).toBe(true);
  });

  it("returns true for empty input (no false-positive)", () => {
    expect(assertRelevantCase("", demoCase)).toBe(true);
  });
});

describe("runDemoPipeline", () => {
  it("returns the demo case by default", () => {
    const result = runDemoPipeline("ai-content-jobs");
    expect(result.caseData).toBe(demoCase);
    expect(result.error).toBeUndefined();
  });

  it("returns NO_MATCHING_CASE error when claim is unrelated", () => {
    const result = runDemoPipeline("ai-content-jobs", { claim: "今天出门要不要带伞和穿厚外套" });
    expect(result.error).toBe("NO_MATCHING_CASE");
    expect(result.caseData).toBeNull();
  });

  it("returns the demo case when claim is relevant", () => {
    const result = runDemoPipeline("ai-content-jobs", {
      claim: "AI 是否导致内容岗位减少",
    });
    expect(result.error).toBeUndefined();
    expect(result.caseData).toBe(demoCase);
  });

  it("returns the demo case when no claim is provided (back-compat)", () => {
    const result = runDemoPipeline("ai-content-jobs");
    expect(result.error).toBeUndefined();
    expect(result.caseData).toBe(demoCase);
  });
});

describe("getDemoCase", () => {
  it("returns demoCase for 'ai-content-jobs'", () => {
    expect(getDemoCase("ai-content-jobs")).toBe(demoCase);
  });

  it("returns demoCase for unknown caseId (current fallback behaviour)", () => {
    expect(getDemoCase("nonsense-case-id")).toBe(demoCase);
  });
});