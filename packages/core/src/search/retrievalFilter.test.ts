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

  it("标题含辟谣的来源得分更高", () => {
    const rumor = scoreSource({
      url: "https://www.piyao.org.cn/a",
      title: "官方辟谣：该说法不实",
      snippet: "文旅局声明从未发布",
      providerRank: 2,
    });
    const generic = scoreSource({
      url: "https://you.ctrip.com/a",
      title: "甘南旅游攻略",
      snippet: "景点推荐大全",
      providerRank: 2,
    });
    expect(rumor).toBeGreaterThan(generic);
  });

  it("piyao.org.cn 比同标题的旅游站得分更高", () => {
    const official = scoreSource({
      url: "https://www.piyao.org.cn/a",
      title: "三起典型网络谣言案例",
      snippet: "合肥警方通报",
      providerRank: 3,
    });
    const travel = scoreSource({
      url: "https://you.ctrip.com/a",
      title: "三起典型网络谣言案例",
      snippet: "合肥警方通报",
      providerRank: 3,
    });
    expect(official).toBeGreaterThan(travel);
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

describe("一期反垃圾排序", () => {
  it("合集页沉底、一手出处浮上", async () => {
    const { filterAtomSources } = await import("./retrievalFilter");
    const { sources } = filterAtomSources(
      [
        { url: "https://news.example/roundup", title: "本周谣言盘点合集", snippet: "各类传言汇总大全", credibility: "中", providerRank: 0 },
        { url: "https://www.piyao.org.cn/x", title: "官方辟谣：该说法不实", snippet: "文旅局声明从未发布", credibility: "高", providerRank: 2 },
      ],
      { topK: 5 }
    );
    expect(sources[0].url).toContain("piyao.org.cn");
  });

  it("同站只留 1-2 条且支撑/反证各至少留一条", async () => {
    const { filterAtomSources } = await import("./retrievalFilter");
    const { sources, meta } = filterAtomSources(
      [
        { url: "https://same.example/a", title: "景点推荐", snippet: "好玩", credibility: "中", providerRank: 0 },
        { url: "https://same.example/b", title: "游玩攻略", snippet: "推荐", credibility: "中", providerRank: 1 },
        { url: "https://same.example/c", title: "官方辟谣不实", snippet: "系编造", credibility: "中", providerRank: 2 },
        { url: "https://other.example/d", title: "官方辟谣：该说法不实", snippet: "声明从未发布", credibility: "高", providerRank: 3 },
      ],
      { topK: 5, perHostCap: 2 }
    );
    const same = sources.filter((s) => s.url.includes("same.example"));
    expect(same.length).toBeLessThanOrEqual(2);
    const stances = new Set(
      same.map((s) => (/辟谣|不实|假消息|谣言|官方声明|从未发布|系编造/.test(`${s.title} ${s.snippet}`) ? "refute" : "support"))
    );
    expect(stances.has("refute")).toBe(true);
    expect(stances.has("support")).toBe(true);
    expect(meta.afterHostCap).toBeLessThanOrEqual(meta.afterDedupe);
  });

  it("时间敏感加新度：其余相同更新的排前", async () => {
    const { scoreSource } = await import("./retrievalFilter");
    const base = { url: "https://a.example/x", title: "官方通报", snippet: "事件进展详情说明内容补足长度让摘要达标", credibility: "中", providerRank: 1 };
    const fresh = scoreSource({ ...base, publishedAt: new Date(Date.now() - 86400000).toISOString() });
    const stale = scoreSource({ ...base, publishedAt: "2020-01-01T00:00:00Z" });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("过程可回看：hop trace 带四数 + 命中段", async () => {
    const { filterAtomSources, buildHopTrace } = await import("./retrievalFilter");
    const { sources, meta } = filterAtomSources(
      [{ url: "https://a.example/1", title: "官方辟谣", snippet: "甘南免票说法不实", credibility: "高", providerRank: 0 }],
      { topK: 5 }
    );
    const trace = buildHopTrace({ atom: "甘南免票", issuedQueries: ["甘南免票", "甘南免票 辟谣 核实"], meta, sources });
    expect(trace.before).toBe(1);
    expect(trace.afterTopK).toBe(sources.length);
    expect(trace.issuedQueries).toHaveLength(2);
    expect(trace.chunks[0].chunk.length).toBeGreaterThan(0);
  });
});
