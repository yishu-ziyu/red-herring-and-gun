import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import type { Evidence } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { ASSESS_SYSTEM_PROMPT, runAssess } from "./assess.js";

const AT = "2026-09-03T08:00:00.000Z";

function seedClaimAndEvidence(evidence: Evidence[]) {
  const { case: c } = createCase({ id: "case1", text: "津贴直接打卡", at: AT });
  const ctx = createStageContext({
    case: c,
    llm: createFakeLlm({}),
    now: () => AT,
  });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: "生育津贴直接打到个人卡", type: "fact", checkable: true, order: 0 }],
  });
  for (const item of evidence) ctx.emit({ type: "evidence.added", evidence: item });
  return ctx;
}

function officialEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    url: "https://www.gov.cn/a",
    canonicalUrl: "https://www.gov.cn/a",
    host: "www.gov.cn",
    title: "人社部通报",
    excerpt: "官方通报此事不实",
    text: "官方 通报：此事不实。",
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "user" },
    ...overrides,
  };
}

describe("runAssess", () => {
  it("引文不在原文 → confidence 0 且 quoteFidelity false", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({
      assess: {
        stances: [
          {
            evidenceId: "e1",
            stance: "refutes",
            quote: "这段话原文里根本没有",
            confidence: 0.9,
          },
        ],
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(ctx.current.stances).toHaveLength(1);
    expect(ctx.current.stances[0]?.confidence).toBe(0);
    expect(ctx.current.stances[0]?.quoteFidelity).toBe(false);
    expect(ctx.current.stances[0]?.id).toBe("s1");
    expect(ctx.current.stances[0]?.by).toBe("main");
  });

  it("引文只差空白/标点 → 保留 confidence 与 quoteFidelity", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({
      assess: {
        stances: [
          {
            evidenceId: "e1",
            stance: "refutes",
            quote: "官方通报:此事不实",
            confidence: 0.88,
          },
        ],
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(ctx.current.stances).toHaveLength(1);
    expect(ctx.current.stances[0]?.quoteFidelity).toBe(true);
    expect(ctx.current.stances[0]?.confidence).toBe(0.88);
    expect(ctx.current.stances[0]?.quote).toBe("官方通报:此事不实");
  });

  it("evidenceId 不在集合内 → 丢弃", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({
      assess: {
        stances: [
          { evidenceId: "e999", stance: "supports", quote: "官方通报此事不实", confidence: 0.9 },
          { evidenceId: "e1", stance: "refutes", quote: "官方通报此事不实", confidence: 0.9 },
        ],
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(ctx.current.stances.map((item) => item.evidenceId)).toEqual(["e1"]);
  });

  it("schema 不过 → failed-open 且无 stance", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({ assess: { nope: true } });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runAssess(ctx, {});
    expect(result.assessed).toEqual(["c1"]);
    expect(ctx.current.stances).toEqual([]);
    const finished = ctx.emitted.filter((event) => event.type === "stage.finished");
    expect(finished).toEqual([
      expect.objectContaining({ stage: "assess", claimId: "c1", outcome: "failed-open" }),
    ]);
  });

  it("工单抛错 → failed-open 且无 stance", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({ assess: new Error("boom") });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(ctx.current.stances).toEqual([]);
    expect(
      ctx.emitted.some(
        (event) =>
          event.type === "stage.finished" && event.outcome === "failed-open" && event.claimId === "c1",
      ),
    ).toBe(true);
  });

  it("不可达证据不进工单，引用它会被丢弃", async () => {
    const seeded = seedClaimAndEvidence([
      officialEvidence(),
      officialEvidence({
        id: "e2",
        url: "https://blog.example.com/x",
        canonicalUrl: "https://blog.example.com/x",
        host: "blog.example.com",
        reachable: false,
        excerpt: "转载不实",
        text: "转载不实",
      }),
    ]);
    const fake = createFakeLlm({
      assess: {
        stances: [{ evidenceId: "e2", stance: "refutes", quote: "转载不实", confidence: 0.9 }],
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(ctx.current.stances).toEqual([]);
    const userContent = fake.calls[0]?.userContent ?? "";
    expect(userContent).not.toContain("e2");
    expect(userContent).toContain("e1");
  });

  it("同样证据第二次调用不产生 llm 调用", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({
      assess: {
        stances: [{ evidenceId: "e1", stance: "refutes", quote: "官方通报此事不实", confidence: 0.9 }],
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, {});
    expect(fake.calls).toHaveLength(1);
    expect(ctx.current.stances).toHaveLength(1);
    await runAssess(ctx, {});
    expect(fake.calls).toHaveLength(1);
    expect(ctx.current.stances).toHaveLength(1);
  });

  it("system prompt 只让模型判关系，不含命题级真假输出", async () => {
    const seeded = seedClaimAndEvidence([officialEvidence()]);
    const fake = createFakeLlm({ assess: { stances: [] } });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runAssess(ctx, { systemPromptSuffix: "控方：只找反证。" });
    expect(fake.calls[0]?.systemPrompt).toBe(`${ASSESS_SYSTEM_PROMPT}\n\n控方：只找反证。`);
    expect(fake.calls[0]?.systemPrompt).toContain("不是在裁定命题真假");
    expect(fake.calls[0]?.job).toBe("assess");
  });
});
