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

  it("带日期的具体句会多一路时间锚点查询", () => {
    const q = buildAtomSearchQueries(
      "马斯克表示 Grok 4.6 在 Cursor 中提供双倍用量，持续到 8 月 19 日"
    );
    expect(q[0]).toContain("Grok 4.6");
    expect(q.some((item) => /辟谣|官方/.test(item))).toBe(true);
    expect(q.some((item) => /8\s*月|19/.test(item))).toBe(true);
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q.length).toBeLessThanOrEqual(3);
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

  it("合并多路检索时按 URL 去重，并对多 query 列表做 RRF 再按题权重排", () => {
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

  it("截图句至少一路追原图出处，且带官方辟谣站点直查", () => {
    const q = buildAtomSearchQueries("群里那张截图说某地地铁已经开通");
    expect(q.some((item) => item.includes("原图") && item.includes("出处") && item.includes("首发"))).toBe(true);
    expect(q.length).toBeGreaterThanOrEqual(3);
    expect(q.some((item) => item.startsWith("site:piyao.org.cn"))).toBe(true);
    expect(q.length).toBeLessThanOrEqual(4);
  });

  it("聊天记录句同样追原图出处", () => {
    const q = buildAtomSearchQueries("聊天记录里说某地地铁已经开通");
    expect(q.some((item) => item.includes("原图") && item.includes("出处"))).toBe(true);
    expect(q.length).toBeLessThanOrEqual(3);
  });

  it("统计数字句至少一路追公报原始数据，不超过三路", () => {
    const q = buildAtomSearchQueries("某市去年 GDP 增长 8.5%");
    expect(q.some((item) => item.includes("公报") && item.includes("原始数据"))).toBe(true);
    expect(q.length).toBeLessThanOrEqual(3);
  });

  it("引语句至少一路追原话语境，并保住引号内原句", () => {
    const q = buildAtomSearchQueries("某官员在发布会上称「明年房价必跌」");
    expect(q.some((item) => item.includes("原话") && item.includes("语境") && item.includes("明年房价必跌"))).toBe(
      true
    );
    expect(q.length).toBeLessThanOrEqual(3);
  });

  it("带版本号和日期的产品句不走公报原始数据问法", () => {
    const q = buildAtomSearchQueries(
      "马斯克表示 Grok 4.6 在 Cursor 中提供双倍用量，持续到 8 月 19 日"
    );
    expect(q.some((item) => item.includes("公报") && item.includes("原始数据"))).toBe(false);
    expect(q.length).toBeLessThanOrEqual(3);
  });

  it("确诊例数与万亿句走公报原始数据，光谈百分点不走", () => {
    expect(
      buildAtomSearchQueries("某地新增确诊 128 例").some(
        (item) => item.includes("公报") && item.includes("原始数据")
      )
    ).toBe(true);
    expect(
      buildAtomSearchQueries("某省投资 3 万亿").some((item) => item.includes("公报") && item.includes("原始数据"))
    ).toBe(true);
    expect(
      buildAtomSearchQueries("他们在讨论百分点怎么算").some(
        (item) => item.includes("公报") && item.includes("原始数据")
      )
    ).toBe(false);
  });
});
