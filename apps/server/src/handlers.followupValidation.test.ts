/**
 * followUp=true 且带了 caseId 时：案件必须存在且属于请求者。
 * 缺 caseId 是访客路径（上一轮材料在 priorRound），不在本文件拦。
 * caseId 不存在 / ownerHash 不匹配 → 400，文案恒为同一句，
 * 不扣额度（名额原样退回）、不建 run、不开 SSE。
 * 额度用真闸门（quotaGate）与真配额桶观察，不看 ticket 标记就下结论。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers, FOLLOW_UP_CASE_MISSING_MESSAGE } from "./handlers.js";
import {
  ACCOUNT_DAILY_CHECKS,
  GUEST_DAILY_CHECKS,
  shanghaiDayKey,
} from "../../src/lib/checkQuota.js";
import { hashEmail, requestCode, resetForTests, verifyAndCreate } from "./lib/accountStore.js";
import { encodeSignedJson } from "./lib/aipingAuth.js";
import { getServerSecret, EMAIL_SESSION_COOKIE } from "./lib/emailSession.js";
import { GUEST_CHECKS_COOKIE, peekCheckQuota, resetCheckQuotaForTests } from "./lib/checkQuota.js";
import { quotaGate } from "./lib/quotaPolicy.js";
import { clearCases, putCase } from "./lib/caseStore.js";
import { openRunStore } from "./lib/runStore.js";

const SECRET = "test-server-secret-for-followup";
const ENV = { OPENAI_API_KEY: "env-key", OPENAI_BASE_URL: "https://api.test/v1" };
const ORCHESTRATE_PATH = "/api/agent/orchestrate-stream";

function mockRes() {
  const res: any = {
    statusCode: 0,
    writableEnded: false,
    headers: {} as Record<string, unknown>,
    lastBody: "" as string,
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

/** 真闸门：与 index.ts 挂在 orchestrate-stream 上的中间件同一个。 */
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

async function signIn(email: string): Promise<{ hash: string; cookie: string }> {
  const issued = await requestCode(email, SECRET);
  expect(issued.ok).toBe(true);
  const verified = await verifyAndCreate(email, issued.code!, SECRET);
  expect(verified.ok).toBe(true);
  const token = encodeSignedJson({ sid: verified.sessionId }, SECRET);
  return { hash: hashEmail(email, SECRET), cookie: `${EMAIL_SESSION_COOKIE}=${token}` };
}

function seedCase(caseId: string, ownerHash: string | undefined, verdictType = "true") {
  putCase({
    caseId,
    claim: "隔夜菜里的亚硝酸盐会致癌",
    report: {
      originalClaim: "隔夜菜里的亚硝酸盐会致癌",
      verdictType,
      citationSources: [{ url: "https://a.test/1", title: "来源" }],
    } as never,
    claimReview: {} as never,
    credibilityScore: 42,
    ...(ownerHash ? { ownerHash } : {}),
  });
}

beforeEach(() => {
  process.env.AIPING_SESSION_SECRET = SECRET;
  resetForTests();
  resetCheckQuotaForTests();
  clearCases();
});

describe("followUp=true 的 caseId 校验", () => {
  it("caseId 不存在 → 400、文案同句、名额退回、不建 run", async () => {
    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: "隔夜菜里的亚硝酸盐会致癌",
        followUp: true,
        caseId: "nosuch01",
        clientRequestId: "req-followup-b",
      },
      headers: { cookie: guestCookie("guest-notfound"), "x-real-ip": "203.0.113.12" },
      on: vi.fn(),
    };
    const res = mockRes();
    expect(await passQuotaGate(req, res)).toBe(true);

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.lastBody)).toEqual({ message: FOLLOW_UP_CASE_MISSING_MESSAGE });
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(req.checkTicket.settled).toBe(true);
    expect((await peekCheckQuota(req)).remaining).toBe(GUEST_DAILY_CHECKS);
    expect(openRunStore()!.findByIdempotencyKey(null, "req-followup-b")).toBeNull();
  });

  it("caseId 属于别人 → 400、文案同句、名额退回、不建 run", async () => {
    const owner = await signIn("owner@test.dev");
    const other = await signIn("other@test.dev");
    seedCase("casebor1", other.hash);
    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: "隔夜菜里的亚硝酸盐会致癌",
        followUp: true,
        caseId: "casebor1",
        clientRequestId: "req-followup-c",
      },
      headers: { cookie: owner.cookie, "x-real-ip": "203.0.113.13" },
      on: vi.fn(),
    };
    const res = mockRes();
    expect(await passQuotaGate(req, res)).toBe(true);
    expect((await peekCheckQuota(req)).remaining).toBe(ACCOUNT_DAILY_CHECKS - 1);

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.lastBody)).toEqual({ message: FOLLOW_UP_CASE_MISSING_MESSAGE });
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(req.checkTicket.settled).toBe(true);
    expect((await peekCheckQuota(req)).remaining).toBe(ACCOUNT_DAILY_CHECKS);
    expect(openRunStore()!.findByIdempotencyKey(owner.hash, "req-followup-c")).toBeNull();
  });

  it("未登录拿自己的 caseId 追问 → 同样一句话 400（无归属请求者无权）", async () => {
    const owner = await signIn("owner2@test.dev");
    seedCase("caseown1", owner.hash);
    const handlers = createHandlers({ ...ENV });
    const req: any = {
      method: "POST",
      body: {
        claim: "隔夜菜里的亚硝酸盐会致癌",
        followUp: true,
        caseId: "caseown1",
        clientRequestId: "req-followup-d",
      },
      headers: { cookie: guestCookie("guest-anon"), "x-real-ip": "203.0.113.14" },
      on: vi.fn(),
    };
    const res = mockRes();
    expect(await passQuotaGate(req, res)).toBe(true);

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.lastBody)).toEqual({ message: FOLLOW_UP_CASE_MISSING_MESSAGE });
    expect((await peekCheckQuota(req)).remaining).toBe(GUEST_DAILY_CHECKS);
    expect(openRunStore()!.findByIdempotencyKey(null, "req-followup-d")).toBeNull();
  });
});
