import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import type { Claim, ClaimVerdict, Evidence, Stance } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext, type StageContext } from "./context.js";
import { COMPOSE_JOB, runCompose } from "./compose.js";

const AT = "2026-09-03T08:00:00.000Z";
const ORIGINAL = "人社部发文说生育津贴直接打到个人卡里了";
const EXCERPT_LEAK = "EXCERPT_LEAK_TOKEN_7f3a_should_not_enter_prompt";
const URL_LEAK = "https://leak.example/secret-page";

function ev(id: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id,
    url: `https://${id}.example.com/${id}`,
    canonicalUrl: `https://${id}.example.com/${id}`,
    host: `${id}.example.com`,
    title: `${id} 标题`,
    excerpt: "普通摘要",
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "search", query: "津贴" },
    ...overrides,
  };
}

function st(id: string, claimId: string, evidenceId: string, quote: string): Stance {
  return {
    id,
    claimId,
    evidenceId,
    stance: "refutes",
    quote,
    confidence: 0.9,
    quoteFidelity: true,
    by: "main",
  };
}

function claim(id: string, text: string, order: number): Claim {
  return { id, text, type: "fact", checkable: true, order };
}

function seed(opts: {
  llm: ReturnType<typeof createFakeLlm>;
  claims: Claim[];
  evidence: Evidence[];
  stances: Stance[];
  verdicts: ClaimVerdict[];
}): StageContext {
  const { case: c } = createCase({ id: "case1", text: ORIGINAL, at: AT });
  const ctx = createStageContext({ case: c, llm: opts.llm, now: () => AT });
  ctx.emit({ type: "claims.added", claims: opts.claims });
  for (const item of opts.evidence) ctx.emit({ type: "evidence.added", evidence: item });
  for (const item of opts.stances) ctx.emit({ type: "stance.added", stance: item });
  for (const item of opts.verdicts) ctx.emit({ type: "verdict.updated", verdict: item });
  ctx.emit({
    type: "frontier.added",
    pivots: [
      {
        id: "p1",
        kind: "link",
        value: "https://www.gov.cn/follow",
        why: "官网外链",
        expectedValue: 3,
        depth: 1,
      },
    ],
  });
  return ctx;
}

function twoClaimCtx(llm: ReturnType<typeof createFakeLlm>): StageContext {
  return seed({
    llm,
    claims: [
      claim("c1", "生育津贴直接打到个人卡", 0),
      claim("c2", "人社部发过这份文", 1),
    ],
    evidence: [
      ev("e1", { url: URL_LEAK, canonicalUrl: URL_LEAK, excerpt: EXCERPT_LEAK, host: "www.gov.cn", title: "人社部通报" }),
      ev("e2", { host: "www.mohrss.gov.cn", title: "申领办法" }),
    ],
    stances: [
      st("s1", "c1", "e1", "津贴由单位申领，不直接发放到个人账户"),
      st("s2", "c1", "e2", "单位按规定申请拨付"),
    ],
    verdicts: [
      {
        claimId: "c1",
        verdict: "false",
        basis: ["s2", "s1"],
        rule: "false",
        tally: { sup: 0, ref: 6, par: 0 },
        updatedAt: AT,
      },
      {
        claimId: "c2",
        verdict: "unverified",
        basis: [],
        rule: "no-evidence",
        updatedAt: AT,
      },
    ],
  });
}

function userPayload(fake: ReturnType<typeof createFakeLlm>): {
  原句: string;
  命题: Array<{
    claimId: string;
    text: string;
    verdict: string;
    rule: string;
    tally?: { sup: number; ref: number; par: number };
    citations: Array<{ n: number; host: string; quote: string; title?: string }>;
  }>;
  frontier: { unconsumed: number; byKind: Array<{ kind: string; count: number }> };
} {
  const raw = fake.calls[0]?.userContent;
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string);
}

const okDraft = {
  conclusion: "生育津贴不会直接打到个人卡里，仍由单位申领。[1]",
  claimItems: [{ claimId: "c1", line: "生育津贴直接打到个人卡：与现有依据相反。[1][2]" }],
};

describe("runCompose", () => {
  it("userContent 不含证据 excerpt 与 URL", async () => {
    const fake = createFakeLlm({ compose: okDraft });
    const ctx = twoClaimCtx(fake);
    await runCompose(ctx, {});
    expect(fake.calls).toHaveLength(1);
    const user = fake.calls[0]?.userContent ?? "";
    expect(user).not.toContain(EXCERPT_LEAK);
    expect(user).not.toContain(URL_LEAK);
    expect(user).not.toMatch(/https?:\/\//i);
    const payload = userPayload(fake);
    expect(payload.原句).toBe(ORIGINAL);
    expect(payload.命题[0]?.citations[0]).toEqual(
      expect.objectContaining({
        host: "www.mohrss.gov.cn",
        title: "申领办法",
        quote: "单位按规定申请拨付",
      }),
    );
    expect(payload.frontier.unconsumed).toBe(1);
    expect(JSON.stringify(payload.命题)).not.toContain("excerpt");
  });

  it("引用表按 basis 首次出现顺序编号，没有 basis 的命题无 [n]", async () => {
    const fake = createFakeLlm({ compose: okDraft });
    const ctx = twoClaimCtx(fake);
    await runCompose(ctx, {});
    const payload = userPayload(fake);
    expect(payload.命题.map((row) => row.claimId)).toEqual(["c1", "c2"]);
    expect(payload.命题[0]?.citations.map((row) => row.n)).toEqual([1, 2]);
    expect(payload.命题[0]?.citations.map((row) => row.host)).toEqual(["www.mohrss.gov.cn", "www.gov.cn"]);
    expect(payload.命题[0]?.tally).toEqual({ sup: 0, ref: 6, par: 0 });
    expect(payload.命题[1]?.citations).toEqual([]);
    expect(payload.命题[1]?.verdict).toBe("unverified");
  });

  it("工单不过 schema → draft: null", async () => {
    const fake = createFakeLlm({
      compose: {
        conclusion: "x",
        claimItems: [{ claimId: "c1", line: "y", citations: [1] }],
      },
    });
    const ctx = twoClaimCtx(fake);
    const result = await runCompose(ctx, {});
    expect(result.draft).toBeNull();
    const finished = ctx.emitted.filter((event) => event.type === "stage.finished");
    expect(finished).toEqual([expect.objectContaining({ stage: COMPOSE_JOB, outcome: "failed-open" })]);
  });

  it("工单抛错 → draft: null", async () => {
    const fake = createFakeLlm({ compose: new Error("boom") });
    const ctx = twoClaimCtx(fake);
    const result = await runCompose(ctx, {});
    expect(result.draft).toBeNull();
    expect(ctx.emitted.filter((event) => event.type === "stage.finished")).toEqual([
      expect.objectContaining({ stage: COMPOSE_JOB, outcome: "failed-open" }),
    ]);
  });

  it("system prompt 含 claimId 与不得改变", async () => {
    const fake = createFakeLlm({ compose: okDraft });
    const ctx = twoClaimCtx(fake);
    await runCompose(ctx, {});
    const prompt = fake.calls[0]?.systemPrompt ?? "";
    expect(prompt).toContain("claimId");
    expect(prompt).toContain("不得改变");
  });
});
