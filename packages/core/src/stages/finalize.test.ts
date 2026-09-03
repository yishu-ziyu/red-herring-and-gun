import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase } from "../casefile/reduce.js";
import type { Claim, ClaimVerdict, Evidence, Overall, Stance } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { directAnswer, startsWithFace } from "../text/publicCopy.js";
import { createStageContext, type StageContext } from "./context.js";
import type { ComposeDraft } from "./compose.schema.js";
import { FINALIZE_JOB, runFinalize } from "./finalize.js";

const AT = "2026-09-03T08:00:00.000Z";
const ORIGINAL = "人社部发文说生育津贴直接打到个人卡里了";

function ev(id: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id,
    url: `https://${id}.example.com/${id}`,
    canonicalUrl: `https://${id}.example.com/${id}`,
    host: `${id}.example.com`,
    title: `${id} 标题`,
    excerpt: "官方口径",
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "search", query: "津贴" },
    ...overrides,
  };
}

function st(id: string, claimId: string, evidenceId: string, stance: Stance["stance"] = "refutes"): Stance {
  return {
    id,
    claimId,
    evidenceId,
    stance,
    quote: "津贴由单位申领",
    confidence: 0.9,
    quoteFidelity: true,
    by: "main",
  };
}

function claim(id: string, text: string, order: number): Claim {
  return { id, text, type: "fact", checkable: true, order };
}

function overall(verdictType: Overall["verdictType"]): Overall {
  return { verdictType, contested: false, score: 20, breakdown: [] };
}

function seed(opts: {
  claims: Claim[];
  evidence?: Evidence[];
  stances?: Stance[];
  verdicts: ClaimVerdict[];
  overall?: Overall;
}): StageContext {
  const { case: c } = createCase({ id: "case1", text: ORIGINAL, at: AT });
  const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => AT });
  ctx.emit({ type: "claims.added", claims: opts.claims });
  for (const item of opts.evidence ?? []) ctx.emit({ type: "evidence.added", evidence: item });
  for (const item of opts.stances ?? []) ctx.emit({ type: "stance.added", stance: item });
  for (const item of opts.verdicts) ctx.emit({ type: "verdict.updated", verdict: item });
  if (opts.overall) ctx.emit({ type: "overall.updated", overall: opts.overall });
  return ctx;
}

