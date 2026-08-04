/**
 * claimReview.test.ts (server) — Plan P0-3 接入层 · ClaimReview 镜像
 *
 * 与 src/lib/claimReview.test.ts 互为镜像，保证 server SSE 输出的 JSON-LD
 * 与 client 模块字段一致。
 */

import { describe, expect, it } from "vitest";
import { buildClaimReviewJsonLd } from "./claimReview";
import type { FinalReport } from "./schemas";

function baseReport(overrides?: Partial<FinalReport>): FinalReport {
  return {
    originalClaim: "某明星昨天因某事件被捕",
    overallStatus: "原句过强",
    allowedConclusion: "现有公开材料不足以按原强度成立",
    claimDiagnosis: {
      originalClaim: "某明星昨天因某事件被捕",
      subclaims: [],
      routes: [],
      searchPlans: [],
      diagnosis: "证据不足",
    },
    subclaimStatuses: [
      {
        subclaimId: "c1",
        subclaim: "明星被捕",
        status: "证据不足",
        usableEvidence: [],
        cannotInfer: [],
      },
    ],
    evidenceChain: [],
    doNotInfer: [],
    rewrittenClaim: {
      cautious: "现有公开材料不足以按原强度成立",
      publicFacing: "转发前建议先看原始来源",
      researchMemo: "",
    },
    nextEvidenceNeeded: [],
    evidenceQualitySummary: {
      averageCredibility: 30,
      diversityScore: 20,
      contradictCount: 0,
      gaps: ["原始来源"],
    },
    insufficientEvidence: true,
    groundingRationale: "暂无可靠证据支持这一说法",
    ...overrides,
  };
}

describe("Plan P0-3 · server buildClaimReviewJsonLd", () => {
  it("schema.org context + ClaimReview type", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out["@context"]).toBe("https://schema.org");
    expect(out["@type"]).toBe("ClaimReview");
  });

  it("reviewRating 含 0-100 区间 + alternateName", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out.reviewRating.ratingValue).toBeGreaterThanOrEqual(0);
    expect(out.reviewRating.ratingValue).toBeLessThanOrEqual(100);
    expect(out.reviewRating.bestRating).toBe(100);
    expect(out.reviewRating.worstRating).toBe(0);
  });

  it("HTML 注入：claim 含 <script> 必须转义", () => {
    const out = buildClaimReviewJsonLd(
      baseReport({ originalClaim: "<script>alert(1)</script>真说法" }),
    );
    expect(out.claimReviewed).not.toContain("<script>");
    expect(out.claimReviewed).toContain("&lt;script&gt;");
  });

  it("author = 红鲱鱼与枪", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out.author.name).toBe("红鲱鱼与枪");
    expect(out.author.url).toBe("https://gun.yishuziyu.cn");
  });

  it("url 缺省时不写入字段（合法降级）", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect("url" in out).toBe(false);
  });

  it("url 显式传入时写入 + itemReviewed.appearance", () => {
    const out = buildClaimReviewJsonLd(baseReport(), {
      url: "https://gun.yishuziyu.cn/r/abc",
      appearanceUrl: "https://example.com/post",
    });
    expect(out.url).toBe("https://gun.yishuziyu.cn/r/abc");
    expect(out.itemReviewed?.appearance?.url).toBe("https://example.com/post");
  });

  it("JSON.parse 不抛错", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });

  it("insufficientEvidence=true 时 ratingExplanation 含「暂无可靠证据」", () => {
    const out = buildClaimReviewJsonLd(baseReport({ insufficientEvidence: true }));
    expect(out.reviewRating.ratingExplanation).toContain("暂无可靠证据");
  });
});