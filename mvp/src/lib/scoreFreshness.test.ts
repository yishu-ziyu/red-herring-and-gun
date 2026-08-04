/**
 * scoreFreshness.test.ts — Plan P2-4 · 时间衰减策略
 *
 * 关键校验：
 *   - 未来日期 → score=0 + futureDate flag
 *   - 缺日期 → score=0 + missingDate flag
 *   - historical 领域 → exempt（score=1）
 *   - news 半衰期 14 天：2 周后 ≈ 0.5
 *   - age > maxAgeDays → score=0
 */

import { describe, expect, it } from "vitest";
import { describeFreshness, scoreFreshnessFromTimestamp } from "./scoreFreshness";

const NOW = "2026-07-25T00:00:00Z";

describe("Plan P2-4 · scoreFreshnessFromTimestamp", () => {
  it("缺日期：score=0 + missingDate flag", () => {
    const r = scoreFreshnessFromTimestamp({});
    expect(r.score).toBe(0);
    expect(r.flags.missingDate).toBe(true);
    expect(r.ageDays).toBeNull();
  });

  it("未来日期：score=0 + futureDate flag", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2027-01-01T00:00:00Z",
      now: NOW,
    });
    expect(r.score).toBe(0);
    expect(r.flags.futureDate).toBe(true);
    expect(r.ageDays).toBeLessThan(0);
  });

  it("news 领域：14 天半衰期 → 2 周后 score ≈ 0.5", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2026-07-11T00:00:00Z",
      now: NOW,
      domain: "news",
    });
    expect(r.ageDays).toBe(14);
    expect(r.score).toBeCloseTo(0.5, 1);
  });

  it("research 领域：365 天半衰期 → 1 年后 score ≈ 0.5", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2025-07-25T00:00:00Z",
      now: NOW,
      domain: "research",
    });
    expect(r.ageDays).toBe(365);
    expect(r.score).toBeCloseTo(0.5, 1);
  });

  it("historical 领域：exempt → score=1（无论年龄）", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "1900-01-01T00:00:00Z",
      now: NOW,
      domain: "historical",
    });
    expect(r.score).toBe(1);
    expect(r.flags.historicalExempt).toBe(true);
  });

  it("news 领域：超过 365 天 → score=0", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2024-01-01T00:00:00Z",
      now: NOW,
      domain: "news",
    });
    expect(r.ageDays).toBeGreaterThanOrEqual(365);
    expect(r.score).toBe(0);
  });

  it("policy 领域：365 天半衰期 + 1825 天上限", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2024-01-01T00:00:00Z",
      now: NOW,
      domain: "policy",
    });
    // 2.5 年前仍未过期
    expect(r.score).toBeGreaterThan(0);
  });

  it("unknown 领域默认 180 天半衰期", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2025-01-25T00:00:00Z",
      now: NOW,
    });
    // 半年多，应已接近或等于 0
    expect(r.score).toBeLessThanOrEqual(0.5);
  });

  it("score 必须 ∈ [0, 1]", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2026-07-24T00:00:00Z",
      now: NOW,
      domain: "news",
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("policy 字段含领域类型名", () => {
    const r = scoreFreshnessFromTimestamp({
      publishedAt: "2026-07-01T00:00:00Z",
      now: NOW,
      domain: "research",
    });
    expect(r.policy).toBe("research");
  });
});

describe("Plan P2-4 · describeFreshness", () => {
  it("缺日期提示", () => {
    const r = scoreFreshnessFromTimestamp({});
    expect(describeFreshness(r)).toContain("未知");
  });

  it("未来日期提示", () => {
    const r = scoreFreshnessFromTimestamp({ publishedAt: "2027-01-01T00:00:00Z", now: NOW });
    expect(describeFreshness(r)).toContain("未来");
  });

  it("historical 豁免提示", () => {
    const r = scoreFreshnessFromTimestamp({ publishedAt: "1900-01-01T00:00:00Z", now: NOW, domain: "historical" });
    expect(describeFreshness(r)).toContain("豁免");
  });

  it("较新内容提示包含天数", () => {
    const r = scoreFreshnessFromTimestamp({ publishedAt: "2026-07-24T00:00:00Z", now: NOW, domain: "news" });
    expect(describeFreshness(r)).toContain("天前");
  });
});