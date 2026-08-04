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
import type { FinalReport } from "./schemas";

function makeReport(claim: string): FinalReport {
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
  };
}

function mockReq(params: Record<string, string> = {}, body: unknown = null): any {
  return { params, body };
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

describe("Plan Item 2 · postCaseHandler", () => {
  beforeEach(() => clearCases());

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

  it("合法 case → 200 + caseId", async () => {
    const res = mockRes();
    await postCaseHandler(
      mockReq({}, { claim: "test", report: makeReport("test"), credibilityScore: 75 }) as never,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.caseId).toBeTruthy();
    expect(res.body.caseId.length).toBe(8);
  });

  it("显式 caseId → 保留", async () => {
    const res = mockRes();
    await postCaseHandler(
      mockReq({}, {
        claim: "test",
        report: makeReport("test"),
        caseId: "custom12",
      }) as never,
      res,
    );
    expect(res.body.caseId).toBe("custom12");
  });
});

describe("Plan Item 2 · getCaseHandler", () => {
  beforeEach(() => clearCases());

  it("缺 caseId → 400", () => {
    const res = mockRes();
    getCaseHandler(mockReq() as never, res);
    expect(res.statusCode).toBe(400);
  });

  it("不存在 caseId → 404", () => {
    const res = mockRes();
    getCaseHandler(mockReq({ caseId: "nope000" }) as never, res);
    expect(res.statusCode).toBe(404);
  });

  it("已存 case → 200 + JSON", () => {
    const entry = putCase({
      claim: "stored",
      report: makeReport("stored"),
      claimReview: {} as never,
      credibilityScore: 60,
    });
    const res = mockRes();
    getCaseHandler(mockReq({ caseId: entry.caseId }) as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.claim).toBe("stored");
  });
});

describe("Plan Item 2 · renderCaseHtmlHandler", () => {
  beforeEach(() => clearCases());

  it("不存在 case → 404 + HTML 含「报告未找到」", () => {
    const res = mockRes();
    renderCaseHtmlHandler(mockReq({ caseId: "missing" }) as never, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers["Content-Type"]).toContain("text/html");
    expect(res.body).toContain("报告未找到");
  });

  it("已存 case → 200 + HTML 含 schema.org/ClaimReview", () => {
    const entry = putCase({
      claim: "测试说法",
      report: makeReport("测试说法"),
      claimReview: {
        "@context": "https://schema.org",
        "@type": "ClaimReview",
        claimReviewed: "测试说法",
        reviewRating: { "@type": "Rating", ratingValue: 50, bestRating: 100, worstRating: 0, alternateName: "存疑" },
        author: { "@type": "Organization", name: "红鲱鱼与枪", url: "https://gun.yishuziyu.cn" },
        datePublished: "2026-07-25T00:00:00Z",
      } as never,
      credibilityScore: 60,
    });
    const res = mockRes();
    renderCaseHtmlHandler(mockReq({ caseId: entry.caseId }) as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("application/ld+json");
    expect(res.body).toContain("ClaimReview");
    expect(res.body).toContain("测试说法");
  });

  it("HTML 转义：claim 含 <script> 必须 htmlEscape", () => {
    const maliciousClaim = "<script>alert(1)</script>";
    const entry = putCase({
      claim: maliciousClaim,
      report: makeReport(maliciousClaim),
      claimReview: {} as never,
      credibilityScore: 60,
    });
    const res = mockRes();
    renderCaseHtmlHandler(mockReq({ caseId: entry.caseId }) as never, res);
    expect(res.body).not.toContain("<script>alert(1)</script>");
    expect(res.body).toContain("&lt;script&gt;");
  });
});

describe("Plan Item 2 · listCasesHandler", () => {
  beforeEach(() => clearCases());

  it("空 → 返回空数组", () => {
    const res = mockRes();
    listCasesHandler({} as never, res);
    expect(res.body.cases).toEqual([]);
  });

  it("多 case → 返回", () => {
    putCase({ claim: "a", report: makeReport("a"), claimReview: {} as never, credibilityScore: 50 });
    putCase({ claim: "b", report: makeReport("b"), claimReview: {} as never, credibilityScore: 50 });
    const res = mockRes();
    listCasesHandler({} as never, res);
    expect(res.body.cases.length).toBe(2);
  });
});

describe("Plan Item 2 · generateCaseId 集成", () => {
  it("caseId 唯一性（同 claim 不同时刻）", () => {
    const a = generateCaseId("dup");
    const b = generateCaseId("dup");
    expect(a === b).toBe(false);
  });
});