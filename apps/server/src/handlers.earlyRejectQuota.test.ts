/**
 * R12：调查流处理器里缺 claim、modelChoice 非法、JSON 解析失败三种提前 400，
 * 必须退还额度闸发的名额（契约 docs/evals/2026-09-29-r11-r12-fixes.md）。
 * 走真闸门（quotaGate）与真配额桶；用 peekCheckQuota 看 remaining，不看 ticket 标记就下结论。
 * R5：400 之后再触发请求的 close，补扣不能把这次记成已用。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "./handlers.js";
import { ACCOUNT_DAILY_CHECKS, GUEST_DAILY_CHECKS, shanghaiDayKey } from "../../src/lib/checkQuota.js";
import { requestCode, resetForTests, verifyAndCreate } from "./lib/accountStore.js";
import { encodeSignedJson } from "./lib/aipingAuth.js";
import { getServerSecret, EMAIL_SESSION_COOKIE } from "./lib/emailSession.js";
import { GUEST_CHECKS_COOKIE, peekCheckQuota, releaseFreeCheck, resetCheckQuotaForTests } from "./lib/checkQuota.js";
import { quotaGate } from "./lib/quotaPolicy.js";

const SECRET = "test-server-secret-early-reject";
const ENV = { OPENAI_API_KEY: "env-key", OPENAI_BASE_URL: "https://api.test/v1" };
const ORCHESTRATE_PATH = "/api/agent/orchestrate-stream";

function mockRes() {
  const res: any = {
    statusCode: 0,
    writableEnded: false,
    headers: {} as Record<string, unknown>,
    lastBody: "",
    writeHead: vi.fn(),
    setHeader: vi.fn((key: string, value: unknown) => {
      res.headers[key] = value;
    }),
    getHeader: vi.fn((key: string) => res.headers[key]),
    write: vi.fn(() => true),
    end: vi.fn((body?: string) => {
      res.writableEnded = true;
      if (body) res.lastBody = body;
    }),
    on: vi.fn(),
  };
  return res;
}

/** 带事件表的请求：既能喂原始请求体（走 JSON 解析失败），也能手动触发 close。 */
function makeReq(opts: { body?: unknown; rawBody?: string; cookie: string; ip: string }) {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const req: any = {
    method: "POST",
    headers: { cookie: opts.cookie, "x-real-ip": opts.ip },
    on: vi.fn((name: string, fn: (arg?: unknown) => void) => {
      (listeners[name] ??= []).push(fn);
      if (name === "end" && opts.rawBody !== undefined) {
        // 数据与结束在监听挂上之后异步送达
        setTimeout(() => {
          listeners.data?.forEach((f) => f(Buffer.from(opts.rawBody!)));
          listeners.end?.forEach((f) => f());
        }, 0);
      }
    }),
  };
  if (opts.body !== undefined) req.body = opts.body;
  return { req, fire: (name: string) => listeners[name]?.forEach((f) => f()) };
}

async function passQuotaGate(req: any, res: any): Promise<boolean> {
  let passed = false;
  await quotaGate(ORCHESTRATE_PATH)(req, res, () => {
    passed = true;
  });
  return passed;
}

function guestCookie(id: string): string {
  const token = encodeSignedJson({ id, day: shanghaiDayKey(), used: 0 }, getServerSecret());
  return `${GUEST_CHECKS_COOKIE}=${token}`;
}

const BAD_REQUESTS: Array<[string, { body?: unknown; rawBody?: string }, string]> = [
  ["缺 claim", { body: { clientRequestId: "r12-a" } }, "缺少 claim 参数"],
  ["modelChoice 非法", { body: { claim: "隔夜菜会致癌", modelChoice: "not-an-object" } }, "modelChoice"],
  ["JSON 解析失败", { rawBody: "{not json" }, "无法解析请求 JSON"],
];

beforeEach(() => {
  process.env.AIPING_SESSION_SECRET = SECRET;
  resetForTests();
  resetCheckQuotaForTests();
});

describe("R12：提前 400 退还名额", () => {
  for (const [label, shape, message] of BAD_REQUESTS) {
    it(`${label} → 400、名额退回、close 后也不记已用`, async () => {
      const handlers = createHandlers({ ...ENV });
      const { req, fire } = makeReq({ ...shape, cookie: guestCookie(`g-${label}`), ip: "203.0.113.41" });
      const res = mockRes();
      expect(await passQuotaGate(req, res)).toBe(true);
      expect((await peekCheckQuota(req)).remaining).toBe(GUEST_DAILY_CHECKS - 1);

      await handlers.orchestrateStreamHandler(req, res, vi.fn());

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.lastBody).message).toContain(message);
      expect(req.checkTicket.settled).toBe(true);
      const after = await peekCheckQuota(req);
      expect(after.remaining).toBe(GUEST_DAILY_CHECKS);
      expect(after.used).toBe(0);

      // R5：连接关闭事件晚到，补扣不得把这次记成已用；再退一次也不能多给名额
      fire("close");
      releaseFreeCheck(req.checkTicket);
      const late = await peekCheckQuota(req);
      expect(late.remaining).toBe(GUEST_DAILY_CHECKS);
      expect(late.used).toBe(0);
    });
  }

  it("访客连发缺 claim 与非法 modelChoice 两个坏请求后，第三个请求不是 429", async () => {
    const handlers = createHandlers({ ...ENV });
    const cookie = guestCookie("g-three");
    for (const shape of [BAD_REQUESTS[0]![1], BAD_REQUESTS[1]![1]]) {
      const { req } = makeReq({ ...shape, cookie, ip: "203.0.113.42" });
      const res = mockRes();
      expect(await passQuotaGate(req, res)).toBe(true);
      await handlers.orchestrateStreamHandler(req, res, vi.fn());
      expect(res.statusCode).toBe(400);
    }
    const { req } = makeReq({ body: { claim: "x" }, cookie, ip: "203.0.113.42" });
    const res = mockRes();
    expect(await passQuotaGate(req, res)).toBe(true);
    expect(res.statusCode).not.toBe(429);
  });

  it("登录账号的缺 claim 400 同样退回名额", async () => {
    const issued = await requestCode("early@test.dev", SECRET);
    const verified = await verifyAndCreate("early@test.dev", issued.code!, SECRET);
    const cookie = `${EMAIL_SESSION_COOKIE}=${encodeSignedJson({ sid: verified.sessionId }, SECRET)}`;
    const handlers = createHandlers({ ...ENV });
    const { req } = makeReq({ ...BAD_REQUESTS[0]![1], cookie, ip: "203.0.113.43" });
    const res = mockRes();
    expect(await passQuotaGate(req, res)).toBe(true);
    expect((await peekCheckQuota(req)).remaining).toBe(ACCOUNT_DAILY_CHECKS - 1);
    await handlers.orchestrateStreamHandler(req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect((await peekCheckQuota(req)).remaining).toBe(ACCOUNT_DAILY_CHECKS);
  });
});
