/**
 * 显式分享验收（docs/evals/2026-09-11-share-tokens.md）。
 */
import { describe, expect, it } from "vitest";
import { buildPublicProjection, buildSharedPageHtml, createShareStore, hashShareToken } from "./shareHandlers.js";
import type { CaseEntry } from "./caseStore.js";

function entry(overrides: Partial<CaseEntry> = {}): CaseEntry {
  return {
    caseId: "case-1",
    claim: "隔夜菜会致癌",
    report: {
      conclusion: "原句过强。",
      checkedAt: "2026-09-11T10:00:00.000Z",
      investigation: {
        claims: [{ text: "隔夜菜会直接致癌" }],
        sources: [{ title: "辟谣平台", url: "https://example.org/a" }],
      },
    } as never,
    claimReview: { "@type": "ClaimReview", claimReviewed: "隔夜菜会致癌" } as never,
    credibilityScore: 42,
    createdAt: 1_760_000_000_000,
    ownerHash: "owner-secret-hash",
    feedback: [{ reason: "我不同意这个结论", createdAt: 1_760_000_100_000 }],
    ...overrides,
  };
}

describe("公开投影白名单", () => {
  it("只带白名单字段，ownerHash 与 feedback 一定不在", () => {
    const projection = buildPublicProjection(entry());
    expect(Object.keys(projection).sort()).toEqual(
      ["caseId", "checkedAt", "claim", "claimReview", "createdAt", "credibilityScore", "report"].sort()
    );
    const dumped = JSON.stringify(projection);
    expect(dumped).not.toContain("owner-secret-hash");
    expect(dumped).not.toContain("我不同意这个结论");
  });

  it("递归丢掉名字像秘密的键：将来 report 里多了字段也默认不出去", () => {
    const projection = buildPublicProjection(
      entry({
        report: {
          conclusion: "结论",
          debugTrace: ["内部步骤"],
          systemPrompt: "你是核查员",
          nested: { apiKey: "sk-live-xxx", memoryRecall: { a: 1 }, keep: "这个可以出去" },
          list: [{ email: "a@b.c", title: "保留" }],
        } as never,
      })
    );
    const dumped = JSON.stringify(projection);
    expect(dumped).not.toContain("内部步骤");
    expect(dumped).not.toContain("你是核查员");
    expect(dumped).not.toContain("sk-live");
    expect(dumped).not.toContain("a@b.c");
    expect(dumped).toContain("这个可以出去");
    expect(dumped).toContain("保留");
    expect(dumped).toContain("结论");
  });
});

describe("令牌", () => {
  it("库里只存哈希，明文令牌不落库", () => {
    const store = createShareStore(null);
    const created = store.create(entry());
    expect(created.shareId.length).toBeGreaterThan(20);
    expect(hashShareToken(created.shareId)).not.toBe(created.shareId);
    // 用明文能读到
    expect(store.read(created.shareId)?.caseId).toBe("case-1");
    // 用哈希当令牌读不到（说明查的是哈希，不是明文）
    expect(store.read(hashShareToken(created.shareId))).toBeNull();
  });

  it("令牌不可由 caseId 猜出：两次创建拿到的链接不同", () => {
    const store = createShareStore(null);
    const a = store.create(entry());
    const b = store.create(entry());
    expect(a.shareId).not.toBe(b.shareId);
    expect(a.shareId).not.toContain("case-1");
  });

  it("撤销之后读不到；再撤一次幂等", () => {
    const store = createShareStore(null);
    const created = store.create(entry());
    expect(store.read(created.shareId)).not.toBeNull();
    expect(store.revoke(created.shareId)).toEqual({ ok: true, alreadyRevoked: false });
    expect(store.read(created.shareId)).toBeNull();
    expect(store.revoke(created.shareId)).toEqual({ ok: true, alreadyRevoked: true });
  });

  it("过期的分享读不到", () => {
    const store = createShareStore(null);
    const created = store.create(entry(), { now: 1_000 });
    expect(store.read(created.shareId, 1_000 + 31 * 86_400_000)).toBeNull();
    expect(store.read(created.shareId, 1_000 + 29 * 86_400_000)).not.toBeNull();
  });

  it("撤销后不再出现在主人的有效分享列表里", () => {
    const store = createShareStore(null);
    const a = store.create(entry());
    const b = store.create(entry());
    expect(store.listActive("case-1")).toHaveLength(2);
    store.revoke(a.shareId);
    const active = store.listActive("case-1");
    expect(active).toHaveLength(1);
    expect(active[0]!.shareId).toBe(hashShareToken(b.shareId));
  });
});

describe("公开页", () => {
  it("读不到时只有一种 404 说法，且标 noindex", () => {
    const html = buildSharedPageHtml("nope", null);
    expect(html).toContain("分享链接不可用");
    expect(html).toContain("noindex");
    // 不区分不存在 / 已撤销 / 已过期
    expect(html).not.toContain("已撤销的链接");
  });

  it("渲染投影里的结论、问题与材料，且转义用户文本", () => {
    const html = buildSharedPageHtml(
      "tok",
      buildPublicProjection(entry({ claim: "<script>alert(1)</script>隔夜菜会致癌" }))
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("原句过强。");
    expect(html).toContain("隔夜菜会直接致癌");
    expect(html).toContain("https://example.org/a");
    expect(html).toContain("原调查时间");
  });
});
