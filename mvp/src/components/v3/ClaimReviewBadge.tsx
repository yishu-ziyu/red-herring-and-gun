/**
 * ClaimReviewBadge.tsx — Plan P0-3 接入层 · UI 组件
 *
 * 渲染「ClaimReview 已发布」徽章 + 「复制 JSON-LD」按钮 + 「Google Rich Results Test」链接。
 * 组件挂载时自动调用 handleStreamComplete → injectClaimReviewScript，
 * 把 schema.org/ClaimReview JSON-LD 注入 <head>，让 Google 爬虫能读到。
 *
 * 设计：纯 React 组件，不引入额外依赖。
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import type { FinalReport } from "../../lib/schemas";
import { buildClaimReviewJsonLd } from "../../lib/claimReview";
import {
  copyClaimReviewJsonLd,
  injectClaimReviewScript,
  richResultsTestUrl,
} from "../../lib/claimReviewScript";

interface ClaimReviewBadgeProps {
  report: FinalReport;
  /** 可选 URL 路由（与 P2-2 报告 URL 路由集成） */
  reportUrl?: string;
}

type InjectState = "idle" | "injected" | "skipped" | "error";

export function ClaimReviewBadge({ report, reportUrl }: ClaimReviewBadgeProps) {
  const jsonLd = useMemo(
    () => buildClaimReviewJsonLd(report, { url: reportUrl }),
    [report, reportUrl],
  );
  const [injectState, setInjectState] = useState<InjectState>("idle");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareCopyState, setShareCopyState] = useState<"idle" | "copied" | "failed">("idle");

  // 挂载时注入 <script type="application/ld+json"> 到 <head>
  useEffect(() => {
    try {
      const r = injectClaimReviewScript(jsonLd);
      setInjectState(r.injected ? "injected" : "skipped");
    } catch {
      setInjectState("error");
    }
  }, [jsonLd]);

  const handleCopy = useCallback(async () => {
    const ok = await copyClaimReviewJsonLd(jsonLd);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  }, [jsonLd]);

  const handleRichResults = useCallback(() => {
    const url = richResultsTestUrl(jsonLd);
    window.open(url, "_blank", "noopener,noreferrer");
  }, [jsonLd]);

  const handleShareCopy = useCallback(async () => {
    if (!reportUrl) return;
    try {
      await navigator.clipboard.writeText(reportUrl);
      setShareCopyState("copied");
      setTimeout(() => setShareCopyState("idle"), 2000);
    } catch {
      setShareCopyState("failed");
      setTimeout(() => setShareCopyState("idle"), 2000);
    }
  }, [reportUrl]);

  return (
    <div className="claim-review-badge cinema-rise cinema-rise-d4" aria-label="ClaimReview 元数据">
      <div className="claim-review-badge-header">
        <span
          className={`claim-review-status claim-review-status--${injectState}`}
          data-testid="claim-review-status"
        >
          {injectState === "injected" ? "✓ ClaimReview 已发布" : injectState === "skipped" ? "○ 浏览器环境不支持" : "× 注入失败"}
        </span>
        <code className="claim-review-type">schema.org/ClaimReview</code>
      </div>
      {reportUrl ? (
        <div className="claim-review-share">
          <span className="claim-review-share-label">永久链接</span>
          <a
            className="claim-review-share-url"
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="claim-review-share-url"
          >
            {reportUrl}
          </a>
          <button
            type="button"
            className="claim-review-btn"
            onClick={handleShareCopy}
            aria-label="复制分享链接"
          >
            {shareCopyState === "copied" ? "已复制 ✓" : shareCopyState === "failed" ? "复制失败" : "复制链接"}
          </button>
        </div>
      ) : null}
      <div className="claim-review-badge-actions">
        <button
          type="button"
          className="claim-review-btn"
          onClick={handleCopy}
          aria-label="复制 JSON-LD"
        >
          {copyState === "copied" ? "已复制 ✓" : copyState === "failed" ? "复制失败" : "复制 JSON-LD"}
        </button>
        <button
          type="button"
          className="claim-review-btn claim-review-btn--secondary"
          onClick={handleRichResults}
          aria-label="Google Rich Results Test"
        >
          Google 验证 ↗
        </button>
      </div>
    </div>
  );
}