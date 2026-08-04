/**
 * claimReviewStream.test.ts — Plan P0-3 接入层 + Plan Item 2 · 客户端 SSE 集成测试
 */

import { describe, expect, it } from "vitest";
import {
  buildCopyButtonText,
  buildCopySuccessText,
  handleCaseSaved,
  handleStreamComplete,
} from "./claimReviewStream";
import type { ClaimReviewJsonLd } from "./claimReview";

function fakeJsonLd(): ClaimReviewJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    claimReviewed: "测试",
    reviewRating: { "@type": "Rating", ratingValue: 50, bestRating: 100, worstRating: 0, alternateName: "存疑" },
    author: { "@type": "Organization", name: "红鲱鱼与枪", url: "https://gun.yishuziyu.cn" },
    datePublished: "2026-07-25T00:00:00Z",
  };
}

describe("Plan P0-3 · handleStreamComplete", () => {
  it("complete + 含 claimReview → injected=true", () => {
    const r = handleStreamComplete({ type: "complete", claimReview: fakeJsonLd() });
    expect(typeof r.injected).toBe("boolean");
  });

  it("complete 但缺 claimReview → reason=no-claim-review-field", () => {
    const r = handleStreamComplete({ type: "complete" });
    expect(r.reason).toBe("no-claim-review-field");
    expect(r.injected).toBe(false);
  });

  it("非 complete 事件 → reason=not-complete-event", () => {
    const r = handleStreamComplete({ type: "agent_step" } as never);
    expect(r.reason).toBe("not-complete-event");
  });
});

describe("Plan Item 2 · handleCaseSaved", () => {
  const baseUrl = "https://gun.yishuziyu.cn";

  it("case_saved + caseId + caseUrl → 返回绝对 URL", () => {
    const r = handleCaseSaved({ type: "case_saved", caseId: "abc12345", caseUrl: "/r/abc12345" }, baseUrl);
    expect(r.caseId).toBe("abc12345");
    expect(r.caseUrl).toBe("https://gun.yishuziyu.cn/r/abc12345");
  });

  it("caseUrl 缺省时构造 /r/:caseId", () => {
    const r = handleCaseSaved({ type: "case_saved", caseId: "xyz98765" }, baseUrl);
    expect(r.caseUrl).toBe("https://gun.yishuziyu.cn/r/xyz98765");
  });

  it("caseUrl 已是绝对 URL → 不重复拼接 baseUrl", () => {
    const r = handleCaseSaved(
      { type: "case_saved", caseId: "abc", caseUrl: "https://other.example.com/r/abc" },
      baseUrl,
    );
    expect(r.caseUrl).toBe("https://other.example.com/r/abc");
  });

  it("缺 caseId → caseId=null + reason=no-case-id", () => {
    const r = handleCaseSaved({ type: "case_saved" }, baseUrl);
    expect(r.caseId).toBeNull();
    expect(r.reason).toBe("no-case-id");
  });

  it("非 case_saved 事件 → reason=not-case-saved-event", () => {
    const r = handleCaseSaved({ type: "complete" } as never, baseUrl);
    expect(r.reason).toBe("not-case-saved-event");
  });

  it("baseUrl 缺省时使用 https://gun.yishuziyu.cn 兜底", () => {
    const r = handleCaseSaved({ type: "case_saved", caseId: "fallback" });
    expect(r.caseUrl).toBe("https://gun.yishuziyu.cn/r/fallback");
  });
});

describe("Plan P0-3 · UI 文案", () => {
  it("复制按钮文本", () => {
    expect(buildCopyButtonText()).toBe("复制 JSON-LD");
  });
  it("复制成功文本", () => {
    expect(buildCopySuccessText()).toBe("已复制到剪贴板");
  });
});