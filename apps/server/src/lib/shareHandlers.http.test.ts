/**
 * 分享端点的 HTTP 行为验收：所有权、创建、读取、撤销。
 * 用真会话（requestCode → verifyAndCreate），不打桩权限。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_SESSION_COOKIE } from "./emailSession.js";
import { encodeSignedJson } from "./aipingAuth.js";
import { hashEmail, peekOutstandingCode, requestCode, verifyAndCreate } from "./accountStore.js";
import { getServerSecret } from "./emailSession.js";
import { clearCases, putCase } from "./caseStore.js";
import {
  createShareHandler,
  previewShareHandler,
  revokeShareHandler,
  renderShareHtmlHandler,
  __setShareStoreForTests,
  createShareStore,
} from "./shareHandlers.js";

function fakeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    set(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
    end(payload?: unknown) {
      if (payload !== undefined) res.body = payload;
    },
  };
  return res;
}

/** cookie 里放的是签名过的 { sid }，不是裸 session id——照真实形状来。 */
function reqWith(sessionId: string | null, params: Record<string, string> = {}) {
  if (!sessionId) return { params, headers: {} };
  const cookie = `${EMAIL_SESSION_COOKIE}=${encodeURIComponent(encodeSignedJson({ sid: sessionId }, getServerSecret()))}`;
  return { params, headers: { cookie } };
}

const email = "owner@example.com";

// requestCode 对同一邮箱有重发冷却：同一个邮箱只登录一次，之后复用会话。
const sessions = new Map<string, { sessionId: string; hash: string }>();

async function sessionFor(address: string): Promise<{ sessionId: string; hash: string }> {
  const cached = sessions.get(address);
  if (cached) return cached;
  const secret = getServerSecret();
  await requestCode(address, secret);
  const code = peekOutstandingCode(address, secret);
  const verified = await verifyAndCreate(address, code!, secret);
  if (!verified.ok || !verified.sessionId) {
    throw new Error(`session setup failed for ${address}: ${verified.error ?? "unknown"}`);
  }
  const value = { sessionId: verified.sessionId, hash: hashEmail(address, secret) };
  sessions.set(address, value);
  return value;
}

beforeEach(() => {
  process.env.AIPING_SESSION_SECRET = process.env.AIPING_SESSION_SECRET || "test-secret-value";
  process.env.RHG_ACCOUNT_SECRET = process.env.RHG_ACCOUNT_SECRET || "test-secret-value";
  clearCases();
  __setShareStoreForTests(createShareStore(null));
});

function seedCase(ownerHash: string | undefined, caseId = "case-share-1") {
  return putCase({
    caseId,
    claim: "隔夜菜会致癌",
    report: { conclusion: "原句过强。", checkedAt: "2026-09-11T10:00:00.000Z" } as never,
    claimReview: { "@type": "ClaimReview" } as never,
    credibilityScore: 40,
    ...(ownerHash ? { ownerHash } : {}),
  });
}

describe("所有权", () => {
  it("没归属的 case 谁都不能建分享", async () => {
    seedCase(undefined);
    const res = fakeRes();
    await createShareHandler(reqWith(null, { caseId: "case-share-1" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("别人登着也建不了（404，不泄露存在性）", async () => {
    const owner = await sessionFor(email);
    seedCase(owner.hash);
    const other = await sessionFor("other@example.com");
    const res = fakeRes();
    await createShareHandler(reqWith(other.sessionId, { caseId: "case-share-1" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("主人可以预览", async () => {
    const owner = await sessionFor(email);
    seedCase(owner.hash);
    const res = fakeRes();
    await previewShareHandler(reqWith(owner.sessionId, { caseId: "case-share-1" }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { preview: { claim: string } }).preview.claim).toBe("隔夜菜会致癌");
  });
});

describe("创建 → 读取 → 撤销", () => {
  it("主人创建拿到令牌，公开页读得到；撤销后读不到", async () => {
    const owner = await sessionFor(email);
    seedCase(owner.hash);

    const createRes = fakeRes();
    const dbgReq = reqWith(owner.sessionId, { caseId: "case-share-1" });
    await createShareHandler(dbgReq, createRes);
    expect(createRes.statusCode).toBe(201);
    const created = createRes.body as { shareId: string; url: string };
    expect(created.url).toBe(`/s/${created.shareId}`);
    // 令牌里看不到 caseId
    expect(created.shareId).not.toContain("case-share-1");

    const pageRes = fakeRes();
    await renderShareHtmlHandler(reqWith(null, { shareId: created.shareId }), pageRes);
    expect(pageRes.statusCode).toBe(200);
    expect(String(pageRes.body)).toContain("隔夜菜会致癌");
    expect(String(pageRes.body)).toContain("原句过强。");
    // 公开页不含账号与内部字段
    expect(String(pageRes.body)).not.toContain(email);
    expect(String(pageRes.body)).not.toContain(owner.hash);

    const revokeRes = fakeRes();
    await revokeShareHandler(reqWith(owner.sessionId, { caseId: "case-share-1", shareId: created.shareId }), revokeRes);
    expect(revokeRes.statusCode).toBe(200);
    expect((revokeRes.body as { revoked: boolean }).revoked).toBe(true);

    const afterRes = fakeRes();
    await renderShareHtmlHandler(reqWith(null, { shareId: created.shareId }), afterRes);
    expect(afterRes.statusCode).toBe(404);
    expect(String(afterRes.body)).toContain("分享链接不可用");
  });

  it("不存在的令牌：404 且只有一种说法", async () => {
    const res = fakeRes();
    await renderShareHtmlHandler(reqWith(null, { shareId: "does-not-exist" }), res);
    expect(res.statusCode).toBe(404);
    expect(String(res.body)).not.toContain("原句过强");
  });

  it("撤销之后私有路由仍然打不开（分享与私有是两条路）", async () => {
    const owner = await sessionFor(email);
    seedCase(owner.hash);
    const createRes = fakeRes();
    await createShareHandler(reqWith(owner.sessionId, { caseId: "case-share-1" }), createRes);
    const created = createRes.body as { shareId: string };
    const revokeRes = fakeRes();
    await revokeShareHandler(reqWith(owner.sessionId, { caseId: "case-share-1", shareId: created.shareId }), revokeRes);
    // 主人自己走私有 JSON 仍然读得到（撤销只撤公开页）
    const { getCaseHandler } = await import("./caseHandlers.js");
    const jsonRes = fakeRes();
    await getCaseHandler(reqWith(owner.sessionId, { caseId: "case-share-1" }), jsonRes);
    expect(jsonRes.statusCode).toBe(200);
  });
});
