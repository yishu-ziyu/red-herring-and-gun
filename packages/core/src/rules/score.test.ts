import { describe, expect, it } from "vitest";
import type { Claim, ClaimVerdict, Evidence, Stance, Tier } from "../casefile/schema.js";
import { score } from "./score.js";

const AT = "2026-09-03T08:00:00.000Z";

function claim(id: string): Claim {
  return { id, text: id, type: "fact", checkable: true, order: 0 };
}

function evidence(id: string, tier: Tier, clusterId?: string): Evidence {
  return {
    id,
    url: `https://${id}.example.com/${id}`,
    canonicalUrl: `https://${id}.example.com/${id}`,
    host: `${id}.example.com`,
    excerpt: "摘要",
    retrievedAt: AT,
    tier,
    provenance: { kind: "user" },
    ...(clusterId !== undefined ? { clusterId } : {}),
  };
}

function stance(id: string, claimId: string, evidenceId: string): Stance {
  return {
    id,
    claimId,
    evidenceId,
    stance: "supports",
    quote: "摘要",
    confidence: 0.9,
    quoteFidelity: true,
    by: "main",
  };
}

function verdict(claimId: string, basis: string[], kind: ClaimVerdict["verdict"] = "true"): ClaimVerdict {
  return { claimId, verdict: kind, basis, rule: kind, updatedAt: AT };
}

function sum(breakdown: { value: number }[]): number {
  return breakdown.reduce((acc, row) => acc + row.value, 0);
}

describe("score", () => {
  it("breakdown 各项之和等于 score", () => {
    const result = score({
      claims: [claim("c1"), claim("c2")],
      verdicts: [verdict("c1", ["s1"]), verdict("c2", [], "unverified")],
      stances: [stance("s1", "c1", "e1")],
      evidence: [evidence("e1", "A")],
      contested: false,
    });
    expect(sum(result.breakdown)).toBe(result.score);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("同样输入多一条 A 级 basis 分数不降", () => {
    const claims = [claim("c1")];
    const e1 = evidence("e1", "C", "k1");
    const s1 = stance("s1", "c1", "e1");
    const before = score({
      claims,
      verdicts: [verdict("c1", ["s1"], "unverified")],
      stances: [s1],
      evidence: [e1],
      contested: false,
    });
    const e2 = evidence("e2", "A", "k2");
    const s2 = stance("s2", "c1", "e2");
    const after = score({
      claims,
      verdicts: [verdict("c1", ["s1", "s2"], "unverified")],
      stances: [s1, s2],
      evidence: [e1, e2],
      contested: false,
    });
    expect(sum(after.breakdown)).toBe(after.score);
    expect(after.score).toBeGreaterThanOrEqual(before.score);
  });

  it("contested 扣分后之和仍等于 score", () => {
    const result = score({
      claims: [claim("c1")],
      verdicts: [verdict("c1", ["s1"], "contested")],
      stances: [stance("s1", "c1", "e1")],
      evidence: [evidence("e1", "A")],
      contested: true,
    });
    expect(sum(result.breakdown)).toBe(result.score);
    expect(result.breakdown.some((row) => row.key === "contested" && row.value < 0)).toBe(true);
  });
});
