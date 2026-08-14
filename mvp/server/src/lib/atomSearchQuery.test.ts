import { describe, expect, it } from "vitest";
import {
  boundTinyRumorVerdict,
  buildAtomSearchQueries,
  looksLikePlanOrPrediction,
  mergeParallelSearchPayloads,
} from "./atomSearchQuery";

describe("atomSearchQuery", () => {
  it("普通流传句附带辟谣检索，不丢掉原句", () => {
    const q = buildAtomSearchQueries("甘南所有景点一律免费");
    expect(q[0]).toBe("甘南所有景点一律免费");
    expect(q[1]).toMatch(/辟谣/);
    expect(q).toHaveLength(2);
  });

  it("电瓶车口语短句会加境外P图通报查询", () => {
    const q = buildAtomSearchQueries("我说我的电瓶车叫谁偷走了，原来送给非洲人去了");
    expect(q[0]).toMatch(/电瓶车被偷至境外|电瓶车/);
    expect(q.some((item) => item.includes("非洲") && item.includes("辟谣"))).toBe(true);
  });

  it("将/要类规划句检索规划批复，不因动词跳过", () => {
    expect(looksLikePlanOrPrediction("新疆喀什要建地铁")).toBe(true);
    const q = buildAtomSearchQueries("新疆喀什要建地铁");
    expect(q[1]).toMatch(/规划/);
    expect(q[1]).toMatch(/批复/);
  });

  it("P图侮辱短句先搜警方通报，不把「是不是真的」当检索主句", () => {
    const q = buildAtomSearchQueries("群里那张P图配的侮辱性文字说的是真的");
    expect(q[0]).toMatch(/P图/);
    expect(q[0]).toMatch(/警方通报/);
    expect(q[0]).not.toMatch(/是真的/);
  });

  it("短视频出轨短句先搜不实言论通报", () => {
    const q = buildAtomSearchQueries("短视频里说的某某婚内出轨是真的");
    expect(q[0]).toMatch(/出轨/);
    expect(q[0]).toMatch(/警方通报|不实/);
  });

  it("合并多路检索时按 URL 去重并保留可点开链接", () => {
    const merged = mergeParallelSearchPayloads("甘南景区免票", [
      {
        answer: "a1",
        model: "360",
        sources: [{ url: "https://www.piyao.org.cn/a", title: "辟谣", snippet: "假" }],
      },
      {
        answer: "a2",
        model: "tavily",
        sources: [
          { url: "https://www.piyao.org.cn/a", title: "dup" },
          { url: "https://www.gscn.com.cn/b", title: "文旅局", snippet: "从未发布" },
        ],
      },
    ]);
    expect((merged.sources as Array<{ url: string }>).map((s) => s.url)).toEqual([
      "https://www.piyao.org.cn/a",
      "https://www.gscn.com.cn/b",
    ]);
    expect(String(merged.contradictQuery)).toMatch(/辟谣/);
  });

  it("对题辟谣页排在零重叠的今日辟谣合集前面", () => {
    const merged = mergeParallelSearchPayloads("电瓶车被偷送到非洲", [
      {
        sources: [
          { url: "https://sti.xizang.gov.cn/jrpy", title: "用OpenClaw登录微信被刷走600块不实", snippet: "今日辟谣" },
          { url: "https://www.piyao.org.cn/hefei", title: "合肥警方：P图编造电瓶车被偷至非洲", snippet: "不实信息 辟谣" },
        ],
      },
    ]);
    expect((merged.sources as Array<{ url: string }>)[0].url).toBe("https://www.piyao.org.cn/hefei");
  });

  it("出轨短句把合肥警方典型案例排在无关今日辟谣前面", () => {
    const merged = mergeParallelSearchPayloads("短视频里说的某某婚内出轨是真的", [
      {
        sources: [
          { url: "https://news.example/openclaw", title: "用OpenClaw登录微信被刷走600块不实", snippet: "今日辟谣" },
          { url: "https://www.piyao.org.cn/hefei", title: "安徽合肥警方公布3起网络谣言典型案例", snippet: "短视频散布婚内出轨不实言论" },
        ],
      },
    ]);
    expect((merged.sources as Array<{ url: string }>)[0].url).toBe("https://www.piyao.org.cn/hefei");
  });

  it("对题辟谣且无对题支持时把短谣收成不能信", () => {
    expect(
      boundTinyRumorVerdict("电瓶车被偷送到非洲", [
        { title: "合肥警方：P图编造电瓶车被偷至非洲", snippet: "不实 辟谣", url: "https://www.piyao.org.cn/x" },
        { title: "用OpenClaw登录微信被刷走600块不实", snippet: "今日辟谣", url: "https://gov.example/jrpy" },
      ])
    ).toBe("false");
  });
});
