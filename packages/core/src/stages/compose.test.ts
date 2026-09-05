import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import type { Claim, ClaimVerdict, Evidence, Overall, Stance } from "../casefile/schema.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext, type StageContext } from "./context.js";
import { COMPOSE_JOB, runCompose } from "./compose.js";

const AT = "2026-09-03T08:00:00.000Z";
const ORIGINAL = "人社部发文说生育津贴直接打到个人卡里了";

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
  text?: string;
  claims: Claim[];
  evidence: Evidence[];
  stances: Stance[];
  verdicts: ClaimVerdict[];
  overall?: Overall;
}): { ctx: StageContext; fake: ReturnType<typeof createFakeLlm> } {
  const fake = createFakeLlm({ assess: { stances: [] } });
  const { case: c } = createCase({ id: "case1", text: opts.text ?? ORIGINAL, at: AT });
  const ctx = createStageContext({ case: c, llm: fake, now: () => AT });
  ctx.emit({ type: "claims.added", claims: opts.claims });
  for (const item of opts.evidence) ctx.emit({ type: "evidence.added", evidence: item });
  for (const item of opts.stances) ctx.emit({ type: "stance.added", stance: item });
  for (const item of opts.verdicts) ctx.emit({ type: "verdict.updated", verdict: item });
  if (opts.overall) ctx.emit({ type: "overall.updated", overall: opts.overall });
  return { ctx, fake };
}

function twoClaimCtx(): { ctx: StageContext; fake: ReturnType<typeof createFakeLlm> } {
  return seed({
    claims: [
      claim("c1", "生育津贴直接打到个人卡", 0),
      claim("c2", "人社部发过这份文", 1),
    ],
    evidence: [ev("e1"), ev("e2")],
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
    overall: { verdictType: "false", contested: false, score: 20, breakdown: [] },
  });
}

describe("runCompose", () => {
  it("不调用 compose LLM，仍发 started/finished ok，输出安全模板", async () => {
    const { ctx, fake } = twoClaimCtx();
    const result = await runCompose(ctx, {});
    expect(fake.calls).toEqual([]);
    expect(result.draft).toEqual({
      conclusion: `${ORIGINAL}：与现有依据相反。[1][2]`,
      claimItems: [
        { claimId: "c1", line: "生育津贴直接打到个人卡：与现有依据相反。[1][2]" },
        { claimId: "c2", line: "人社部发过这份文：没有找到足够依据。" },
      ],
    });
    expect(ctx.emitted.filter((event) => event.type === "stage.started")).toEqual([
      expect.objectContaining({ stage: COMPOSE_JOB }),
    ]);
    expect(ctx.emitted.filter((event) => event.type === "stage.finished")).toEqual([
      expect.objectContaining({ stage: COMPOSE_JOB, outcome: "ok" }),
    ]);
  });

  it("平台条件扩写不会出现：只保留原命题与合法引用", async () => {
    const text = "点早安晚安图片手机会中毒，个人信息会被盗";
    const { ctx, fake } = seed({
      text,
      claims: [claim("c2", "点早安晚安图片个人信息会被盗", 0)],
      evidence: [ev("e7")],
      stances: [st("s7", "c2", "e7", "微信聊天中正常显示的问候图片、视频等，是不会中毒的")],
      verdicts: [
        { claimId: "c2", verdict: "false", basis: ["s7"], rule: "false", updatedAt: AT },
      ],
      overall: { verdictType: "false", contested: false, score: 0, breakdown: [] },
    });
    const result = await runCompose(ctx, {});
    expect(fake.calls).toEqual([]);
    expect(result.draft?.claimItems[0]?.line).toBe("点早安晚安图片个人信息会被盗：与现有依据相反。[1]");
    expect(result.draft?.conclusion).toBe(`${text}：与现有依据相反。[1]`);
    expect(JSON.stringify(result.draft)).not.toContain("图片和视频本身");
    expect(JSON.stringify(result.draft)).not.toContain("恶意代码");
    expect(JSON.stringify(result.draft)).not.toContain("这条说法");
  });

  it("时间/地区扩写不会出现", async () => {
    const text = "京沪高速公路停止收费了";
    const { ctx } = seed({
      text,
      claims: [claim("c1", "京沪高速公路停止收费了", 0)],
      evidence: [ev("e1")],
      stances: [st("s1", "c1", "e1", "某省国庆期间部分路段免费通行")],
      verdicts: [{ claimId: "c1", verdict: "false", basis: ["s1"], rule: "false", updatedAt: AT }],
      overall: { verdictType: "false", contested: false, score: 0, breakdown: [] },
    });
    const result = await runCompose(ctx, {});
    expect(result.draft?.claimItems[0]?.line).toBe("京沪高速公路停止收费了：与现有依据相反。[1]");
    expect(result.draft?.conclusion).toBe(`${text}：与现有依据相反。[1]`);
    expect(JSON.stringify(result.draft)).not.toContain("全国");
    expect(JSON.stringify(result.draft)).not.toContain("所有高速公路");
  });

  it("未发现不得写成不可能，unverified 行不加猜测机制", async () => {
    const text = "某地推广某保健品后癌症死亡率下降";
    const { ctx } = seed({
      text,
      claims: [claim("c1", "某地推广某保健品后癌症死亡率下降", 0)],
      evidence: [ev("e1")],
      stances: [st("s1", "c1", "e1", "未检索到该地官方癌症死亡率数据")],
      verdicts: [
        { claimId: "c1", verdict: "unverified", basis: ["s1"], rule: "insufficient", updatedAt: AT },
      ],
      overall: { verdictType: "unverified", contested: false, score: 0, breakdown: [] },
    });
    const result = await runCompose(ctx, {});
    expect(result.draft?.claimItems[0]?.line).toBe("某地推广某保健品后癌症死亡率下降：没有找到足够依据。");
    expect(result.draft?.conclusion).toBe(`${text}：没有找到足够依据。`);
    expect(JSON.stringify(result.draft)).not.toContain("不可能");
    expect(result.draft?.conclusion).not.toMatch(/\[\d+\]/);
  });
});
