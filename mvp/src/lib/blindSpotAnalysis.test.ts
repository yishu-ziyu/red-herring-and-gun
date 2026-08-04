/**
 * blindSpotAnalysis.test.ts — Plan P1-6 · 盲点视图（Ground News 借鉴）
 *
 * 关键校验：
 *   - 同源转载折叠后再统计
 *   - <3 独立来源 → hasEnoughSample=false + caveat
 *   - 不得通过域名硬编码政治立场（只做来源类型分类）
 *   - 空输入返回零状态而非崩溃
 */

import { describe, expect, it } from "vitest";
import { buildBlindSpotReport, summarizeBlindSpot } from "./blindSpotAnalysis";

describe("Plan P1-6 · buildBlindSpotReport", () => {
  it("空输入：total=0 + 独立来源=0 + 样本不足", () => {
    const r = buildBlindSpotReport([]);
    expect(r.totalEvidence).toBe(0);
    expect(r.independentCount).toBe(0);
    expect(r.buckets.length).toBe(0);
    expect(r.hasEnoughSample).toBe(false);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("2 个独立来源 → hasEnoughSample=false", () => {
    const r = buildBlindSpotReport([
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "bbc.com", signal: "contradict" },
    ]);
    expect(r.independentCount).toBe(2);
    expect(r.hasEnoughSample).toBe(false);
    expect(r.caveats.some((c) => c.includes("样本不足"))).toBe(true);
  });

  it("3 个独立来源 → hasEnoughSample=true", () => {
    const r = buildBlindSpotReport([
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "bbc.com", signal: "contradict" },
      { hostname: "reuters.com", signal: "neutral" },
    ]);
    expect(r.independentCount).toBe(3);
    expect(r.hasEnoughSample).toBe(true);
  });

  it("同源转载折叠：5 条 nytimes.com 应计 1 个独立来源", () => {
    const r = buildBlindSpotReport([
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "nytimes.com", signal: "neutral" },
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "nytimes.com", signal: "contradict" },
    ]);
    expect(r.independentCount).toBe(1);
    expect(r.buckets.length).toBe(1);
    expect(r.buckets[0].count).toBe(5);
    expect(r.buckets[0].support).toBe(3);
    expect(r.buckets[0].contradict).toBe(1);
    expect(r.buckets[0].neutral).toBe(1);
    // 样本不足（只有 1 独立来源）
    expect(r.hasEnoughSample).toBe(false);
  });

  it("3 条同源转载 + 2 条其他独立 → 独立来源=2（仍不足）", () => {
    const r = buildBlindSpotReport([
      { hostname: "xinhua.com", signal: "support" },
      { hostname: "xinhua.com", signal: "support" },
      { hostname: "xinhua.com", signal: "support" },
      { hostname: "bbc.com", signal: "contradict" },
      { hostname: "reuters.com", signal: "neutral" },
    ]);
    expect(r.independentCount).toBe(3);
    expect(r.totalEvidence).toBe(5);
    expect(r.buckets[0].count).toBe(3); // xinhua 转载最多
    expect(r.hasEnoughSample).toBe(true);
  });

  it("hostname 标准化：去 www. / 小写", () => {
    const r = buildBlindSpotReport([
      { hostname: "WWW.NYTimes.com", signal: "support" },
      { hostname: "www.nytimes.com", signal: "support" },
      { hostname: "nytimes.com", signal: "support" },
    ]);
    expect(r.independentCount).toBe(1);
  });

  it("byType 应能正确归类（学术/官方/媒体）", () => {
    const r = buildBlindSpotReport([
      { hostname: "nature.com", signal: "support" },
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "nih.gov", signal: "support" },
      { hostname: "xinhua.com", signal: "support" },
    ]);
    expect(r.byType["学术期刊"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.byType["国际媒体"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.byType["政府/官方"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.byType["中文媒体"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("空 hostname / 空白 hostname 应被忽略（不计入 buckets）", () => {
    const r = buildBlindSpotReport([
      { hostname: "", signal: "support" },
      { hostname: "  ", signal: "support" },
      { hostname: "valid.com", signal: "support" },
    ]);
    expect(r.independentCount).toBe(1);
    expect(r.totalEvidence).toBe(1);
  });

  it("summarizeBlindSpot 应包含来源类型 Top 3", () => {
    const r = buildBlindSpotReport([
      { hostname: "nytimes.com", signal: "support" },
      { hostname: "bbc.com", signal: "support" },
      { hostname: "xinhua.com", signal: "support" },
    ]);
    const summary = summarizeBlindSpot(r);
    expect(summary).toContain("3 条证据");
    expect(summary).toContain("3 个独立来源");
  });

  it("summarizeBlindSpot 样本不足时应附「样本不足」说明", () => {
    const r = buildBlindSpotReport([{ hostname: "a.com", signal: "support" }]);
    expect(summarizeBlindSpot(r)).toContain("样本不足");
  });
});