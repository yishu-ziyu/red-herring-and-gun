import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  hardFilterSources,
  dedupeSources,
  topKSources,
  filterAtomSources,
  scoreSource,
  DEFAULT_TOP_K,
} from "./retrievalFilter";

describe("canonicalizeUrl", () => {
  it("去 utm 与 hash，统一 host 小写", () => {
    const a = canonicalizeUrl("HTTPS://Example.COM/path/?utm_source=x&b=1#frag");
    const b = canonicalizeUrl("https://example.com/path?b=1");
    expect(a).toBe(b);
  });

  it("非 http(s) 返回 null", () => {
    expect(canonicalizeUrl("ftp://x.com/a")).toBeNull();
    expect(canonicalizeUrl("not-a-url")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });
});

describe("hardFilterSources A2 A4", () => {
  it("无 URL 或非 http 丢弃", () => {
    const out = hardFilterSources([
      { url: "", title: "t", snippet: "s" },
      { url: "javascript:alert(1)", title: "t", snippet: "s" },
      { url: "https://ok.example/a", title: "ok", snippet: "body" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("ok.example");
  });

  it("标题与摘要皆空丢弃", () => {
    const out = hardFilterSources([
      { url: "https://a.example/x", title: "", snippet: "" },
      { url: "https://b.example/x", title: "t", snippet: "" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("b.example");
  });

  it("denylist 主机丢弃", () => {
    const out = hardFilterSources(
      [
        { url: "https://bit.ly/abc", title: "short", snippet: "x" },
        { url: "https://news.example/a", title: "n", snippet: "y" },
      ],
      ["bit.ly"]
    );
    expect(out.map((s) => s.url)).toEqual(["https://news.example/a"]);
  });
});

describe("dedupeSources A1", () => {
  it("同一规范化 URL 只留一条，优先高可信", () => {
    const out = dedupeSources([
      {
        url: "https://ex.com/a?utm_source=1",
        title: "A",
        snippet: "short",
        credibility: "低",
      },
      {
        url: "https://ex.com/a",
        title: "A",
        snippet: "much longer snippet here for prefer",
        credibility: "高",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].credibility).toBe("高");
  });
});

describe("topKSources A3", () => {
  it("超过 K 时截断到 DEFAULT_TOP_K", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      url: `https://site${i}.example/p`,
      title: `T${i}`,
      snippet: "x".repeat(100),
      credibility: i === 0 ? "高" : "中",
      providerRank: i,
    }));
    const out = topKSources(many, DEFAULT_TOP_K);
    expect(out.length).toBe(DEFAULT_TOP_K);
    // rank 0 高可信应排前
    expect(out[0].url).toContain("site0");
  });
});

describe("filterAtomSources pipeline", () => {
  it("S1→S2→S3 串起来并给出 meta", () => {
    const { sources, meta } = filterAtomSources(
      [
        { url: "", title: "bad", snippet: "x" },
        { url: "https://a.example/1?utm_source=z", title: "A", snippet: "hello world enough text", credibility: "中", providerRank: 1 },
        { url: "https://a.example/1", title: "A", snippet: "hello world enough text more", credibility: "高", providerRank: 0 },
        { url: "https://b.example/2", title: "B", snippet: "yy", credibility: "低", providerRank: 2 },
        { url: "https://c.example/3", title: "", snippet: "", credibility: "中", providerRank: 3 },
      ],
      { topK: 5 }
    );
    expect(meta.before).toBe(5);
    expect(meta.afterFilter).toBeLessThan(meta.before);
    expect(meta.afterDedupe).toBeLessThanOrEqual(meta.afterFilter);
    expect(meta.afterTopK).toBe(sources.length);
    expect(sources.every((s) => /^https?:\/\//.test(s.url))).toBe(true);
    // a.example 去重为 1
    expect(sources.filter((s) => s.url.includes("a.example"))).toHaveLength(1);
  });

  it("scoreSource 高可信摘要长 > 低可信", () => {
    const hi = scoreSource({
      url: "https://www.nih.gov/a",
      title: "NIH",
      snippet: "x".repeat(100),
      credibility: "高",
      providerRank: 0,
    });
    const lo = scoreSource({
      url: "https://weibo.com/a",
      title: "wb",
      snippet: "x",
      credibility: "低",
      providerRank: 5,
    });
    expect(hi).toBeGreaterThan(lo);
  });
});
