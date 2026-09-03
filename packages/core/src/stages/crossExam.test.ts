import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase } from "../casefile/reduce.js";
import type { Evidence } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext, type StageContext } from "./context.js";
import {
  DEFENDER_MANDATE,
  PROSECUTOR_MANDATE,
  runCrossExam,
} from "./crossExam.js";
import type { InvestigatorTools } from "./investigate.js";

const AT = "2026-09-03T12:00:00.000Z";
const CLAIM = "人社部发文说生育津贴直接打到个人卡里了";
const SUPPORT_QUOTE = "官方口径支持该说法";
const REFUTE_QUOTE = "另一官方口径否定该说法";
const NEW_REFUTE_QUOTE = "通报明确此事不实";
const DEFEND_QUOTE = "原文完整语境支持该说法";
const FORBIDDEN = ["能信", "不能信", "可信", "不可信", "真", "假"] as const;

function pickFirstCandidate(params: { userContent: string }) {
  const line = params.userContent.split("\n").find((row) => row.startsWith("1. "));
  if (!line) throw new Error("no candidate line");
  const parsed = JSON.parse(line.slice(3)) as {
    kind: "search" | "fetch" | "reverse_image" | "recall";
    target: string;
  };
  return { action: { kind: parsed.kind, target: parsed.target, why: "选第一候选" } };
}

function pageEvidence(
  id: string,
  url: string,
  excerpt: string,
  host: string,
): Evidence {
  return {
    id,
    url,
    canonicalUrl: url,
    host,
    excerpt,
    text: excerpt,
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "user" },
  };
}

function searchHit(url: string, excerpt: string, host: string): Evidence {
  return {
    id: "tmp",
    url,
    canonicalUrl: url,
    host,
    excerpt,
    text: excerpt,
    retrievedAt: AT,
    tier: "unknown",
    provenance: { kind: "search", query: "交叉复核" },
  };
}

function emptyTools(search: InvestigatorTools["search"] = async () => []): InvestigatorTools {
  return {
    search,
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  };
}

function seedUnverified(): StageContext {
  const { case: c } = createCase({ id: "case-t11", text: CLAIM, at: AT });
  const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => AT });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: CLAIM, type: "fact", checkable: true, order: 0 }],
  });
  ctx.emit({
    type: "verdict.updated",
    verdict: { claimId: "c1", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
  });
  return ctx;
}

function seedContested(): StageContext {
  const { case: c } = createCase({ id: "case-t11", text: CLAIM, at: AT });
  const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => AT });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: CLAIM, type: "fact", checkable: true, order: 0 }],
  });
  ctx.emit({
    type: "evidence.added",
    evidence: pageEvidence("e1", "https://www.gov.cn/support-page", SUPPORT_QUOTE, "www.gov.cn"),
  });
  ctx.emit({
    type: "evidence.added",
    evidence: pageEvidence("e2", "https://www.mohrss.gov.cn/refute-page", REFUTE_QUOTE, "www.mohrss.gov.cn"),
  });
  ctx.emit({
    type: "stance.added",
    stance: {
      id: "s1",
      claimId: "c1",
      evidenceId: "e1",
      stance: "supports",
      quote: SUPPORT_QUOTE,
      confidence: 0.9,
      quoteFidelity: true,
      by: "main",
    },
  });
  ctx.emit({
    type: "stance.added",
    stance: {
      id: "s2",
      claimId: "c1",
      evidenceId: "e2",
      stance: "refutes",
      quote: REFUTE_QUOTE,
      confidence: 0.9,
      quoteFidelity: true,
      by: "main",
    },
  });
  ctx.emit({
    type: "verdict.updated",
    verdict: {
      claimId: "c1",
      verdict: "contested",
      basis: ["s1", "s2"],
      rule: "contested",
      tally: { sup: 3, ref: 3, par: 0 },
      updatedAt: AT,
    },
  });
  return ctx;
}

function liveContext(seeded: StageContext, fake: ReturnType<typeof createFakeLlm>): StageContext {
  return createStageContext({ case: seeded.current, llm: fake, now: () => AT });
}

function stepRoles(ctx: StageContext): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of ctx.emitted) {
    if (event.type !== "investigator.step") continue;
    counts[event.role] = (counts[event.role] ?? 0) + 1;
  }
  return counts;
}

