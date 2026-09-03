import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import type { FetchedPage } from "../fetch/types.js";
import { createFakeLlm, type FakeScript } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { runIntake } from "./intake.js";

const AT = "2026-09-03T00:00:00.000Z";
const NOW = "2026-09-03T00:00:01.000Z";

function setup(script: FakeScript = {}, text = "原句") {
  const { case: c } = createCase({ id: "case1", text, at: AT });
  const fake = createFakeLlm(script);
  const ctx = createStageContext({ case: c, llm: fake, now: () => NOW });
  return { ctx, fake };
}

function page(over: Partial<FetchedPage> = {}): FetchedPage {
  return {
    finalUrl: "https://example.com/notice",
    status: 200,
    contentType: "text/html",
    text: "人社部通知\n生育津贴直接发放到个人账户。\n\n第二段不应作为首段。",
    title: "人社部通知",
    links: [],
    images: [],
    reachable: true,
    charset: "utf-8",
    ...over,
  };
}

describe("runIntake", () => {
  it("文本原样成为 claimSource，并发 stage.started/finished", async () => {
    const { ctx } = setup({}, "只是一句原话");
    const result = await runIntake(ctx, { text: "只是一句原话" });
    expect(result.claimSource).toBe("只是一句原话");
    expect(ctx.current.evidence).toEqual([]);
    expect(ctx.emitted.map((e) => e.type)).toEqual(["stage.started", "stage.finished"]);
    expect(ctx.emitted[0]).toMatchObject({ type: "stage.started", stage: "intake" });
    expect(ctx.emitted[1]).toMatchObject({ type: "stage.finished", stage: "intake", outcome: "ok" });
  });

  it("链接输入产生第 0 号证据且 claimSource 含标题与首段", async () => {
    const { ctx } = setup({}, "网传这条通知");
    const result = await runIntake(ctx, {
      text: "网传这条通知",
      attachments: [{ kind: "url", value: "https://example.com/notice" }],
      tools: { fetch: async () => page() },
    });

    expect(ctx.current.evidence).toHaveLength(1);
    const evidence = ctx.current.evidence[0]!;
    expect(evidence.id).toBe("e1");
    expect(evidence.provenance).toEqual({ kind: "user" });
    expect(evidence.reachable).toBe(true);
    expect(evidence.title).toBe("人社部通知");
    expect(evidence.excerpt).toContain("生育津贴直接发放到个人账户");
    expect(result.claimSource).toContain("网传这条通知");
    expect(result.claimSource).toContain("人社部通知");
    expect(result.claimSource).toContain("生育津贴直接发放到个人账户。");
    expect(result.claimSource.length).toBeGreaterThan(0);
    expect(ctx.emitted.some((e) => e.type === "evidence.added")).toBe(true);
  });

  it("正文里的链接不用 attachments 也会抓取，且与 attachments 去重", async () => {
    const { ctx } = setup({}, "看看这个 https://example.com/notice 说的对不对");
    const fetched: string[] = [];
    const result = await runIntake(ctx, {
      text: "看看这个 https://example.com/notice 说的对不对",
      attachments: [{ kind: "url", value: "https://example.com/notice" }],
      tools: {
        fetch: async (url) => {
          fetched.push(url);
          return page();
        },
      },
    });

    expect(fetched).toEqual(["https://example.com/notice"]);
    expect(ctx.current.evidence).toHaveLength(1);
    expect(result.claimSource).toContain("人社部通知");
  });

  it("抓取失败仍发 evidence.added 且 reachable false，claimSource 退回原文", async () => {
    const { ctx } = setup({}, "原文留下");
    const result = await runIntake(ctx, {
      text: "原文留下",
      attachments: [{ kind: "url", value: "http://127.0.0.1/blocked" }],
      tools: {
        fetch: async (url) =>
          page({
            finalUrl: url,
            status: 0,
            text: "",
            title: undefined,
            reachable: false,
            error: "ssrf: private host",
          }),
      },
    });
    expect(result.claimSource).toBe("原文留下");
    expect(ctx.current.evidence).toHaveLength(1);
    expect(ctx.current.evidence[0]).toMatchObject({
      id: "e1",
      reachable: false,
      provenance: { kind: "user" },
    });
  });

  it("有 vision 工具则 claimSource 含 OCR 文本", async () => {
    const { ctx, fake } = setup();
    const result = await runIntake(ctx, {
      text: "看看这张图",
      attachments: [{ kind: "image", value: "data:image/png;base64,aaa" }],
      tools: { vision: async () => ({ ocrTexts: ["截图写着生育津贴已到账"] }) },
    });
    expect(ctx.current.frontier).toEqual([
      {
        id: "p1",
        kind: "image",
        value: "data:image/png;base64,aaa",
        why: "用户上传",
        expectedValue: 1,
        depth: 0,
      },
    ]);
    expect(result.claimSource).toContain("看看这张图");
    expect(result.claimSource).toContain("截图写着生育津贴已到账");
    expect(ctx.emitted.some((e) => e.type === "frontier.added")).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it("无 vision 工具则 claimSource 等于原文且不调模型", async () => {
    const { ctx, fake } = setup();
    const result = await runIntake(ctx, {
      text: "看看这张图",
      attachments: [{ kind: "image", value: "data:image/png;base64,aaa" }],
    });
    expect(result.claimSource).toBe("看看这张图");
    expect(fake.calls).toEqual([]);
    expect(ctx.current.frontier).toEqual([
      expect.objectContaining({
        id: "p1",
        kind: "image",
        value: "data:image/png;base64,aaa",
        why: "用户上传",
        expectedValue: 1,
        depth: 0,
      }),
    ]);
  });
});