function falseWithBasis(): StageContext {
  return seed({
    claims: [
      claim("c1", "生育津贴直接打到个人卡", 0),
      claim("c2", "人社部发过这份文", 1),
    ],
    evidence: [ev("e1")],
    stances: [st("s1", "c1", "e1")],
    verdicts: [
      {
        claimId: "c1",
        verdict: "false",
        basis: ["s1"],
        rule: "false",
        tally: { sup: 0, ref: 3, par: 0 },
        updatedAt: AT,
      },
      { claimId: "c2", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
    ],
    overall: overall("false"),
  });
}

function trueWithBasis(): StageContext {
  return seed({
    claims: [claim("c1", "单位申领生育津贴", 0)],
    evidence: [ev("e1")],
    stances: [st("s1", "c1", "e1", "supports")],
    verdicts: [
      {
        claimId: "c1",
        verdict: "true",
        basis: ["s1"],
        rule: "true",
        tally: { sup: 3, ref: 0, par: 0 },
        updatedAt: AT,
      },
    ],
    overall: overall("true"),
  });
}

function finishedOutcome(ctx: StageContext): string | undefined {
  const events = ctx.emitted.filter((event) => event.type === "stage.finished" && event.stage === FINALIZE_JOB);
  const last = events[events.length - 1];
  return last && last.type === "stage.finished" ? last.outcome : undefined;
}

function expectCiteBijection(ctx: StageContext): void {
  const report = ctx.current.report;
  expect(report).toBeDefined();
  if (!report) return;
  const used = new Set<number>();
  for (const match of report.conclusion.matchAll(/\[(\d+)\]/g)) used.add(Number(match[1]));
  for (const item of report.claimItems) {
    for (const n of item.citations) used.add(n);
    for (const match of item.line.matchAll(/\[(\d+)\]/g)) used.add(Number(match[1]));
  }
  const tableNs = new Set(report.citations.map((item) => item.n));
  for (const n of used) expect(tableNs.has(n)).toBe(true);
  const evidenceIds = new Set(ctx.current.evidence.map((item) => item.id));
  for (const item of report.citations) {
    expect(used.has(item.n)).toBe(true);
    expect(evidenceIds.has(item.evidenceId)).toBe(true);
  }
}

describe("runFinalize", () => {
  it("悬空 [9] 被删且该 true 行补上合法 [n]", async () => {
    const ctx = trueWithBasis();
    const draft: ComposeDraft = {
      conclusion: "单位仍申领生育津贴。[9]",
      claimItems: [{ claimId: "c1", line: "单位申领生育津贴成立[9]。" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.conclusion).not.toMatch(/\[9\]/);
    expect(report.claimItems[0]?.line).not.toMatch(/\[9\]/);
    expect(report.claimItems[0]?.line).toMatch(/\[1\]/);
    expect(report.claimItems[0]?.citations).toEqual([1]);
    expect(report.citations).toEqual([{ n: 1, evidenceId: "e1" }]);
    expectCiteBijection(ctx);
    assertInvariants(ctx.current);
    expect(finishedOutcome(ctx)).toBe("ok");
  });

  it("无任何合法引用可补 → 该行变兜底句", async () => {
    const ctx = seed({
      claims: [claim("c1", "生育津贴直接打到个人卡", 0)],
      verdicts: [{ claimId: "c1", verdict: "true", basis: [], rule: "true", updatedAt: AT }],
      overall: overall("true"),
    });
    const draft: ComposeDraft = {
      conclusion: "原句成立。",
      claimItems: [{ claimId: "c1", line: "这条属实[9]。" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.claimItems[0]?.line).toBe("生育津贴直接打到个人卡：有依据。");
    expect(report.claimItems[0]?.line).not.toMatch(/\[9\]/);
    expect(report.claimItems[0]?.citations).toEqual([]);
  });

  it("模型写了 MiniMax、web_search 被剥掉", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "MiniMax 用 web_search 核对后，津贴不会直接打卡。[1]",
      claimItems: [{ claimId: "c1", line: "Claude 与 GPT 都说 MiniMax 查过 web_search。[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.conclusion).not.toMatch(/MiniMax|web_search|Claude|\bGPT\b/i);
    expect(report.claimItems[0]?.line).not.toMatch(/MiniMax|web_search|Claude|\bGPT\b/i);
    expect(report.conclusion).toContain("津贴不会直接打卡");
    expect(report.claimItems[0]?.line).toMatch(/\[1\]/);
  });

  it("首句「不能信。……」→ 剥章印", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "不能信。生育津贴不会直接打到个人卡里，仍由单位申领。[1]",
      claimItems: [{ claimId: "c1", line: "生育津贴直接打到个人卡：与现有依据相反。[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(startsWithFace(report.conclusion)).toBe(false);
    expect(report.conclusion.startsWith("不能信")).toBe(false);
    expect(report.conclusion).toContain("生育津贴不会直接打到个人卡里");
  });

  it("draft: null → 兜底报告每条命题一行、无空字段、outcome: failed-open", async () => {
    const ctx = falseWithBasis();
    const { report } = await runFinalize(ctx, { draft: null });
    expect(report.claimItems).toHaveLength(2);
    expect(report.claimItems.map((item) => item.claimId)).toEqual(["c1", "c2"]);
    expect(report.claimItems[0]?.line).toBe("生育津贴直接打到个人卡：与现有依据相反。[1]");
    expect(report.claimItems[1]?.line).toBe("人社部发过这份文：没有找到足够依据。");
    expect(report.conclusion).toBe(directAnswer("false"));
    expect(report.conclusion).not.toContain(ORIGINAL);
    expect(report.conclusion.trim().length).toBeGreaterThan(0);
    for (const item of report.claimItems) {
      expect(item.claimId.length).toBeGreaterThan(0);
      expect(item.line.trim().length).toBeGreaterThan(0);
    }
    expect(report.finalizedAt).toBe(AT);
    expect(finishedOutcome(ctx)).toBe("failed-open");
    expectCiteBijection(ctx);
    assertInvariants(ctx.current);
  });

  it("[n] 与 Report.citations 一一对应，产出 Case 过 assertInvariants", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "津贴不会直接打卡。[1]",
      claimItems: [
        { claimId: "c1", line: "生育津贴直接打到个人卡不成立。[1]" },
        { claimId: "c2", line: "人社部是否发文还查不清。" },
      ],
    };
    await runFinalize(ctx, { draft });
    expectCiteBijection(ctx);
    assertInvariants(ctx.current);
  });

  it("模糊量词 → error 事件但行保留", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "津贴不会直接打卡。[1]",
      claimItems: [{ claimId: "c1", line: "大量材料说明由单位申领。[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.claimItems[0]?.line).toContain("大量材料说明由单位申领");
    const errors = ctx.emitted.filter((event) => event.type === "error");
    expect(errors).toEqual([
      expect.objectContaining({ stage: FINALIZE_JOB, message: expect.stringContaining("大量") }),
    ]);
    assertInvariants(ctx.current);
  });

  it("line / conclusion 里的 http(s) URL 被删除", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "津贴不会直接打卡 https://evil.example/out 。[1]",
      claimItems: [{ claimId: "c1", line: "见 https://evil.example/out 与现有依据相反。[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.conclusion).not.toMatch(/https?:\/\//i);
    expect(report.claimItems[0]?.line).not.toMatch(/https?:\/\//i);
    expect(report.claimItems[0]?.line).toMatch(/\[1\]/);
  });

  it("现场约 360 人经 finalize 后仍含 360", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "现场约 360 人到场，津贴不会直接打卡。[1]",
      claimItems: [{ claimId: "c1", line: "现场约 360 人说明由单位申领。[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.conclusion).toContain("360");
    expect(report.claimItems[0]?.line).toContain("360");
  });

  it("overall.contested 时兜底首句接矛盾句、不拼原句", async () => {
    const ctx = seed({
      claims: [claim("c1", "生育津贴直接打到个人卡", 0)],
      evidence: [ev("e1"), ev("e2")],
      stances: [st("s1", "c1", "e1", "supports"), st("s2", "c1", "e2")],
      verdicts: [
        {
          claimId: "c1",
          verdict: "contested",
          basis: ["s1", "s2"],
          rule: "contested",
          tally: { sup: 3, ref: 3, par: 0 },
          updatedAt: AT,
        },
      ],
      overall: { verdictType: "false", contested: true, score: 20, breakdown: [] },
    });
    const { report } = await runFinalize(ctx, { draft: null });
    expect(report.conclusion).toBe(`${directAnswer("false")}来源之间相互矛盾，两边都有依据。`);
    expect(report.conclusion).not.toContain(ORIGINAL);
  });

  it("案内缺失命题补兜底行，案外 claimId 丢弃", async () => {
    const ctx = falseWithBasis();
    const draft: ComposeDraft = {
      conclusion: "津贴不会直接打卡。[1]",
      claimItems: [{ claimId: "c999", line: "编造的一行[1]" }],
    };
    const { report } = await runFinalize(ctx, { draft });
    expect(report.claimItems.map((item) => item.claimId)).toEqual(["c1", "c2"]);
    expect(report.claimItems[0]?.line).toBe("生育津贴直接打到个人卡：与现有依据相反。[1]");
    expect(report.claimItems[1]?.line).toBe("人社部发过这份文：没有找到足够依据。");
  });
});
