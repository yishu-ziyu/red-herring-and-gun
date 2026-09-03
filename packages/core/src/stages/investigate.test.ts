import { describe, expect, it } from "vitest";
import { assertInvariants } from "../casefile/invariants.js";
import { createCase } from "../casefile/reduce.js";
import type { Evidence, Pivot } from "../casefile/schema.js";
import type { FetchedPage } from "../fetch/types.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext, type StageContext } from "./context.js";
import {
  runInvestigator,
  type InvestigatorTools,
} from "./investigate.js";

const AT = "2026-09-03T12:00:00.000Z";
const CLAIM = "人社部发文说生育津贴直接打到个人卡里了";
const REPRINT_URL = "https://mp.weixin.qq.com/s/reprint-allowance";
const GOV_URL = "https://www.gov.cn/zhengce/202409/allowance";
const GOV_TEXT = "人社部从未发文称生育津贴直接打到个人卡。通知明确：津贴拨付至用人单位。";

function page(partial: Partial<FetchedPage> & Pick<FetchedPage, "finalUrl" | "text">): FetchedPage {
  return {
    status: 200,
    contentType: "text/html",
    links: [],
    images: [],
    reachable: true,
    charset: "utf-8",
    ...partial,
  };
}

function seedCase(): StageContext {
  const { case: c } = createCase({ id: "case-t10", text: CLAIM, at: AT });
  const ctx = createStageContext({
    case: c,
    llm: createFakeLlm({}),
    now: () => AT,
  });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: CLAIM, type: "fact", checkable: true, order: 0 }],
  });
  return ctx;
}

function reprintEvidence(): Evidence {
  return {
    id: "e1",
    url: REPRINT_URL,
    canonicalUrl: REPRINT_URL,
    host: "mp.weixin.qq.com",
    title: "自媒体转载",
    excerpt: "转载称生育津贴直接打到个人卡",
    retrievedAt: AT,
    tier: "C",
    provenance: { kind: "search", query: "生育津贴" },
  };
}

function reprintPivot(): Pivot {
  return {
    id: "seed-reprint",
    kind: "link",
    value: REPRINT_URL,
    why: "转载页",
    expectedValue: 1,
    fromEvidenceId: "e1",
    depth: 1,
  };
}

function pickFirstCandidate(params: { userContent: string }) {
  const line = params.userContent.split("\n").find((row) => row.startsWith("1. "));
  if (!line) throw new Error("no candidate line");
  const parsed = JSON.parse(line.slice(3)) as {
    kind: "search" | "fetch" | "reverse_image" | "recall";
    target: string;
  };
  return { action: { kind: parsed.kind, target: parsed.target, why: "选第一候选" } };
}

function emptySearchTools(search: InvestigatorTools["search"] = async () => []): InvestigatorTools {
  return {
    search,
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  };
}

