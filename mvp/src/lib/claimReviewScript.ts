/**
 * claimReviewScript.ts — Plan P0-3 接入层 · UI 脚本注入 + 复制按钮
 *
 * 纯逻辑层（不依赖 React DOM），便于测试。
 * UI 组件 ClaimReviewBadge 调用这些函数。
 */

import type { ClaimReviewJsonLd } from "./claimReview";

const SCRIPT_ID = "gun-claim-review-ldjson";

/**
 * 生成安全的 script textContent（JSON 字符串 + </script 转义）。
 */
export function buildSafeScriptText(jsonLd: ClaimReviewJsonLd): string {
  return JSON.stringify(jsonLd).replace(/<\/script/gi, "<\\/script");
}

/**
 * 向 document.head 注入 <script type="application/ld+json">。
 *
 * 闸门：single tag — 同 ID 已存在则替换（不重复注入）。
 * 简化版：依赖 getElementById 检测存在性，不直接调用 parentNode.removeChild
 * （避免 fake doc 必须实现完整 DOM 树结构）。
 */
export function injectClaimReviewScript(
  jsonLd: ClaimReviewJsonLd,
  doc: { head: { appendChild(el: unknown): void; querySelector(sel: string): unknown; removeChild?(el: unknown): void }; getElementById(id: string): unknown; createElement(tag: string): unknown } | null = typeof document !== "undefined" ? document : null,
): { injected: boolean; replaced: boolean } {
  if (!doc) return { injected: false, replaced: false };

  const existing = doc.getElementById(SCRIPT_ID) as unknown;
  if (existing && typeof doc.head.removeChild === "function") {
    doc.head.removeChild(existing);
  }

  const script = (doc as unknown as { createElement(tag: string): { type: string; textContent: string; id: string } }).createElement("script");
  script.type = "application/ld+json";
  script.id = SCRIPT_ID;
  script.textContent = buildSafeScriptText(jsonLd);
  doc.head.appendChild(script);

  return { injected: true, replaced: !!existing };
}

/**
 * 复制 JSON-LD 到剪贴板。
 */
export async function copyClaimReviewJsonLd(jsonLd: ClaimReviewJsonLd): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(JSON.stringify(jsonLd, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成 Rich Results Test 用的预览 URL（Google 验证器）。
 */
export function richResultsTestUrl(jsonLd: ClaimReviewJsonLd): string {
  // 直接 base64 encode 后拼接，Google 官方支持任意 URL 提供 JSON-LD
  const json = JSON.stringify(jsonLd);
  if (typeof btoa !== "undefined") {
    return `https://search.google.com/test/rich-results?view=preview&code=${btoa(unescape(encodeURIComponent(json)))}`;
  }
  return `https://search.google.com/test/rich-results`;
}