import { describe, expect, it } from "vitest";
import { parseJsonl, renderMetricsHtml, toMetricsRow } from "./answerBenchMetrics";

// Failure modes listed before the implementation:
// 1. a summary with a missing per-label bucket or zero scored cases must not divide by zero / emit NaN
// 2. third-party content (callsByHost, tokensByHost, hosts) must never reach the stored row
// 3. fallback rate is over all cases, accuracy is over scored cases
// 4. a malformed jsonl line must not silently drop the good rows around it
// 5. labels with markup characters must be escaped in the html
// 6. an empty history still renders a page

const summary = {
  label: "current-v1",
  adapter: "current",
  cases: 40,
  scored: 37,
  correct: 24,
  accuracy: 0.6486486486486487,
  byLabel: { 不能信: { n: 20, correct: 16 }, 能信: { n: 12, correct: 4 }, 证据不足: { n: 4, correct: 4 }, 立场型: { n: 1, correct: 0 } },
  trueToFalse: 0,
  shouldJudgeButDidnt: 3,
  wrongSupport: 8,
  fallbackUsed: 14,
  secondsMedian: 243.811,
  secondsMax: 613.876,
  modelCallsMean: 13.275,
  searchCallsMean: 47.825,
  callsByHost: { "api.example.com [model]": { calls: 1 } },
  tokensByHost: { "api.example.com": { in: 1 } },
};

describe("toMetricsRow", () => {
  const row = toMetricsRow(summary, { date: "2026-09-29", commit: "abc1234" });
  it("keeps only summary numbers", () => {
    expect(row).toEqual({
      label: "current-v1",
      date: "2026-09-29",
      commit: "abc1234",
      cases: 40,
      accuracy: { overall: 24 / 37, byLabel: { 不能信: 0.8, 能信: 1 / 3, 证据不足: 1, 立场型: 0 } },
      trueToFalse: 0,
      shouldJudgeButDidnt: 3,
      wrongSupport: 8,
      fallbackRate: 14 / 40,
      secondsMedian: 243.811,
      secondsMax: 613.876,
      modelCallsMean: 13.275,
      searchCallsMean: 47.825,
    });
    expect(JSON.stringify(row)).not.toContain("example.com");
  });
  it("does not emit NaN when nothing was scored", () => {
    const r = toMetricsRow({ ...summary, cases: 0, scored: 0, correct: 0, accuracy: 0, byLabel: { 能信: { n: 0, correct: 0 } }, fallbackUsed: 0 }, { date: "d", commit: "c" });
    expect(JSON.stringify(r)).not.toMatch(/NaN|null/);
    expect(r.accuracy.overall).toBe(0);
    expect(r.fallbackRate).toBe(0);
  });
  it("rejects a summary without a label", () => {
    expect(() => toMetricsRow({ ...summary, label: "" }, { date: "d", commit: "c" })).toThrow();
  });
});

describe("parseJsonl", () => {
  it("skips blank lines and reports bad ones without dropping neighbours", () => {
    const good = JSON.stringify(toMetricsRow(summary, { date: "d", commit: "c" }));
    const { rows, bad } = parseJsonl(`${good}\n\n{not json\n${good}\n`);
    expect(rows).toHaveLength(2);
    expect(bad).toBe(1);
  });
});

describe("renderMetricsHtml", () => {
  it("renders a self-contained page with a table and svg charts", () => {
    const html = renderMetricsHtml([toMetricsRow(summary, { date: "2026-09-29", commit: "abc1234" })]);
    expect(html).toContain("<svg");
    expect(html).toContain("current-v1");
    expect(html).toContain("64.9%");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
  it("escapes labels", () => {
    const html = renderMetricsHtml([toMetricsRow({ ...summary, label: "<b>x</b>" }, { date: "d", commit: "c" })]);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("renders with no rows", () => {
    expect(renderMetricsHtml([])).toContain("还没有记录");
  });
});
