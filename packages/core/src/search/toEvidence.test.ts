import { describe, expect, it } from "vitest";
import { canonicalizeUrl, toEvidence } from "./toEvidence.js";

const SEARCH_PROVENANCE = { kind: "search" as const, query: "甘南免票" };

describe("canonicalizeUrl", () => {
  it("去掉 utm_* 追踪参数", () => {
    expect(canonicalizeUrl("https://example.com/a?utm_source=x&b=1")).toBe(
      canonicalizeUrl("https://example.com/a?b=1")
    );
  });

  it("去掉 fragment", () => {
    expect(canonicalizeUrl("https://example.com/a#section")).toBe("https://example.com/a");
  });

  it("折叠路径尾斜杠，根路径保留 /", () => {
    expect(canonicalizeUrl("https://example.com/a/")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("host 小写", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/a")).toBe("https://example.com/a");
  });

  it("去掉一层 m. 前缀", () => {
    expect(canonicalizeUrl("https://m.example.com/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://m.www.example.com/a")).toBe("https://www.example.com/a");
  });

  it("去掉一层 www. 前缀", () => {
    expect(canonicalizeUrl("https://www.example.com/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://www.m.example.com/a")).toBe("https://m.example.com/a");
  });

  it("非 http(s) 返回 null", () => {
    expect(canonicalizeUrl("ftp://example.com/a")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not-a-url")).toBeNull();
  });

  it("去掉默认端口", () => {
    expect(canonicalizeUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
  });
});

describe("toEvidence", () => {
  it("excerpt 按 code point 截 320 字，不截半个字", () => {
    const snippet = `${"你".repeat(319)}😀额外`;
    const ev = toEvidence({ url: "https://example.com/a", snippet }, SEARCH_PROVENANCE);
    expect(ev).not.toBeNull();
    expect([...ev!.excerpt]).toHaveLength(320);
    expect(ev!.excerpt.endsWith("😀")).toBe(true);
    expect(ev!.excerpt.includes("额")).toBe(false);
  });

  it("title 与 excerpt 解开实体并去掉标签", () => {
    const ev = toEvidence(
      {
        url: "https://example.com/bt",
        title: "Insect-Resistant&lt;italic&gt;Bt&lt;/italic&gt; Plants &amp; Bees",
        snippet: "It&#39;s&nbsp;a <b>field</b> trial",
      },
      SEARCH_PROVENANCE,
    );
    expect(ev).not.toBeNull();
    expect(ev!.title).toBe("Insect-ResistantBt Plants & Bees");
    expect(ev!.excerpt).toBe("It's a field trial");
    expect(ev!.excerpt).not.toMatch(/<[^>]*>/);
    expect(ev!.excerpt).not.toContain("&nbsp;");
    expect(ev!.excerpt).not.toContain("&#39;");
  });

  it("tier 为 unknown", () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const ev = toEvidence(
      { url: "https://example.com/a", snippet: "摘要" },
      SEARCH_PROVENANCE,
      now
    );
    expect(ev).not.toBeNull();
    expect(ev!.tier).toBe("unknown");
    expect(ev!.retrievedAt).toBe(now.toISOString());
    expect(ev!.host).toBe("example.com");
    expect("id" in ev!).toBe(false);
  });
});
