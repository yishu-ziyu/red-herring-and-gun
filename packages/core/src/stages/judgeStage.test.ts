import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase } from "../casefile/reduce.js";
import type { Evidence, Stance } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { runJudge } from "./judgeStage.js";

const AT = "2026-09-03T08:00:00.000Z";

function ev(id: string, tier: Evidence["tier"]): Evidence {
  return {
    id,
    url: `https://${id}.example.com/${id}`,
    canonicalUrl: `https://${id}.example.com/${id}`,
    host: `${id}.example.com`,
    excerpt: "官方确认属实",
    retrievedAt: AT,
    tier,
    provenance: { kind: "search", query: "确认" },
  };
}

function st(id: string, evidenceId: string): Stance {
  return {
    id,
    claimId: "c1",
    evidenceId,
    stance: "supports",
    quote: "官方确认属实",
    confidence: 0.9,
    quoteFidelity: true,
    by: "main",
  };
}

function seedTrueCase() {
  const { case: c } = createCase({ id: "case1", text: "原句", at: AT });
  let n = 0;
  const ctx = createStageContext({
    case: c,
    llm: createFakeLlm({}),
    now: () => new Date(Date.UTC(2026, 8, 3, 8, 0, n++)).toISOString(),
  });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: "原句", type: "fact", checkable: true, order: 0 }],
  });
  ctx.emit({ type: "evidence.added", evidence: ev("e1", "B") });
  ctx.emit({ type: "evidence.added", evidence: ev("e2", "B") });
  ctx.emit({ type: "stance.added", stance: st("s1", "e1") });
  ctx.emit({ type: "stance.added", stance: st("s2", "e2") });
  return ctx;
}

describe("runJudge", () => {
  it("产出的 Case 过 assertInvariants，且判决无变化不重发 verdict.updated", async () => {
    const ctx = seedTrueCase();
    await runJudge(ctx, {});
    assertInvariants(ctx.current);
    const first = ctx.emitted.filter((event) => event.type === "verdict.updated");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      verdict: { claimId: "c1", verdict: "true", rule: "true" },
    });
    expect(ctx.current.overall).toBeDefined();
    expect(ctx.current.overall?.breakdown.reduce((sum, row) => sum + row.value, 0)).toBe(
      ctx.current.overall?.score,
    );

    await runJudge(ctx, {});
    assertInvariants(ctx.current);
    const second = ctx.emitted.filter((event) => event.type === "verdict.updated");
    expect(second).toHaveLength(1);
    const overalls = ctx.emitted.filter((event) => event.type === "overall.updated");
    expect(overalls.length).toBe(2);
  });

  it("立场型命题不进 judge，A 级反驳后整句为 false 且分数 ≤ 10", async () => {
    const { case: c } = createCase({ id: "case1", text: "转基因食品就是毒药，这届专家全被收买了", at: AT });
    const seeded = createStageContext({
      case: c,
      llm: createFakeLlm({}),
      now: () => AT,
    });
    seeded.emit({
      type: "claims.added",
      claims: [
        { id: "c1", text: "这届专家全被收买了", type: "value", checkable: false, order: 0 },
        { id: "c2", text: "转基因食品就是毒药", type: "fact", checkable: true, order: 1 },
      ],
    });
    seeded.emit({
      type: "verdict.updated",
      verdict: { claimId: "c1", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
    });
    const ctx = createStageContext({
      case: seeded.current,
      llm: createFakeLlm({}),
      now: () => AT,
    });
    ctx.emit({ type: "evidence.added", evidence: ev("e1", "A") });
    ctx.emit({
      type: "stance.added",
      stance: {
        id: "s1",
        claimId: "c2",
        evidenceId: "e1",
        stance: "refutes",
        quote: "官方确认属实",
        confidence: 0.9,
        quoteFidelity: true,
        by: "main",
      },
    });
    await runJudge(ctx, {});
    const updates = ctx.emitted.filter((event) => event.type === "verdict.updated");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      verdict: { claimId: "c2", verdict: "false" },
    });
    expect(ctx.current.overall?.verdictType).toBe("false");
    expect(ctx.current.overall?.score).toBeLessThanOrEqual(10);
  });
});
