/**
 * claimReview.ts — Plan P0-3 · 输出 schema.org/ClaimReview JSON-LD
 *
 * 动机：Google 2025-06 下线 Rich ClaimReview 富文本展示但保留索引入口；
 * Duke Reporters' Lab + 各国核查机构仍消费 ClaimReview JSON。
 * 中文本产品支持 ClaimReview 可借该 schema 进入事实核查生态。
 *
 * 字段：参考 schema.org/ClaimReview
 *   - @context = "https://schema.org"
 *   - @type = "ClaimReview"
 *   - claimReviewed：原说法（HTML 转义以防 XSS）
 *   - reviewRating：含 ratingValue/bestRating/worstRating
 *   - author：发布方（"红鲱鱼与枪"）
 *   - datePublished：ISO 时间
 *   - url（可选）：永久路由
 *   - appearance（可选）：原说法首次出现渠道
 *   - searchString（可选）：查询串
 *   - itemReviewed：{ @type: "Claim", name: claimReviewed, appearance? }
 */

import type { FinalReport } from "./schemas";
import { labelForScore } from "../../server/src/lib/credibilityScore";

export interface ClaimReviewJsonLd {
  "@context": "https://schema.org";
  "@type": "ClaimReview";
  claimReviewed: string;
  reviewRating: {
    "@type": "Rating";
    ratingValue: number;
    bestRating: 100;
    worstRating: 0;
    alternateName: string;
    ratingExplanation?: string;
  };
  author: {
    "@type": "Organization";
    name: string;
    url: string;
  };
  datePublished: string;
  url?: string;
  itemReviewed?: {
    "@type": "Claim";
    name: string;
    appearance?: { "@type": "CreativeWork"; url?: string };
  };
  searchString?: string;
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function htmlEscape(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

function verdictFromReport(report: FinalReport): "true" | "false" | "mixed_misleading" | "unverified" {
  // Map allowedConclusion keywords → ClaimReview 枚举
  const c = report.allowedConclusion ?? "";
  if (/不能支持|不能按原|不可证|暂无可靠证据/.test(c)) return "unverified";
  if (/不成立|已被证伪|错误/.test(c)) return "false";
  if (/部分成立|部分被夸大|断章取义|mixed|存疑/.test(c)) return "mixed_misleading";
  return "true";
}

function ratingValueFromReport(report: FinalReport): number {
  // credibilityScore 不在 FinalReport 中；走 evidenceQualitySummary 平均可信度；
  // 缺则取 50（中性），不允许编造
  const eq = report.evidenceQualitySummary;
  if (eq && typeof eq.averageCredibility === "number") {
    return Math.max(0, Math.min(100, Math.round(eq.averageCredibility)));
  }
  // 退路：infer from subclaim status
  const statuses = report.subclaimStatuses ?? [];
  if (statuses.length === 0) return 50;
  const scoreMap: Record<string, number> = {
    部分支持: 60,
    限定支持: 50,
    证据不足: 30,
  };
  const sum = statuses.reduce((acc, s) => acc + (scoreMap[s.status] ?? 50), 0);
  return Math.max(0, Math.min(100, Math.round(sum / statuses.length)));
}

export function buildClaimReviewJsonLd(
  report: FinalReport,
  options?: { url?: string; appearanceUrl?: string; searchString?: string },
): ClaimReviewJsonLd {
  const claim = htmlEscape((report.originalClaim ?? "").trim());
  const verdict = verdictFromReport(report);
  const value = ratingValueFromReport(report);
  const label = labelForScore(value);

  const out: ClaimReviewJsonLd = {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    claimReviewed: claim,
    reviewRating: {
      "@type": "Rating",
      ratingValue: value,
      bestRating: 100,
      worstRating: 0,
      alternateName: label,
      ratingExplanation:
        report.groundingRationale ??
        (report.insufficientEvidence ? "暂无可靠证据支持这一说法" : undefined),
    },
    author: {
      "@type": "Organization",
      name: "红鲱鱼与枪",
      url: "https://gun.yishuziyu.cn",
    },
    datePublished: new Date().toISOString(),
    itemReviewed: {
      "@type": "Claim",
      name: claim,
    },
  };

  if (options?.url) out.url = options.url;
  if (options?.appearanceUrl && out.itemReviewed) {
    out.itemReviewed.appearance = { "@type": "CreativeWork", url: options.appearanceUrl };
  }
  if (options?.searchString) out.searchString = options.searchString;

  // JSON.parse 不抛错自检（开发态断言）
  JSON.parse(JSON.stringify(out));
  return out;
}

export function serializeClaimReviewTag(jsonLd: ClaimReviewJsonLd): string {
  // 安全序列化：转义 </script 以防 HTML 注入
  const json = JSON.stringify(jsonLd).replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">${json}</script>`;
}