describe("runCrossExam", () => {
  it("非 contested 命题不触发：无事件、返回三个空数组", async () => {
    const seeded = seedUnverified();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = liveContext(seeded, fake);
    const result = await runCrossExam(ctx, { tools: emptyTools() });
    expect(result).toEqual({ examined: [], flipped: [], stillContested: [] });
    expect(ctx.emitted).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
    assertInvariants(ctx.current);
  });

  it("两方各自预算独立：控方 budget 用尽后辩方仍跑满自己的步数", async () => {
    const seeded = seedContested();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = liveContext(seeded, fake);
    await runCrossExam(ctx, { tools: emptyTools(), budget: 2 });
    expect(stepRoles(ctx)).toEqual({ prosecutor: 2, defender: 2 });
    assertInvariants(ctx.current);
  });

  it("stance 带 by：控方 prosecutor、辩方 defender", async () => {
    const prosecutorUrl = "https://www.news.cn/prosecutor-hit";
    const defenderUrl = "https://www.people.com.cn/defender-hit";
    let searches = 0;
    const seeded = seedContested();
    const fake = createFakeLlm({
      investigate: pickFirstCandidate,
      assess: [
        {
          stances: [{ evidenceId: "e3", stance: "refutes", quote: NEW_REFUTE_QUOTE, confidence: 0.9 }],
        },
        {
          stances: [{ evidenceId: "e4", stance: "supports", quote: DEFEND_QUOTE, confidence: 0.9 }],
        },
      ],
    });
    const ctx = liveContext(seeded, fake);
    await runCrossExam(ctx, {
      budget: 1,
      tools: emptyTools(async () => {
        searches += 1;
        if (searches === 1) return [searchHit(prosecutorUrl, NEW_REFUTE_QUOTE, "news.cn")];
        return [searchHit(defenderUrl, DEFEND_QUOTE, "people.com.cn")];
      }),
    });
    const byProsecutor = ctx.current.stances.filter((item) => item.by === "prosecutor");
    const byDefender = ctx.current.stances.filter((item) => item.by === "defender");
    expect(byProsecutor.length).toBeGreaterThan(0);
    expect(byDefender.length).toBeGreaterThan(0);
    expect(byProsecutor.every((item) => item.by === "prosecutor")).toBe(true);
    expect(byDefender.every((item) => item.by === "defender")).toBe(true);
    assertInvariants(ctx.current);
  });

  it("控方找到 A 级反证后判决翻为 false", async () => {
    const hitUrl = "https://www.news.cn/extra-refute";
    let searches = 0;
    const seeded = seedContested();
    const fake = createFakeLlm({
      investigate: pickFirstCandidate,
      assess: {
        stances: [{ evidenceId: "e3", stance: "refutes", quote: NEW_REFUTE_QUOTE, confidence: 0.9 }],
      },
    });
    const ctx = liveContext(seeded, fake);
    const result = await runCrossExam(ctx, {
      budget: 1,
      tools: emptyTools(async () => {
        searches += 1;
        if (searches === 1) return [searchHit(hitUrl, NEW_REFUTE_QUOTE, "news.cn")];
        return [];
      }),
    });
    expect(ctx.current.verdicts.find((item) => item.claimId === "c1")?.verdict).toBe("false");
    expect(ctx.current.verdicts.find((item) => item.claimId === "c1")?.tally).toEqual({
      sup: 3,
      ref: 6,
      par: 0,
    });
    expect(result.examined).toEqual(["c1"]);
    expect(result.flipped).toContain("c1");
    expect(result.stillContested).not.toContain("c1");
    assertInvariants(ctx.current);
  });

  it("两方均无新增 → 保持 contested 且 overall.contested", async () => {
    const seeded = seedContested();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = liveContext(seeded, fake);
    const result = await runCrossExam(ctx, { tools: emptyTools(), budget: 1 });
    expect(ctx.current.verdicts.find((item) => item.claimId === "c1")?.verdict).toBe("contested");
    expect(ctx.current.overall?.contested).toBe(true);
    expect(result.stillContested).toContain("c1");
    expect(result.flipped).not.toContain("c1");
    assertInvariants(ctx.current);
  });

  it("单厂商 key 时两方仍运行并注明同一模型来源；两厂商时 investigate 工单带各自 modelOverride", async () => {
    const providers = [
      { provider: "deepseek" as const, model: "deepseek-chat" },
      { provider: "stepfun" as const, model: "step-2" },
    ];

    const emptySeed = seedContested();
    const emptyFake = createFakeLlm({ investigate: pickFirstCandidate });
    const emptyCtx = liveContext(emptySeed, emptyFake);
    await runCrossExam(emptyCtx, { tools: emptyTools(), budget: 1, providers: [] });
    expect(stepRoles(emptyCtx).prosecutor).toBe(1);
    expect(stepRoles(emptyCtx).defender).toBe(1);
    const emptyError = emptyCtx.emitted.find((event) => event.type === "error");
    expect(emptyError?.type === "error" && emptyError.message).toContain("同一模型来源");

    const oneSeed = seedContested();
    const oneFake = createFakeLlm({ investigate: pickFirstCandidate });
    const oneCtx = liveContext(oneSeed, oneFake);
    await runCrossExam(oneCtx, { tools: emptyTools(), budget: 1, providers: [providers[0]!] });
    expect(stepRoles(oneCtx).prosecutor).toBe(1);
    expect(stepRoles(oneCtx).defender).toBe(1);
    const oneError = oneCtx.emitted.find((event) => event.type === "error");
    expect(oneError?.type === "error" && oneError.message).toContain("同一模型来源");

    const twoSeed = seedContested();
    const twoFake = createFakeLlm({ investigate: pickFirstCandidate });
    const twoCtx = liveContext(twoSeed, twoFake);
    await runCrossExam(twoCtx, { tools: emptyTools(), budget: 1, providers });
    expect(twoCtx.emitted.some((event) => event.type === "error")).toBe(false);
    const investigate = twoFake.calls.filter((call) => call.job === "investigate");
    const prosecutorCalls = investigate.filter((call) => call.systemPrompt.includes(PROSECUTOR_MANDATE));
    const defenderCalls = investigate.filter((call) => call.systemPrompt.includes(DEFENDER_MANDATE));
    expect(prosecutorCalls.length).toBeGreaterThan(0);
    expect(defenderCalls.length).toBeGreaterThan(0);
    expect(prosecutorCalls.every((call) => call.modelOverride?.provider === "deepseek")).toBe(true);
    expect(prosecutorCalls.every((call) => call.modelOverride?.model === "deepseek-chat")).toBe(true);
    expect(defenderCalls.every((call) => call.modelOverride?.provider === "stepfun")).toBe(true);
    expect(defenderCalls.every((call) => call.modelOverride?.model === "step-2")).toBe(true);
    assertInvariants(emptyCtx.current);
    assertInvariants(oneCtx.current);
    assertInvariants(twoCtx.current);
  });

  it("任务书常量不含能信、不能信、可信、不可信、真、假", () => {
    for (const word of FORBIDDEN) {
      expect(PROSECUTOR_MANDATE).not.toContain(word);
      expect(DEFENDER_MANDATE).not.toContain(word);
    }
  });
});
