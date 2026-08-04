/**
 * claimReviewScript.test.ts — Plan P0-3 接入层 · 脚本注入 + 复制测试
 */

import { describe, expect, it } from "vitest";
import type { ClaimReviewJsonLd } from "./claimReview";
import {
  copyClaimReviewJsonLd,
  injectClaimReviewScript,
  richResultsTestUrl,
} from "./claimReviewScript";

function fakeJsonLd(): ClaimReviewJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    claimReviewed: "测试说法",
    reviewRating: {
      "@type": "Rating",
      ratingValue: 50,
      bestRating: 100,
      worstRating: 0,
      alternateName: "存疑",
    },
    author: { "@type": "Organization", name: "红鲱鱼与枪", url: "https://gun.yishuziyu.cn" },
    datePublished: "2026-07-25T00:00:00Z",
    itemReviewed: { "@type": "Claim", name: "测试说法" },
  };
}

function makeFakeDoc() {
  const elements: Array<{ id?: string; type?: string; textContent?: string; parentNode?: unknown }> = [];
  return {
    elements,
    head: {
      appendChild(el: { id?: string; type?: string; textContent?: string; parentNode?: unknown }) {
        elements.push(el);
        el.parentNode = elements;
      },
      querySelector(sel: string) {
        if (sel === "#gun-claim-review-ldjson") {
          return elements.find((e) => e.id === "gun-claim-review-ldjson") ?? null;
        }
        return null;
      },
    },
    getElementById(id: string) {
      return elements.find((e) => e.id === id) ?? null;
    },
    createElement(tag: string) {
      return { type: tag, id: "", textContent: "" };
    },
  };
}

describe("Plan P0-3 · injectClaimReviewScript", () => {
  it("首次注入：injected=true + replaced=false", () => {
    const doc = makeFakeDoc();
    const r = injectClaimReviewScript(fakeJsonLd(), doc as never);
    expect(r.injected).toBe(true);
    expect(r.replaced).toBe(false);
  });

  it("二次注入：replaced=true（single tag 闸门）", () => {
    const doc = makeFakeDoc();
    injectClaimReviewScript(fakeJsonLd(), doc as never);
    const r = injectClaimReviewScript(fakeJsonLd(), doc as never);
    expect(r.injected).toBe(true);
    expect(r.replaced).toBe(true);
  });

  it("注入的 script type 必须是 application/ld+json", () => {
    const doc = makeFakeDoc();
    injectClaimReviewScript(fakeJsonLd(), doc as never);
    expect(doc.elements[0].type).toBe("application/ld+json");
  });

  it("注入的 script id = gun-claim-review-ldjson", () => {
    const doc = makeFakeDoc();
    injectClaimReviewScript(fakeJsonLd(), doc as never);
    expect(doc.elements[0].id).toBe("gun-claim-review-ldjson");
  });

  it("textContent 是合法 JSON（不含裸 </script）", () => {
    const doc = makeFakeDoc();
    const json = fakeJsonLd();
    json.claimReviewed = "</script><img onerror>";
    injectClaimReviewScript(json, doc as never);
    expect(doc.elements[0].textContent).not.toContain("</script>");
    expect(doc.elements[0].textContent).toContain("<\\/script");
    // 解析仍合法
    expect(() => JSON.parse(doc.elements[0].textContent!)).not.toThrow();
  });

  it("doc 为 null（SSR）→ 静默不报错", () => {
    const r = injectClaimReviewScript(fakeJsonLd(), null);
    expect(r.injected).toBe(false);
    expect(r.replaced).toBe(false);
  });
});

describe("Plan P0-3 · copyClaimReviewJsonLd", () => {
  it("无 navigator → 返回 false", async () => {
    const orig = (globalThis as { navigator?: unknown }).navigator;
    delete (globalThis as { navigator?: unknown }).navigator;
    const ok = await copyClaimReviewJsonLd(fakeJsonLd());
    expect(ok).toBe(false);
    (globalThis as { navigator?: unknown }).navigator = orig;
  });
});

describe("Plan P0-3 · richResultsTestUrl", () => {
  it("返回 Google Rich Results 测试 URL", () => {
    const url = richResultsTestUrl(fakeJsonLd());
    expect(url).toContain("search.google.com/test/rich-results");
  });
});