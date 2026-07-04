import { describe, it, expect } from "vitest";
import { foldLineage, type LlmKeywordClient } from "./sourceLineage";
import type { SearchResultSource } from "./schemas";

function src(overrides: Partial<SearchResultSource>): SearchResultSource {
  return {
    id: "src-" + Math.random().toString(36).slice(2),
    title: "untitled",
    url: "https://example.com/article",
    snippet: "",
    domain: "example.com",
    sourceType: "媒体",
    ...overrides,
  };
}

describe("foldLineage", () => {
  it("returns empty result for empty input", async () => {
    const r = await foldLineage([]);
    expect(r.groups).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.stats.input).toBe(0);
  });

  it("groups same-hostname sources together when both have recent publishedAt (tier 2)", async () => {
    const now = Date.now();
    const sources = [
      src({
        url: "https://news.yahoo.com/a",
        domain: "news.yahoo.com",
        title: "AP: Some news",
        publishedAt: new Date(now - 1000 * 60 * 60).toISOString(),
      }),
      src({
        url: "https://news.yahoo.com/b",
        domain: "news.yahoo.com",
        title: "AP: Some news reblog",
        publishedAt: new Date(now - 1000 * 60 * 30).toISOString(),
      }),
      src({
        url: "https://reuters.com/x",
        domain: "reuters.com",
        title: "Reuters exclusive",
        publishedAt: new Date(now - 1000 * 60 * 60 * 12).toISOString(),
      }),
    ];
    const r = await foldLineage(sources);
    // Yahoo 两篇折为一组,reuters 单独
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].memberUrls.length).toBe(2);
    expect(r.unresolved.length).toBe(1);
    expect(r.unresolved[0].url).toBe("https://reuters.com/x");
  });

  it("leaves sources without publishedAt as unresolved at tier 2", async () => {
    const sources = [
      src({ url: "https://news.yahoo.com/a", domain: "news.yahoo.com", title: "t" }),
      src({ url: "https://news.yahoo.com/b", domain: "news.yahoo.com", title: "t" }),
    ];
    const r = await foldLineage(sources);
    expect(r.groups.length).toBe(0);
    expect(r.unresolved.length).toBe(2);
  });

  it("uses 72h repost heuristic to merge", async () => {
    const now = Date.now();
    const sources = [
      src({
        url: "https://news.sina.com.cn/a",
        domain: "news.sina.com.cn",
        title: "t",
        publishedAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days ago
      }),
      src({
        url: "https://news.sina.com.cn/b",
        domain: "news.sina.com.cn",
        title: "t",
        publishedAt: new Date(now - 1000 * 60 * 60 * 24 * 1).toISOString(), // 1 day ago
      }),
    ];
    const r = await foldLineage(sources);
    // 5 天差异 → 不应合并
    expect(r.groups.length).toBe(0);
    expect(r.unresolved.length).toBe(2);
  });

  it("LLM cluster path (tier 1) folds cross-host with same outlet keyword", async () => {
    const sources = [
      src({ url: "https://news.sina.com.cn/x", domain: "news.sina.com.cn", title: "新华社稿" }),
      src({ url: "https://qq.com/y", domain: "qq.com", title: "新华社稿转载" }),
      src({ url: "https://reuters.com/z", domain: "reuters.com", title: "Reuters original" }),
    ];
    const stubClient: LlmKeywordClient = {
      clusterByKeywords: async (items) => {
        // 两个新华社稿折为一组
        return [
          [items[0].url, items[1].url],
          [items[2].url],
        ];
      },
    };
    const r = await foldLineage(sources, { llmClient: stubClient });
    expect(r.stats.llmCalls).toBe(1);
    expect(r.groups.length).toBe(2);
    const fold = r.groups.find((g) => g.memberUrls.length === 2);
    expect(fold).toBeDefined();
    expect(fold!.detectionMethod).toBe("llm_keyword");
  });

  it("LLM failure falls back to URL hostname tier 2 (with timestamps)", async () => {
    const now = Date.now();
    const sources = [
      src({
        url: "https://news.yahoo.com/a",
        domain: "news.yahoo.com",
        title: "t",
        publishedAt: new Date(now - 1000 * 60 * 60).toISOString(),
      }),
      src({
        url: "https://news.yahoo.com/b",
        domain: "news.yahoo.com",
        title: "t",
        publishedAt: new Date(now - 1000 * 60 * 30).toISOString(),
      }),
    ];
    const failingClient: LlmKeywordClient = {
      clusterByKeywords: async () => {
        throw new Error("LLM unavailable");
      },
    };
    const r = await foldLineage(sources, { llmClient: failingClient });
    expect(r.stats.llmFailures).toBe(1);
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].detectionMethod).toBe("url_hostname");
  });

  it("LLM returning null falls back without throwing", async () => {
    const sources = [
      src({ url: "https://x.com/a", domain: "x.com", title: "t" }),
    ];
    const stubClient: LlmKeywordClient = {
      clusterByKeywords: async () => null,
    };
    const r = await foldLineage(sources, { llmClient: stubClient });
    expect(r.stats.llmCalls).toBe(1);
    expect(r.stats.llmFailures).toBe(0);
    expect(r.unresolved.length).toBe(1);
  });

  it("skips LLM when sources exceed maxLlmItems", async () => {
    const sources = Array.from({ length: 30 }, (_, i) =>
      src({ url: `https://x.com/${i}`, domain: "x.com", title: `t${i}` }),
    );
    let llmCalled = false;
    const stubClient: LlmKeywordClient = {
      clusterByKeywords: async () => {
        llmCalled = true;
        return [];
      },
    };
    await foldLineage(sources, { llmClient: stubClient, maxLlmItems: 5 });
    expect(llmCalled).toBe(false);
  });

  it("handles malformed URL gracefully", async () => {
    const sources = [
      src({ url: "not-a-url", domain: "??", title: "t" }),
      src({ url: "https://valid.com/x", domain: "valid.com", title: "t" }),
    ];
    const r = await foldLineage(sources);
    // 不抛错
    expect(r.stats.input).toBe(2);
    // malformed URL 单独,valid 单独
    expect(r.unresolved.length).toBe(2);
  });

  it("picks canonical = earliest publishedAt in folded cluster", async () => {
    const now = Date.now();
    const sources = [
      src({
        url: "https://news.com/b",
        domain: "news.com",
        title: "B",
        publishedAt: new Date(now - 1000 * 60 * 60).toISOString(),
      }),
      src({
        url: "https://news.com/a",
        domain: "news.com",
        title: "A",
        publishedAt: new Date(now - 1000 * 60 * 30).toISOString(),
      }),
    ];
    const r = await foldLineage(sources);
    expect(r.groups.length).toBe(1);
    // Source A (now-30min) is later; Source B (now-60min) is earlier → canonical = b
    expect(r.groups[0].canonicalUrl).toBe("https://news.com/b");
  });
});