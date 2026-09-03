import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm, type FakeScript } from "../llm/fakes.js";
import { createStageContext } from "./context.js";
import { runIntake } from "./intake.js";

const AT = "2026-09-03T00:00:00.000Z";
const NOW = "2026-09-03T00:00:01.000Z";
const PAGE_HTML = `<html><head><title>人社部通知</title></head><body><p>生育津贴直接发放到个人账户。</p><p>第二段不应作为首段。</p></body></html>`;

function setup(script: FakeScript = {}, text = "原句") {
  const { case: c } = createCase({ id: "case1", text, at: AT });
  const fake = createFakeLlm(script);
  const ctx = createStageContext({ case: c, llm: fake, now: () => NOW });
  return { ctx, fake };
}

describe("runIntake", () => {
  let port = 0;
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(PAGE_HTML);
  });
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

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
    globalThis.fetch = (async (input, init) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.startsWith("https://example.com")) {
        return originalFetch(`http://127.0.0.1:${port}/`, init);
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { ctx } = setup({}, "网传这条通知");
    const result = await runIntake(ctx, {
      text: "网传这条通知",
      attachments: [{ kind: "url", value: "https://example.com/notice" }],
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

  it("抓取失败仍发 evidence.added 且 reachable false，claimSource 退回原文", async () => {
    const { ctx } = setup({}, "原文留下");
    const result = await runIntake(ctx, {
      text: "原文留下",
      attachments: [{ kind: "url", value: "http://127.0.0.1/blocked" }],
    });
    expect(result.claimSource).toBe("原文留下");
    expect(ctx.current.evidence).toHaveLength(1);
    expect(ctx.current.evidence[0]).toMatchObject({
      id: "e1",
      reachable: false,
      provenance: { kind: "user" },
    });
  });

  it("图片进入 frontier 且 OCR 并进 claimSource", async () => {
    const { ctx } = setup({
      "vision-intake": { ocrTexts: ["截图写着生育津贴已到账"] },
    });
    const result = await runIntake(ctx, {
      text: "看看这张图",
      attachments: [{ kind: "image", value: "data:image/png;base64,aaa" }],
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
  });
});
