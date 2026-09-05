import { describe, expect, it } from "vitest";
import {
  assessEvidenceGap,
  buildQueryPortfolio,
  classifyResultKind,
  computeInformationGain,
  formatHopDetail,
  fuseByRrf,
  GAIN_STOP_THRESHOLD,
  queriesForGap,
  scoreQueryDiscriminability,
  selectPriorityQueries,
  type RankedDoc,
} from "./evidencePursuit";

describe("scoreQueryDiscriminability", () => {
  it("rare named sentence outranks a generic proverb", () => {
    const rare = scoreQueryDiscriminability("但愿美勒图斯不会告我有这么重大的罪");
    const bland = scoreQueryDiscriminability("人生是痛苦的");
    expect(rare).toBeGreaterThan(bland);
    expect(bland).toBeLessThan(0.55);
  });

  it("quoted product + date scores higher than a bare brand token", () => {
    const specific = scoreQueryDiscriminability(
      "马斯克表示 Grok 4.6 在 Cursor 和 Grok View 中提供双倍用量，持续到 8 月 19 日"
    );
    const vague = scoreQueryDiscriminability("Grok 4.6");
    expect(specific).toBeGreaterThan(vague);
  });
});

describe("buildQueryPortfolio", () => {
  it("emits all six purposes for a dated product claim", () => {
    const atom = "马斯克表示 Grok 4.6 在 Cursor 中提供双倍用量，持续到 8 月 19 日";
    const portfolio = buildQueryPortfolio(atom);
    expect(portfolio.map((p) => p.purpose)).toEqual([
      "exact",
      "entity",
      "primary",
      "temporal",
      "refutation",
      "alternative",
    ]);
    const by = Object.fromEntries(portfolio.map((p) => [p.purpose, p.query]));
    expect(by.exact).toContain("Grok 4.6");
    expect(by.entity).toMatch(/马斯克|Grok|Cursor/);
    expect(by.primary).toMatch(/官方|发布|原文/);
    expect(by.temporal).toMatch(/8\s*月|19/);
    expect(by.refutation).toMatch(/辟谣/);
    expect(by.alternative).toMatch(/当事方|原始/);
  });

  it("plan atoms keep 规划/批复 on the primary query", () => {
    const primary = buildQueryPortfolio("新疆喀什要建地铁").find((p) => p.purpose === "primary");
    expect(primary?.query).toMatch(/规划/);
    expect(primary?.query).toMatch(/批复/);
  });

  it("selectPriorityQueries keeps purpose diversity", () => {
    const picked = selectPriorityQueries(buildQueryPortfolio("甘南所有景点一律免费"), { max: 3 });
    const purposes = new Set(picked.map((p) => p.purpose));
    expect(purposes.size).toBe(picked.length);
  });

  it("selectPriorityQueries drops a later purpose whose normalized query matches an earlier pick", () => {
    const atom = "甘南所有景点一律免费";
    const portfolio = buildQueryPortfolio(atom);
    const exact = portfolio.find((row) => row.purpose === "exact");
    const entity = portfolio.find((row) => row.purpose === "entity");
    expect(exact?.query).toBe(entity?.query);
    const picked = selectPriorityQueries(portfolio, { max: 3 });
    const queries = picked.map((row) => row.query);
    expect(new Set(queries).size).toBe(queries.length);
    expect(picked.filter((row) => row.query === exact?.query)).toHaveLength(1);
    expect(picked.some((row) => row.purpose === "entity")).toBe(false);
    expect(picked.some((row) => row.purpose !== "exact" && row.purpose !== "entity")).toBe(true);
  });

  it("selectPriorityQueries treats collapsed whitespace and case as the same query", () => {
    const picked = selectPriorityQueries(
      [
        { purpose: "exact", query: "Foo  Bar", score: 0.9 },
        { purpose: "entity", query: "foo bar", score: 0.9 },
        { purpose: "primary", query: "foo bar 官方通报", score: 0.5 },
        { purpose: "alternative", query: "另一路", score: 0.4 },
      ],
      { max: 3 },
    );
    expect(picked.map((row) => row.purpose)).toEqual(["exact", "primary", "alternative"]);
    expect(new Set(picked.map((row) => row.query.replace(/\s+/g, " ").trim().toLowerCase())).size).toBe(3);
  });
});

