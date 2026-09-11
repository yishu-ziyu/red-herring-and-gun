/**
 * caseHandlers.test.ts — Plan Item 2 · 报告 URL 路由 HTTP handler 测试
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  postCaseHandler,
  getCaseHandler,
  renderCaseHtmlHandler,
  listCasesHandler,
} from "./caseHandlers";
import { clearCases, putCase, generateCaseId } from "./caseStore";
import { resetForTests, requestCode, verifyAndCreate } from "./accountStore";
import { encodeSignedJson } from "./aipingAuth";
import { EMAIL_SESSION_COOKIE } from "./emailSession";
import type { FinalReport } from "./schemas";

const TEST_SECRET = "test-server-secret-for-case-auth";

function makeReport(claim: string, extra: Record<string, unknown> = {}): FinalReport {
  return {
    originalClaim: claim,
    overallStatus: "原句过强",
    allowedConclusion: "test conclusion",
    claimDiagnosis: { originalClaim: claim, subclaims: [], routes: [], searchPlans: [], diagnosis: "证据不足" },
    subclaimStatuses: [],
    evidenceChain: [],
    doNotInfer: [],
    rewrittenClaim: { cautious: "cautious version", publicFacing: "public version", researchMemo: "" },
    nextEvidenceNeeded: [],
    ...extra,
  };
}

function mockReq(params: Record<string, string> = {}, body: unknown = null, cookie?: string): any {
  return { params, body, headers: cookie ? { cookie } : {} };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    set(key: string, value: string) {
      this.headers[key] = value;
    },
    send(payload: string) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function sessionCookie(email: string): Promise<string> {
  const requested = await requestCode(email, TEST_SECRET);
  expect(requested.ok).toBe(true);
  const verified = await verifyAndCreate(email, requested.code ?? "", TEST_SECRET);
  expect(verified.ok).toBe(true);
  const signed = encodeSignedJson({ sid: verified.sessionId }, TEST_SECRET);
  return `${EMAIL_SESSION_COOKIE}=${signed}`;
}

describe("Plan Item 2 · postCaseHandler", () => {
  beforeEach(() => {
    clearCases();
    resetForTests();
    process.env.AIPING_SESSION_SECRET = TEST_SECRET;
  });

  it("缺少 claim → 400", async () => {
    const res = mockRes();
    await postCaseHandler(mockReq({}, { report: makeReport("x") }) as never, res);
    expect(res.statusCode).toBe(400);
  });

  it("缺少 report → 400", async () => {
    const res = mockRes();
    await postCaseHandler(mockReq({}, { claim: "x" }) as never, res);
    expect(res.statusCode).toBe(400);
  });

  it("未登录 → 401（case 写入必须登录）", async () => {
    const res = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "test", report: makeReport("test") }) as never,
      res,
    );
    expect(res.statusCode).toBe(401);
  });

  it("合法 case → 200 + caseId", async () => {
    const cookie = await sessionCookie("ok@example.com");
    const res = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "test", report: makeReport("test"), credibilityScore: 75 }, cookie) as never,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.caseId).toBeTruthy();
    expect(res.body.caseId.length).toBe(8);
  });

  it("显式 caseId → 保留", async () => {
    const cookie = await sessionCookie("ok@example.com");
    const res = mockRes();
    await postCaseHandler(
      mockReq({}, {
        claim: "test",
        report: makeReport("test"),
        caseId: "custom12",
      }, cookie) as never,
      res,
    );
    expect(res.body.caseId).toBe("custom12");
  });
});

describe("Plan Item 2 · getCaseHandler", () => {
  beforeEach(() => {
    clearCases();
    resetForTests();
    process.env.AIPING_SESSION_SECRET = TEST_SECRET;
  });

  it("缺 caseId → 400", async () => {
    const res = mockRes();
    await getCaseHandler(mockReq() as never, res);
    expect(res.statusCode).toBe(400);
  });

  it("不存在 caseId → 404", async () => {
    const res = mockRes();
    await getCaseHandler(mockReq({ caseId: "nope000" }) as never, res);
    expect(res.statusCode).toBe(404);
  });

  it("已存无归属 case → 404，JSON 无正文（旧记录无分享许可按私有）", async () => {
    const entry = putCase({
      claim: "stored-unowned-secret",
      report: makeReport("stored-unowned-secret"),
      claimReview: {} as never,
      credibilityScore: 60,
    });
    const guest = mockRes();
    await getCaseHandler(mockReq({ caseId: entry.caseId }) as never, guest);
    expect(guest.statusCode).toBe(404);
    expect(JSON.stringify(guest.body)).not.toContain("stored-unowned-secret");

    const cookie = await sessionCookie("logged-in@example.com");
    const loggedIn = mockRes();
    await getCaseHandler(mockReq({ caseId: entry.caseId }, null, cookie) as never, loggedIn);
    expect(loggedIn.statusCode).toBe(404);
    expect(JSON.stringify(loggedIn.body)).not.toContain("stored-unowned-secret");
  });

  it("有归属的 case 只给主人", async () => {
    const cookieA = await sessionCookie("a@example.com");
    const postRes = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "mine", report: makeReport("mine") }, cookieA) as never,
      postRes,
    );
    const caseId = postRes.body.caseId as string;

    const stranger = mockRes();
    await getCaseHandler(mockReq({ caseId }, null) as never, stranger);
    expect(stranger.statusCode).toBe(404);

    const owner = mockRes();
    await getCaseHandler(mockReq({ caseId }, null, cookieA) as never, owner);
    expect(owner.statusCode).toBe(200);
    expect(owner.body.claim).toBe("mine");
  });
});

describe("Plan Item 2 · postCaseHandler owner match", () => {
  beforeEach(() => {
    clearCases();
    resetForTests();
    process.env.AIPING_SESSION_SECRET = TEST_SECRET;
  });

  it("putting an existing owned case requires owner match", async () => {
    const cookieA = await sessionCookie("a@example.com");
    const cookieB = await sessionCookie("b@example.com");
    const created = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "mine", report: makeReport("mine"), caseId: "owned001" }, cookieA) as never,
      created,
    );
    expect(created.statusCode).toBe(200);

    const hijack = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "stolen", report: makeReport("stolen"), caseId: "owned001" }, cookieB) as never,
      hijack,
    );
    expect(hijack.statusCode).toBe(403);

    const guest = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "stolen", report: makeReport("stolen"), caseId: "owned001" }) as never,
      guest,
    );
    expect(guest.statusCode).toBe(401);

    const ownerUpdate = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "updated", report: makeReport("updated"), caseId: "owned001" }, cookieA) as never,
      ownerUpdate,
    );
    expect(ownerUpdate.statusCode).toBe(200);
  });
});

describe("Plan Item 2 · renderCaseHtmlHandler", () => {
  beforeEach(() => {
    clearCases();
    resetForTests();
    process.env.AIPING_SESSION_SECRET = TEST_SECRET;
  });

  function htmlHasPrivateBody(html: string, secret: string) {
    expect(html).not.toContain(secret);
    expect(html).not.toContain("application/ld+json");
    expect(html).not.toContain("ClaimReview");
    expect(html).not.toContain("cautious version");
    expect(html).not.toContain("public version");
  }

  it("不存在 case → 404 + HTML 含「报告未找到」", async () => {
    const res = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId: "missing" }) as never, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers["Content-Type"]).toContain("text/html");
    expect(res.body).toContain("报告未找到");
  });

  it("无归属旧记录：游客打开 /r/:id → 404，HTML 无正文", async () => {
    const entry = putCase({
      claim: "unowned-html-secret",
      report: makeReport("unowned-html-secret"),
      claimReview: {
        "@context": "https://schema.org",
        "@type": "ClaimReview",
        claimReviewed: "unowned-html-secret",
      } as never,
      credibilityScore: 60,
    });
    const res = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId: entry.caseId }) as never, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("报告未找到");
    htmlHasPrivateBody(String(res.body), "unowned-html-secret");
  });

  it("有归属的 case：未登录与他人打开 /r/:id → 404 无正文；主人可读", async () => {
    const cookieA = await sessionCookie("a@example.com");
    const cookieB = await sessionCookie("b@example.com");
    const created = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "private-html-claim", report: makeReport("private-html-claim") }, cookieA) as never,
      created,
    );
    const caseId = created.body.caseId as string;

    const guest = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId }) as never, guest);
    expect(guest.statusCode).toBe(404);
    htmlHasPrivateBody(String(guest.body), "private-html-claim");

    const stranger = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId }, null, cookieB) as never, stranger);
    expect(stranger.statusCode).toBe(404);
    htmlHasPrivateBody(String(stranger.body), "private-html-claim");

    const owner = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId }, null, cookieA) as never, owner);
    expect(owner.statusCode).toBe(200);
    expect(owner.body).toContain("private-html-claim");
    expect(owner.body).toContain("application/ld+json");
  });

  it("主人打开中断报告（无 rewrittenClaim）→ 200，不 500", async () => {
    const cookieA = await sessionCookie("a@example.com");
    const created = mockRes();
    await postCaseHandler(
      mockReq(
        {},
        { claim: "中断的核查", report: { _source: "error-boundary", message: "provider down" } },
        cookieA,
      ) as never,
      created,
    );
    const owner = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId: created.body.caseId }, null, cookieA) as never, owner);
    expect(owner.statusCode).toBe(200);
    expect(owner.body).toContain("结论未生成");
  });

  it("HTML 转义：主人看到的 claim 含 <script> 必须 htmlEscape；游客页面不出现该脚本", async () => {
    const maliciousClaim = "<script>alert(1)</script>";
    const cookieA = await sessionCookie("a@example.com");
    const created = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: maliciousClaim, report: makeReport(maliciousClaim) }, cookieA) as never,
      created,
    );
    const caseId = created.body.caseId as string;

    const guest = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId }) as never, guest);
    expect(guest.statusCode).toBe(404);
    expect(String(guest.body)).not.toContain("<script>alert(1)</script>");
    expect(String(guest.body)).not.toContain("alert(1)");

    const owner = mockRes();
    await renderCaseHtmlHandler(mockReq({ caseId }, null, cookieA) as never, owner);
    expect(owner.statusCode).toBe(200);
    expect(owner.body).not.toContain("<script>alert(1)</script>");
    expect(owner.body).toContain("&lt;script&gt;");
  });
});

describe("Plan Item 2 · listCasesHandler", () => {
  beforeEach(() => {
    clearCases();
    resetForTests();
    process.env.AIPING_SESSION_SECRET = TEST_SECRET;
  });

  it("未登录 → 空数组，不泄漏全库", async () => {
    putCase({ claim: "secret", report: makeReport("secret"), claimReview: {} as never, credibilityScore: 50 });
    const res = mockRes();
    await listCasesHandler(mockReq() as never, res);
    expect(res.body.cases).toEqual([]);
  });

  it("只返回当前账号的 case", async () => {
    const cookieA = await sessionCookie("a@example.com");
    const cookieB = await sessionCookie("b@example.com");
    await postCaseHandler(
      mockReq({}, { claim: "from-a", report: makeReport("from-a") }, cookieA) as never,
      mockRes(),
    );
    await postCaseHandler(
      mockReq({}, { claim: "from-b", report: makeReport("from-b") }, cookieB) as never,
      mockRes(),
    );

    const resA = mockRes();
    await listCasesHandler(mockReq({}, null, cookieA) as never, resA);
    expect(resA.body.cases.map((item: { claim: string }) => item.claim)).toEqual(["from-a"]);

    const resB = mockRes();
    await listCasesHandler(mockReq({}, null, cookieB) as never, resB);
    expect(resB.body.cases.map((item: { claim: string }) => item.claim)).toEqual(["from-b"]);
  });
});

describe("Plan Item 2 · generateCaseId 集成", () => {
  it("caseId 唯一性（同 claim 不同时刻）", () => {
    const a = generateCaseId("dup");
    const b = generateCaseId("dup");
    expect(a === b).toBe(false);
  });
});