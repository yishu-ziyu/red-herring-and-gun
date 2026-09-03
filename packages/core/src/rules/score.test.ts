import { describe, expect, it } from "vitest";
import type { Claim, ClaimVerdict, Evidence, Stance, Tier } from "../casefile/schema.js";
import { score } from "./score.js";

const AT = "2026-09-03T08:00:00.000Z";

function claim(id: string, order: number, checkable = true): Claim {
  return {
    id,
    text: id,
    type: checkable ? "fact" : "value",
    checkable,
    order,
  };
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

function verdict(
  claimId: string,
  kind: ClaimVerdict["verdict"],
  basis: string[] = [],
  tally?: ClaimVerdict["tally"],
): ClaimVerdict {
  return {
    claimId,
    verdict: kind,
    basis,
    rule: kind,
    updatedAt: AT,
    ...(tally !== undefined ? { tally } : {}),
  };
}

function sum(breakdown: { value: number }[]): number {
  return breakdown.reduce((acc, row) => acc + row.value, 0);
}

const falseA = {
  claims: [claim("c1", 0)],
  verdicts: [verdict("c1", "false", ["s1"])],
  stances: [stance("s1", "c1", "e1")],
  evidence: [evidence("e1", "A")],
  contested: false,
};

const trueTwoB = {
  claims: [claim("c1", 0)],
  verdicts: [verdict("c1", "true", ["s1", "s2"])],
  stances: [stance("s1", "c1", "e1"), stance("s2", "c1", "e2")],
  evidence: [evidence("e1", "B"), evidence("e2", "B")],
  contested: false,
};

const trueA = {
  claims: [claim("c1", 0)],
  verdicts: [verdict("c1", "true", ["s1"])],
  stances: [stance("s1", "c1", "e1")],
  evidence: [evidence("e1", "A")],
  contested: false,
};

describe("score", () => {
  it.each([
    {
      name: "单 false + A 级 1 簇",
      input: falseA,
      expected: 6,
    },
    {
      name: "单 true + 两独立 B 簇",
      input: trueTwoB,
      expected: 80,
    },
    {
      name: "单 true + A 级 1 簇",
      input: trueA,
      expected: 90,
    },
    {
      name: "true(A 1 簇) + false(A 1 簇)",
      input: {
        claims: [claim("c1", 0), claim("c2", 1)],
        verdicts: [verdict("c1", "true", ["s1"]), verdict("c2", "false", ["s2"])],
        stances: [stance("s1", "c1", "e1"), stance("s2", "c2", "e2")],
        evidence: [evidence("e1", "A"), evidence("e2", "A")],
        contested: false,
      },
      expected: 27,
    },
    {
      name: "单 unverified 无支持",
      input: {
        claims: [claim("c1", 0)],
        verdicts: [verdict("c1", "unverified")],
        stances: [],
        evidence: [],
        contested: false,
      },
      expected: 16,
    },
    {
      name: "单 unverified tally.sup > 0",
      input: {
        claims: [claim("c1", 0)],
        verdicts: [verdict("c1", "unverified", [], { sup: 2, ref: 0, par: 0 })],
        stances: [],
        evidence: [],
        contested: false,
      },
      expected: 30,
    },
    {
      name: "单 contested",
      input: {
        claims: [claim("c1", 0)],
        verdicts: [verdict("c1", "contested", ["s1"])],
        stances: [stance("s1", "c1", "e1")],
        evidence: [evidence("e1", "A")],
        contested: true,
      },
      expected: 40,
    },
    {
      name: "[checkable=false, false(A 1 簇)]",
      input: {
        claims: [claim("c1", 0, false), claim("c2", 1)],
        verdicts: [verdict("c1", "unverified"), verdict("c2", "false", ["s2"])],
        stances: [stance("s2", "c2", "e2")],
        evidence: [evidence("e2", "A")],
        contested: false,
      },
      expected: 6,
    },
    {
      name: "0 可核命题",
      input: {
        claims: [claim("c1", 0, false)],
        verdicts: [verdict("c1", "unverified")],
        stances: [],
        evidence: [],
        contested: false,
      },
      expected: 50,
    },
  ])("$name → $expected", ({ name, input, expected }) => {
    const result = score(input);
    expect(result.score).toBe(expected);
    expect(sum(result.breakdown)).toBe(result.score);
    if (name === "[checkable=false, false(A 1 簇)]") {
      expect(result.breakdown.some((row) => row.key === "claim:c1")).toBe(false);
      expect(result.breakdown.some((row) => row.key === "claim:c2")).toBe(true);
    }
    if (name === "0 可核命题") {
      expect(result.breakdown).toEqual([{ key: "none", label: "没有可核对的命题", value: 50 }]);
    }
  });
});
