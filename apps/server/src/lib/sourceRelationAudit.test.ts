import { describe, expect, it } from "vitest";
import { applyClaimSourceRelationAudit, relationAuditCoversDirectionalSources } from "./sourceRelationAudit.js";

const key = (value: string) => value.trim();
const cnr = { url: "https://news.cnr.cn/native/gd/20230502/t20230502_526238031.shtml", title: "央广网", snippet: "…" };

describe("claim-source relation audit", () => {
  it("does not publish FactChecker support when the audit says context-only", () => {
    const [row] = applyClaimSourceRelationAudit([
      { claimAtom: "气泡水可以中和酸", verdict: "partial", evidence: "理论上有作用[1]。", supportingSources: [cnr], contradictingSources: [], evidenceGaps: [] },
    ], [
      { claimAtom: "气泡水可以中和酸", url: cnr.url, relation: "context-only", reason: "讨论的是降尿酸，且正文明确实际作用有限" },
    ], key);
    expect(row.supportingSources).toEqual([]);
    expect(row.contradictingSources).toEqual([]);
    expect(row.verdict).toBe("unverified");
    expect(row.sourcesRelatedOnly).toBe(true);
    expect(row.evidence).not.toContain("[1]");
  });

  it("moves a source to the audited direction instead of trusting the original bucket", () => {
    const [row] = applyClaimSourceRelationAudit([
      { claimAtom: "喝气泡水可以降尿酸", verdict: "false", evidence: "原文不支持治疗作用[1]。", supportingSources: [cnr], contradictingSources: [], evidenceGaps: [] },
    ], [
      { claimAtom: "喝气泡水可以降尿酸", url: cnr.url, relation: "contradict", reason: "正文结论明确否定治疗作用" },
    ], key);
    expect(row.supportingSources).toEqual([]);
    expect(row.contradictingSources).toEqual([cnr]);
    expect(row.verdict).toBe("false");
  });

  it("treats the same URL independently for different claims", () => {
    const rows = applyClaimSourceRelationAudit([
      { claimAtom: "碳酸氢根具有一定中和尿酸作用", verdict: "true", evidence: "[1]", supportingSources: [cnr], contradictingSources: [], evidenceGaps: [] },
      { claimAtom: "喝气泡水可以治疗高尿酸", verdict: "false", evidence: "[1]", supportingSources: [cnr], contradictingSources: [], evidenceGaps: [] },
    ], [
      { claimAtom: "碳酸氢根具有一定中和尿酸作用", url: cnr.url, relation: "support", reason: "原文明确给出该有限机制" },
      { claimAtom: "喝气泡水可以治疗高尿酸", url: cnr.url, relation: "contradict", reason: "原文明确说实现不了治疗作用" },
    ], key);
    expect(rows[0].supportingSources).toHaveLength(1);
    expect(rows[1].contradictingSources).toHaveLength(1);
  });

  it("fails closed when a directional source has no audit", () => {
    const verdicts = [{ claimAtom: "A", verdict: "true", evidence: "A[1]", supportingSources: [cnr], contradictingSources: [], evidenceGaps: [] }];
    expect(relationAuditCoversDirectionalSources(verdicts, [], key)).toBe(false);
    expect(applyClaimSourceRelationAudit(verdicts, [], key)[0].verdict).toBe("unverified");
  });
});
