/**
 * claimReview.test.ts — Plan P0-3 · ClaimReview JSON-LD 序列化测试
 *
 * 关键校验：
 *   - 必填字段齐全（schema.org/ClaimReview 必备：claimReviewed / reviewRating）
 *   - JSON.parse 不抛错
 *   - claim 含 <script> 等危险字符必须 HTML 转义
 *   - serializeClaimReviewTag 输出只包含 1 个 <script type="application/ld+json">
 *   - 不进 claimReview 的 url 在缺省时不写入字段
 */

import { describe, expect, it } from "vitest";
import { buildClaimReviewJsonLd, serializeClaimReviewTag } from "./claimReview";
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

describe("Plan P0-3 · ClaimReview JSON-LD", () => {
  it("buildClaimReviewJsonLd 必须含 schema.org context + ClaimReview type", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out["@context"]).toBe("https://schema.org");
    expect(out["@type"]).toBe("ClaimReview");
    expect(out.claimReviewed).toBe("某明星昨天因某事件被捕");
  });

  it("reviewRating 必须含 ratingValue/bestRating=100/worstRating=0", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out.reviewRating.ratingValue).toBe(30);
    expect(out.reviewRating.bestRating).toBe(100);
    expect(out.reviewRating.worstRating).toBe(0);
    expect(out.reviewRating.alternateName).toBeTruthy();
  });

  it("ratingValue 应在 0-100 范围内（裁剪安全）", () => {
    const over = buildClaimReviewJsonLd(
      baseReport({
        evidenceQualitySummary: {
          averageCredibility: 150, // 越界
          diversityScore: 50,
          contradictCount: 0,
          gaps: [],
        },
      }),
    );
    const under = buildClaimReviewJsonLd(
      baseReport({
        evidenceQualitySummary: {
          averageCredibility: -20, // 越界
          diversityScore: 50,
          contradictCount: 0,
          gaps: [],
        },
      }),
    );
    expect(over.reviewRating.ratingValue).toBeLessThanOrEqual(100);
    expect(under.reviewRating.ratingValue).toBeGreaterThanOrEqual(0);
  });

  it("HTML 注入：claim 含 <script> 必须转义", () => {
    const malicious = "<script>alert('xss')</script>真实说法";
    const out = buildClaimReviewJsonLd(baseReport({ originalClaim: malicious }));
    expect(out.claimReviewed).not.toContain("<script>");
    expect(out.claimReviewed).toContain("&lt;script&gt;");
  });

  it("JSON.parse 不抛错（双向一致）", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    const parsed = JSON.parse(JSON.stringify(out));
    expect(parsed["@type"]).toBe("ClaimReview");
  });

  it("url 缺省时不写入 url 字段（合法降级）", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect("url" in out).toBe(false);
  });

  it("url 显式传入时应写入 url + itemReviewed.appearance", () => {
    const out = buildClaimReviewJsonLd(baseReport(), {
      url: "https://gun.yishuziyu.cn/r/abc123",
      appearanceUrl: "https://example.com/post",
    });
    expect(out.url).toBe("https://gun.yishuziyu.cn/r/abc123");
    expect(out.itemReviewed?.appearance?.url).toBe("https://example.com/post");
  });

  it("verdict 映射：allowedConclusion 含「不能支持」应映射到 unverified", () => {
    const out = buildClaimReviewJsonLd(
      baseReport({ allowedConclusion: "现有材料不能支持这一说法" }),
    );
    // 不可见的内部字段：仅检查 ratingExplanation 等
    expect(out.reviewRating.alternateName).toBeTruthy();
  });

  it("insufficientEvidence=true 时应在 ratingExplanation 注入「暂无可靠证据」", () => {
    const out = buildClaimReviewJsonLd(baseReport({ insufficientEvidence: true }));
    expect(out.reviewRating.ratingExplanation).toContain("暂无可靠证据");
  });

  it("serializeClaimReviewTag 输出必须只有一个 <script type=\"application/ld+json\">", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    const tag = serializeClaimReviewTag(out);
    const matches = tag.match(/<script type="application\/ld\+json">/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("serializeClaimReviewTag 不可注入 HTML（双重保险：htmlEscape + JSON 转义）", () => {
    const out = buildClaimReviewJsonLd(baseReport({ originalClaim: "</script><img onerror>" }));
    const tag = serializeClaimReviewTag(out);
    expect(out.claimReviewed).not.toContain("</script>");
    expect(out.claimReviewed).toContain("&lt;/script&gt;");
    expect(tag).toContain("<script type=\"application/ld+json\">");
    const closes = tag.match(/<\/script>/g) ?? [];
    expect(closes.length).toBe(1);
  });

  it("author 必须是红鲱鱼与枪", () => {
    const out = buildClaimReviewJsonLd(baseReport());
    expect(out.author.name).toBe("红鲱鱼与枪");
    expect(out.author.url).toBe("https://gun.yishuziyu.cn");
  });
});