describe("runInvestigator", () => {
  it("两跳出处链：转载页 fetch → gov 落地 cites 与 A 级证伪，stop resolved", async () => {
    const seeded = seedCase();
    seeded.emit({ type: "evidence.added", evidence: reprintEvidence() });
    seeded.emit({ type: "frontier.added", pivots: [reprintPivot()] });
    seeded.emit({
      type: "verdict.updated",
      verdict: { claimId: "c1", verdict: "unverified", basis: [], rule: "no-evidence", updatedAt: AT },
    });

    const fake = createFakeLlm({
      investigate: [
        { action: { kind: "fetch", target: REPRINT_URL, why: "打开转载页找原始来源" } },
        { action: { kind: "fetch", target: GOV_URL, why: "打开政府原文" } },
      ],
      cites: [
        { primaryLinks: [{ url: GOV_URL, why: "转载页声称的原始来源" }], citesEvidenceIds: [] },
        { primaryLinks: [], citesEvidenceIds: [] },
      ],
      assess: [
        { stances: [] },
        {
          stances: [
            {
              evidenceId: "e2",
              stance: "refutes",
              quote: "人社部从未发文称生育津贴直接打到个人卡",
              confidence: 0.9,
            },
          ],
        },
      ],
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const tools: InvestigatorTools = {
      search: async () => {
        throw new Error("search should not run");
      },
      fetch: async (url) => {
        if (url === REPRINT_URL) {
          return page({
            finalUrl: REPRINT_URL,
            html: `<html><a href="${GOV_URL}">原文</a></html>`,
            text: `转载称生育津贴直接打到个人卡。原文见 ${GOV_URL}`,
            title: "自媒体转载",
            links: [GOV_URL],
          });
        }
        if (url === GOV_URL) {
          return page({
            finalUrl: GOV_URL,
            text: GOV_TEXT,
            title: "人社部通知",
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    };

    const result = await runInvestigator(ctx, { role: "main", tools });

    const frontierAdded = ctx.emitted.filter((event) => event.type === "frontier.added");
    const govPivot = frontierAdded
      .flatMap((event) => event.pivots)
      .find((pivot) => pivot.kind === "link" && pivot.value === GOV_URL);
    expect(govPivot?.expectedValue).toBe(3);

    const gov = ctx.current.evidence.find((item) => item.id === "e2");
    expect(gov?.tier).toBe("A");
    expect(ctx.current.cites).toEqual([{ from: "e1", to: "e2" }]);
    expect(ctx.current.verdicts.find((item) => item.claimId === "c1")?.verdict).toBe("false");
    expect(result.stopReason).toBe("resolved");

    const consumed = ctx.emitted.filter((event) => event.type === "frontier.consumed").map((event) => event.pivotId);
    expect(ctx.current.consumedPivotIds).toEqual(consumed);
    const addedUrls = ctx.emitted
      .filter((event) => event.type === "evidence.added")
      .map((event) => event.evidence.canonicalUrl);
    expect(new Set(addedUrls).size).toBe(addedUrls.length);
    assertInvariants(ctx.current);
  });

  it("模型提议非法 target → 回退，why 以 fallback: 开头", async () => {
    const seeded = seedCase();
    const fake = createFakeLlm({
      investigate: { action: { kind: "search", target: "__not_a_candidate__", why: "编造" } },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, {
      role: "main",
      budget: 1,
      tools: emptySearchTools(),
    });
    const step = ctx.emitted.find((event) => event.type === "investigator.step");
    expect(step?.type === "investigator.step" && step.why.startsWith("fallback:")).toBe(true);
    expect(result.steps).toBe(1);
    assertInvariants(ctx.current);
  });

  it("连续零增益 3 步 → no-gain", async () => {
    const seeded = seedCase();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, { role: "main", tools: emptySearchTools() });
    expect(result.stopReason).toBe("no-gain");
    expect(result.steps).toBe(3);
    const gains = ctx.emitted.filter((event) => event.type === "investigator.step").map((event) => event.gain);
    expect(gains).toEqual([0, 0, 0]);
    assertInvariants(ctx.current);
  });

  it("budget: 2 → budget", async () => {
    const seeded = seedCase();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, { role: "main", budget: 2, tools: emptySearchTools() });
    expect(result.stopReason).toBe("budget");
    expect(result.steps).toBe(2);
    assertInvariants(ctx.current);
  });

  it("deadline 已过 → 0 步 time", async () => {
    const seeded = seedCase();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, {
      role: "main",
      deadline: Date.now() - 1,
      tools: emptySearchTools(),
    });
    expect(result).toEqual({ stopReason: "time", steps: 0 });
    expect(ctx.emitted.filter((event) => event.type === "investigator.step")).toHaveLength(0);
    expect(ctx.emitted.filter((event) => event.type === "investigator.stopped")).toEqual([
      expect.objectContaining({ reason: "time", role: "main" }),
    ]);
    assertInvariants(ctx.current);
  });

  it("工具连续抛错 3 次 → tool-failed", async () => {
    const seeded = seedCase();
    const fake = createFakeLlm({ investigate: pickFirstCandidate });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, {
      role: "main",
      tools: emptySearchTools(async () => {
        throw new Error("provider down");
      }),
    });
    expect(result.stopReason).toBe("tool-failed");
    expect(result.steps).toBe(3);
    const steps = ctx.emitted.filter((event) => event.type === "investigator.step");
    expect(steps.every((event) => event.result.startsWith("tool-failed:"))).toBe(true);
    assertInvariants(ctx.current);
  });

  it("所有命题已 true 且 basis 含 A → 0 步 resolved", async () => {
    const seeded = seedCase();
    seeded.emit({
      type: "evidence.added",
      evidence: {
        id: "e1",
        url: GOV_URL,
        canonicalUrl: "https://gov.cn/zhengce/202409/allowance",
        host: "gov.cn",
        excerpt: "官方确认属实",
        text: "官方确认属实",
        retrievedAt: AT,
        tier: "A",
        provenance: { kind: "user" },
      },
    });
    seeded.emit({
      type: "stance.added",
      stance: {
        id: "s1",
        claimId: "c1",
        evidenceId: "e1",
        stance: "supports",
        quote: "官方确认属实",
        confidence: 0.9,
        quoteFidelity: true,
        by: "main",
      },
    });
    seeded.emit({
      type: "verdict.updated",
      verdict: {
        claimId: "c1",
        verdict: "true",
        basis: ["s1"],
        rule: "true",
        tally: { sup: 4, ref: 0, par: 0 },
        updatedAt: AT,
      },
    });
    const fake = createFakeLlm({});
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    const result = await runInvestigator(ctx, { role: "main", tools: emptySearchTools() });
    expect(result).toEqual({ stopReason: "resolved", steps: 0 });
    expect(fake.calls).toHaveLength(0);
    assertInvariants(ctx.current);
  });

  it("搜索返回 A 级无正文命中 → frontier 出 link pivot，fetch 后有 text", async () => {
    const hitUrl = "https://www.gov.cn/zhengce/unread-hit";
    const seeded = seedCase();
    const fetched: string[] = [];
    const fake = createFakeLlm({
      investigate: pickFirstCandidate,
      assess: { stances: [] },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runInvestigator(ctx, {
      role: "main",
      budget: 2,
      tools: {
        search: async () => [
          {
            id: "tmp",
            url: hitUrl,
            canonicalUrl: "https://gov.cn/zhengce/unread-hit",
            host: "gov.cn",
            excerpt: "只有摘要",
            retrievedAt: AT,
            tier: "unknown",
            provenance: { kind: "search", query: "津贴" },
          },
        ],
        fetch: async (url) => {
          fetched.push(url);
          return page({ finalUrl: url, text: GOV_TEXT, title: "人社部通知" });
        },
      },
    });

    const unread = ctx.emitted
      .filter((event) => event.type === "frontier.added")
      .flatMap((event) => event.pivots)
      .find((pivot) => pivot.kind === "link" && pivot.value === hitUrl);
    expect(unread).toMatchObject({
      kind: "link",
      why: "搜索命中 A 级页，只有摘要，未读全文",
      expectedValue: 3,
      fromEvidenceId: "e1",
    });
    expect(unread?.id.startsWith("e1:p")).toBe(true);
    expect(fetched).toContain(hitUrl);
    expect(ctx.current.evidence[0]?.text).toBe(GOV_TEXT);
    const second = fake.calls.filter((call) => call.job === "investigate")[1];
    expect(second?.userContent).toContain(hitUrl);
    expect(second?.userContent).toContain('"kind":"fetch"');
    assertInvariants(ctx.current);
  });

  it("模型写错 kind 但 target 对 → 按候选 kind 执行", async () => {
    const seeded = seedCase();
    const searched: string[] = [];
    const fake = createFakeLlm({
      investigate: (params) => {
        const line = params.userContent.split("\n").find((row) => row.startsWith("1. "));
        if (!line) throw new Error("no candidate line");
        const parsed = JSON.parse(line.slice(3)) as { target: string };
        return { action: { kind: "fetch", target: parsed.target, why: "kind 写错" } };
      },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runInvestigator(ctx, {
      role: "main",
      budget: 1,
      tools: {
        search: async (query) => {
          searched.push(query);
          return [];
        },
        fetch: async () => {
          throw new Error("fetch should not run");
        },
      },
    });
    expect(searched.length).toBeGreaterThan(0);
    const step = ctx.emitted.find((event) => event.type === "investigator.step");
    expect(step?.type === "investigator.step" && step.action.kind).toBe("search");
    assertInvariants(ctx.current);
  });

  it("图片候选用 pivot id 作 label，prompt 不含 data:", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const seeded = seedCase();
    seeded.emit({
      type: "frontier.added",
      pivots: [
        {
          id: "p3",
          kind: "image",
          value: dataUrl,
          why: "用户上传",
          expectedValue: 1,
          depth: 0,
        },
      ],
    });
    const fake = createFakeLlm({
      investigate: { action: { kind: "stop", target: "", why: "先看候选" } },
    });
    const ctx = createStageContext({ case: seeded.current, llm: fake, now: () => AT });
    await runInvestigator(ctx, {
      role: "main",
      tools: {
        search: async () => [],
        fetch: async () => {
          throw new Error("fetch should not run");
        },
        reverseImage: async () => [],
      },
    });
    const prompt = fake.calls[0]?.userContent ?? "";
    expect(prompt).toContain("p3");
    expect(prompt).not.toContain("data:");
    expect(prompt).not.toContain(dataUrl);
    assertInvariants(ctx.current);
  });
});
