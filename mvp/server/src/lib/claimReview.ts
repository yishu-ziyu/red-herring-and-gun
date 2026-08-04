/**
 * claimReview.ts (server) — Plan P0-3 接入层 · 输出 schema.org/ClaimReview JSON-LD
 *
 * server-side 镜像，与 src/lib/claimReview.ts 保持 schema 一致。
 * SSE handler.ts:1047 在 type:"complete" 事件中加入 claimReview 字段。
 */

import type { FinalReport } from "./schemas";
import { labelForScore } from "./credibilityScore";

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

export function buildClaimReviewJsonLd(
  report: FinalReport,
  options?: { url?: string; appearanceUrl?: string; searchString?: string },
): ClaimReviewJsonLd {
  const claim = htmlEscape((report.originalClaim ?? "").trim());
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

  JSON.parse(JSON.stringify(out));
  return out;
}

function ratingValueFromReport(report: FinalReport): number {
  const eq = report.evidenceQualitySummary;
  if (eq && typeof eq.averageCredibility === "number") {
    return Math.max(0, Math.min(100, Math.round(eq.averageCredibility)));
  }
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