describe("assessEvidenceGap → next query", () => {
  it("unverified with no official source asks for primary first", () => {
    const gap = assessEvidenceGap({
      atom: "某地明天发生 7 级地震",
      sources: [{ url: "https://weibo.com/x", title: "转发", snippet: "听说" }],
      trigger: "unverified",
    });
    expect(gap.missing).toContain("primary");
    expect(gap.nextPurpose).toBe("primary");
    expect(gap.goalLabel).toBe("找原始发布");
    const queries = queriesForGap({
      atom: "某地明天发生 7 级地震",
      gap,
      priorQueries: [],
      round: 1,
    });
    expect(queries[0]).toContain("官方通报");
  });

  it("skips already-tried primary queries and switches purpose", () => {
    const atom = "某食品含有害添加剂";
    const gap = assessEvidenceGap({ atom, sources: [], trigger: "unverified" });
    const next = queriesForGap({
      atom,
      gap,
      priorQueries: [`${atom} 官方通报`, `${atom} 辟谣`],
      round: 2,
    });
    expect(next.some((q) => q.includes("官方通报"))).toBe(false);
    expect(next.length).toBeGreaterThan(0);
  });
});

describe("fuseByRrf", () => {
  const doc = (url: string): RankedDoc => ({ url, rec: { url, title: url } });

  it("a document high in two lists outranks a singleton first hit", () => {
    const fused = fuseByRrf([
      [doc("https://a.test/shared"), doc("https://a.test/only-first")],
      [doc("https://a.test/other"), doc("https://a.test/shared")],
    ]);
    expect(fused[0]?.url).toBe("https://a.test/shared");
    expect(fused.find((d) => d.url === "https://a.test/shared")!.rrf).toBeGreaterThan(
      fused.find((d) => d.url === "https://a.test/only-first")!.rrf
    );
  });

  it("single list keeps input order (identity fusion)", () => {
    const fused = fuseByRrf([[doc("https://z.test/1"), doc("https://z.test/2")]]);
    expect(fused.map((d) => d.url)).toEqual(["https://z.test/1", "https://z.test/2"]);
  });
});

describe("computeInformationGain", () => {
  const gapEmpty = assessEvidenceGap({ atom: "某地地震", sources: [] });

  it("official new host is above stop threshold; same-host reprint is not", () => {
    const existing = [{ url: "https://blog.example/1", title: "转载同一通稿", snippet: "通稿" }];
    const official = computeInformationGain({
      existing,
      incoming: [{ url: "https://www.gov.cn/notice", title: "官方通报", snippet: "地震局辟谣" }],
      gapBefore: gapEmpty,
      gapAfter: assessEvidenceGap({
        atom: "某地地震",
        sources: [...existing, { url: "https://www.gov.cn/notice", title: "官方通报", snippet: "地震局辟谣" }],
      }),
    });
    expect(official.gain).toBeGreaterThanOrEqual(GAIN_STOP_THRESHOLD);
    expect(official.newNonReprint).toBe(1);

    const reprint = computeInformationGain({
      existing,
      incoming: [{ url: "https://blog.example/2", title: "转载同一通稿（续）", snippet: "通稿" }],
      gapBefore: gapEmpty,
      gapAfter: gapEmpty,
    });
    expect(reprint.gain).toBeLessThan(GAIN_STOP_THRESHOLD);
    expect(reprint.newNonReprint).toBe(0);
  });
});

describe("classifyResultKind + formatHopDetail", () => {
  it("labels official / reprint / empty for the process UI", () => {
    expect(
      classifyResultKind(
        [{ url: "https://www.piyao.org.cn/a", title: "联合辟谣", snippet: "不实" }],
        [],
        "电瓶车被偷送到非洲"
      )
    ).toBe("primary");
    expect(
      classifyResultKind(
        [{ url: "https://blog.example/2", title: "旧帖", snippet: "转" }],
        [{ url: "https://blog.example/1", title: "旧帖", snippet: "转" }],
        "电瓶车被偷送到非洲"
      )
    ).toBe("repost");
    expect(classifyResultKind([], [], "x")).toBe("empty");
  });

  it("formats a hop as goal / query / kind / remaining gap", () => {
    const line = formatHopDetail({
      goal: "找原始发布",
      query: "某地地震 官方通报",
      resultKind: "repost",
      missingAfter: ["原始来源", "反证"],
    });
    expect(line).toContain("目标：找原始发布");
    expect(line).toContain("某地地震 官方通报");
    expect(line).toContain("二手转载");
    expect(line).toContain("还缺原始来源");
  });
});
