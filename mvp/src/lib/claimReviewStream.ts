/**
 * claimReviewStream.ts — Plan P0-3 接入层 + Plan Item 2 URL 路由 · 客户端 SSE 集成
 *
 * 桥接 orchestrator SSE complete 事件 → injectClaimReviewScript。
 * 同时处理 case_saved 事件（Plan Item 2 URL 路由），返回 caseUrl 供 UI 使用。
 * 纯逻辑：接收事件 + 调 inject 函数。UI 组件 (ClaimReviewBadge) 调它即可。
 */

import { injectClaimReviewScript } from "./claimReviewScript";
import type { ClaimReviewJsonLd } from "./claimReview";

export interface StreamCompleteEvent {
  type: "complete";
  /** 来自 server /api/agent/orchestrate-stream（Plan P0-3 接入层） */
  claimReview?: ClaimReviewJsonLd;
  [k: string]: unknown;
}

export interface StreamCaseSavedEvent {
  type: "case_saved";
  caseId?: string;
  caseUrl?: string;
  [k: string]: unknown;
}

/**
 * 处理 orchestrator SSE complete 事件。
 * 收到 claimReview 字段时触发 DOM 注入；缺失则静默（不破坏既有 flow）。
 */
export function handleStreamComplete(
  event: StreamCompleteEvent,
): { injected: boolean; replaced: boolean; reason: string } {
  if (event.type !== "complete") {
    return { injected: false, replaced: false, reason: "not-complete-event" };
  }
  if (!event.claimReview) {
    return { injected: false, replaced: false, reason: "no-claim-review-field" };
  }
  const r = injectClaimReviewScript(event.claimReview);
  return {
    injected: r.injected,
    replaced: r.replaced,
    reason: r.injected ? "ok" : "no-document",
  };
}

/**
 * 处理 case_saved 事件（Plan Item 2 · URL 路由）。
 * 返回绝对 URL 供 UI 展示 + 复制。
 */
export function handleCaseSaved(
  event: StreamCaseSavedEvent,
  baseUrl: string = typeof window !== "undefined" ? window.location.origin : "https://gun.yishuziyu.cn",
): { caseId: string | null; caseUrl: string | null; reason: string } {
  if (event.type !== "case_saved") {
    return { caseId: null, caseUrl: null, reason: "not-case-saved-event" };
  }
  if (!event.caseId) {
    return { caseId: null, caseUrl: null, reason: "no-case-id" };
  }
  const relativeUrl = event.caseUrl ?? `/r/${event.caseId}`;
  const absoluteUrl = relativeUrl.startsWith("http") ? relativeUrl : `${baseUrl}${relativeUrl}`;
  return { caseId: event.caseId, caseUrl: absoluteUrl, reason: "ok" };
}

/**
 * UI 复制按钮的文本生成。
 */
export function buildCopyButtonText(): string {
  return "复制 JSON-LD";
}

export function buildCopySuccessText(): string {
  return "已复制到剪贴板";
}