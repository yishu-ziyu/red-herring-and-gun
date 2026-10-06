/**
 * R10：图片解析失败不让整次调查失败（契约 docs/evals/2026-09-29-r10-image.md E2、E4-E7）。
 * 走完整 HTTP 处理器，只把 runCasePipeline 与视觉请求（全局 fetch）打桩。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  pipelineInputs: [] as any[],
  commit: vi.fn(),
  release: vi.fn(),
}));

vi.mock("./lib/casePipeline/index.js", () => ({
  runCasePipeline: async (input: any) => {
    fixture.pipelineInputs.push(input);
    return {
      steps: [],
      finalReport: { claim: input.claim, verdictType: "unverified", conclusion: "这条说法目前查不到可靠依据。" },
      atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } },
      search360Result: {},
      memoryCandidates: [],
    };
  },
}));

vi.mock("./lib/checkQuota.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/checkQuota.js")>();
  return {
    ...actual,
    commitFreeCheck: (...args: any[]) => {
      fixture.commit(...args);
      return (actual.commitFreeCheck as any)(...args);
    },
    releaseFreeCheck: (...args: any[]) => {
      fixture.release(...args);
      return (actual.releaseFreeCheck as any)(...args);
    },
  };
});

import { createHandlers } from "./handlers.js";

const NOTICE = "图片没能读出来，已按你输入的文字继续";
const ONLY_IMAGE_MESSAGE = "图片没能读出来，这次没法核查。请换一张更清晰的图，或把图里的文字打出来再试。";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const ENV = {
  OPENAI_API_KEY: "env-key",
  OPENAI_BASE_URL: "https://api.test/v1",
  STEPFUN_API_KEY: "sk-test",
  STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan",
  STEPFUN_MODEL: "step-3.7-flash",
};

function mockRes() {
  const events: Record<string, any>[] = [];
  const res: any = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn((chunk: string) => {
      if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice("data: ".length)));
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    on: vi.fn(),
  };
  return { res, events };
}

let seq = 0;
async function run(text: string, claim: string) {
  const ticket: any = { kind: "guest", day: "2026-09-29", guestId: `img-${++seq}`, ipKey: undefined, settled: false };
  const req: any = {
    method: "POST",
    body: {
      claim,
      clientRequestId: `r10-${Date.now()}-${seq}`,
      intake: { text, links: [], images: [{ name: "a.png", type: "image/png", size: 8, dataUrl: PNG }] },
    },
    checkTicket: ticket,
    headers: { "x-real-ip": "203.0.113.55" },
    on: vi.fn(),
  };
  const { res, events } = mockRes();
  await createHandlers(ENV).orchestrateStreamHandler(req, res, vi.fn());
  return { events, ticket };
}

function stubVision(response: () => Promise<any>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    return response();
  }));
  return urls;
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  fixture.pipelineInputs.length = 0;
  fixture.commit.mockClear();
  fixture.release.mockClear();
  vi.unstubAllGlobals();
});

describe("R10 图片解析失败", () => {
  it("E2 图片请求发往 step_plan/v1/chat/completions", async () => {
    const urls = stubVision(async () => jsonResponse(404, { error: { message: "not found" } }));
    await run("这张停水通知是真的吗？", "这张停水通知是真的吗？");
    expect(urls[0]).toBe("https://api.stepfun.com/step_plan/v1/chat/completions");
  });

  it("E4 404 + 有文字：发常驻提示、管线照跑、以 complete 结束、额度提交", async () => {
    stubVision(async () => jsonResponse(404, { error: { message: "not found" } }));
    const { events } = await run("这张停水通知是真的吗？", "这张停水通知是真的吗？");
    const notice = events.find((e) => e.type === "notice");
    expect(notice).toMatchObject({ code: "image_unreadable", message: NOTICE });
    expect(fixture.pipelineInputs).toHaveLength(1);
    expect(fixture.pipelineInputs[0].claim).toBe("这张停水通知是真的吗？");
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(fixture.commit).toHaveBeenCalledTimes(1);
    expect(fixture.release).not.toHaveBeenCalled();
  });

  it("E5 模型返回的不是 JSON：同样按文字继续", async () => {
    stubVision(async () =>
      jsonResponse(200, { choices: [{ message: { content: "图片里的文字如下：停水通知" } }] }),
    );
    const { events } = await run("这张停水通知是真的吗？", "这张停水通知是真的吗？");
    expect(events.some((e) => e.type === "notice" && e.code === "image_unreadable")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("E6 只有图片没有文字：不跑管线，专用文案，额度退还", async () => {
    stubVision(async () => jsonResponse(500, { error: { message: "boom" } }));
    const { events } = await run("", "请核查用户上传的 1 张图片材料。");
    expect(fixture.pipelineInputs).toHaveLength(0);
    const error = events.find((e) => e.type === "error");
    expect(error).toMatchObject({ code: "image_unreadable", message: ONLY_IMAGE_MESSAGE });
    expect(events.some((e) => e.type === "complete")).toBe(false);
    expect(fixture.release).toHaveBeenCalledTimes(1);
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toMatch(/step_plan|boom|调用失败/i);
  });

  it("E7 图片读出来了：没有提示帧", async () => {
    const output = { visualSummary: "停水通知", ocrTexts: ["停水通知"], extractedClaims: [], sourceHints: [], uncertaintyNotes: [], nextEvidenceNeeds: [] };
    stubVision(async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify(output) } }] }));
    const { events } = await run("这张停水通知是真的吗？", "这张停水通知是真的吗？");
    expect(events.some((e) => e.type === "notice")).toBe(false);
    expect(fixture.pipelineInputs[0].claim).toContain("停水通知");
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });
});
