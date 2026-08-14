/**
 * caseStore.test.ts — Plan Item 2 · 报告 URL 永久路由
 *
 * 关键校验：
 *   - generateCaseId 产出 8 字符 base36
 *   - putCase + getCase 双向一致
 *   - LRU 超过 1000 时按 createdAt 淘汰最旧
 *   - 同 caseId 二次 putCase 覆盖（更新 caseId 不变）
 *   - listCases 按 createdAt 降序
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  caseCount,
  clearCases,
  generateCaseId,
  getCase,
  listCases,
  putCase,
  type CaseEntry,
} from "./caseStore";
import type { FinalReport } from "./schemas";
import type { ClaimReviewJsonLd } from "./claimReview";

function makeReport(claim: string): FinalReport {
  return {
    originalClaim: claim,
    overallStatus: "原句过强",
    allowedConclusion: "现有公开材料不足以按原强度成立",
    claimDiagnosis: { originalClaim: claim, subclaims: [], routes: [], searchPlans: [], diagnosis: "证据不足" },
    subclaimStatuses: [],
    evidenceChain: [],
    doNotInfer: [],
    rewrittenClaim: { cautious: "x", publicFacing: "y", researchMemo: "z" },
    nextEvidenceNeeded: [],
  };
}

function makeJsonLd(): ClaimReviewJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    claimReviewed: "test",
    reviewRating: { "@type": "Rating", ratingValue: 50, bestRating: 100, worstRating: 0, alternateName: "存疑" },
    author: { "@type": "Organization", name: "红鲱鱼与枪", url: "https://gun.yishuziyu.cn" },
    datePublished: "2026-07-25T00:00:00Z",
  };
}

function makeEntry(claim: string, score = 50): Omit<CaseEntry, "caseId" | "createdAt"> {
  return {
    claim,
    report: makeReport(claim),
    claimReview: makeJsonLd(),
    credibilityScore: score,
  };
}

describe("Plan Item 2 · caseStore", () => {
  beforeEach(() => {
    clearCases();
  });

  it("generateCaseId 产出 8 字符 base36", () => {
    const id = generateCaseId("测试", 1000);
    expect(id.length).toBe(8);
    expect(id).toMatch(/^[0-9a-z]{8}$/);
  });

  it("不同输入产出不同 caseId", () => {
    const a = generateCaseId("a", 1000);
    const b = generateCaseId("b", 1000);
    expect(a).not.toBe(b);
  });

  it("同输入（除随机数外）也大概率不同", () => {
    const a = generateCaseId("a", 1000);
    const b = generateCaseId("a", 1000);
    expect(a === b).toBe(false); // 依赖 Math.random
  });

  it("putCase + getCase 双向一致", () => {
    const e = putCase(makeEntry("test claim"));
    const got = getCase(e.caseId);
    expect(got).not.toBeNull();
    expect(got!.claim).toBe("test claim");
    expect(got!.caseId).toBe(e.caseId);
  });

  it("不存在的 caseId 返回 null", () => {
    expect(getCase("nonexistent")).toBeNull();
  });

  it("同 caseId 二次 putCase 覆盖（更新 caseId 不变）", () => {
    const e1 = putCase(makeEntry("first", 30));
    const e2 = putCase({ ...makeEntry("updated", 80), caseId: e1.caseId });
    expect(e2.caseId).toBe(e1.caseId);
    expect(getCase(e1.caseId)!.claim).toBe("updated");
    expect(getCase(e1.caseId)!.credibilityScore).toBe(80);
  });

  it("listCases 可按 ownerHash 过滤", () => {
    putCase({ ...makeEntry("a"), ownerHash: "hash-a" });
    putCase({ ...makeEntry("b"), ownerHash: "hash-b" });
    putCase(makeEntry("anon"));
    expect(listCases(10, "hash-a").map((c) => c.claim)).toEqual(["a"]);
    expect(listCases(10, "hash-b").map((c) => c.claim)).toEqual(["b"]);
  });

  it("listCases 按 createdAt 降序", async () => {
    putCase(makeEntry("a"));
    await new Promise((r) => setTimeout(r, 2));
    putCase(makeEntry("b"));
    await new Promise((r) => setTimeout(r, 2));
    putCase(makeEntry("c"));
    const list = listCases(10);
    expect(list.map((c) => c.claim)).toEqual(["c", "b", "a"]);
  });

  it("caseCount 准确反映存储数量", () => {
    expect(caseCount()).toBe(0);
    putCase(makeEntry("a"));
    putCase(makeEntry("b"));
    expect(caseCount()).toBe(2);
    clearCases();
    expect(caseCount()).toBe(0);
  });

  it("LRU 淘汰：超过 1000 时按插入顺序淘汰最旧", () => {
    // 插 1005 条，最旧 5 条应被淘汰
    for (let i = 0; i < 1005; i++) {
      putCase(makeEntry(`c${i}`));
    }
    expect(caseCount()).toBe(1000);
    // c0 ~ c4 应已被淘汰
    expect(listCases(2000).find((c) => c.claim === "c0")).toBeUndefined();
    // c1004 应保留
    expect(listCases(2000).find((c) => c.claim === "c1004")).toBeDefined();
  });
});