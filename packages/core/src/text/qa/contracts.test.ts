/**
 * QA 契约组合检查（工作包 B，docs/evals/2026-09-08-product-qa-contract.md E4）。
 *
 * 只断言「当前 main 上必须成立」的确定性不变量（#74 证伪分桶、related-only 降级、
 * merge 覆盖补全、marker clamp、双桶关系保留）。依赖 PR #79 的方向契约/audit
 * fail-closed/未查清边界组合登记在 docs/qa/pending-after-79.yaml（blocked-on-#79-merge），
 * 在这里不得伪装成已覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  alignFalseEvidenceBuckets,
  mergeSubclaimVerdicts,
} from "../claimAtom/index.js";
import {
  bindDualBucketCitations,
  normalizeReportCitations,
} from "../citationBinding.js";

const src = (url: string) => ({ url, title: "t", snippet: "s" });

describe("qa:contracts — #74 证伪分桶（alignFalseEvidenceBuckets）", () => {
  it("false + 仅支撑桶 → 整桶改入 contradict；true 不动；related-only 不改桶", () => {
    const moved = alignFalseEvidenceBuckets({
      verdict: "false",
      supporting: [src("https://t.test/a")],
      contradicting: [],
    });
    expect(moved.supporting).toEqual([]);
    expect(moved.contradicting).toHaveLength(1);

    const untouched = alignFalseEvidenceBuckets({
      verdict: "true",
      supporting: [src("https://t.test/a")],
      contradicting: [],
    });
    expect(untouched.supporting).toHaveLength(1);
    expect(untouched.contradicting).toEqual([]);

    const relatedOnly = alignFalseEvidenceBuckets({
      verdict: "false",
      supporting: [src("https://t.test/a")],
      contradicting: [],
      sourcesRelatedOnly: true,
    });
    expect(relatedOnly.supporting).toHaveLength(1);
    expect(relatedOnly.contradicting).toEqual([]);
  });
});

describe("qa:contracts — 双桶引用绑定（bindDualBucketCitations）", () => {
  it("同 URL 跨桶是两条 relation，都保留；编号 support 先于 contradict", () => {
    const bound = bindDualBucketCitations(
      "文 [1] 与 [2]",
      [src("https://t.test/a")],
      [src("https://t.test/a")]
    );
    expect(bound.supportingSources).toHaveLength(1);
    expect(bound.contradictingSources).toHaveLength(1);
    expect(bound.text).toContain("[1]");
    expect(bound.text).toContain("[2]");
  });

  it("marker 超出来源数被 clamp 删除，不错绑", () => {
    const bound = bindDualBucketCitations("引用 [1] 和不存在的 [9]", [src("https://t.test/a")], []);
    expect(bound.text).toContain("[1]");
    expect(bound.text).not.toContain("[9]");
  });

  it("每桶独立去重：重复 URL 只保留一条", () => {
    const bound = bindDualBucketCitations(
      "",
      [src("https://t.test/a"), src("https://t.test/a")],
      []
    );
    expect(bound.supportingSources).toHaveLength(1);
  });
});

describe("qa:contracts — merge 覆盖与判词纪律（mergeSubclaimVerdicts）", () => {
  it("未覆盖原子补 unverified；编造原子丢弃；非法 verdict 回退 unverified", () => {
    const result = mergeSubclaimVerdicts(
      ["原子A", "原子B", "原子C"],
      [
        {
          claimAtom: "原子A",
          verdict: "true",
          evidence: "E",
          boundary: "B",
          supportingSources: [src("https://a.example.com")],
        },
        { claimAtom: "编造", verdict: "false", evidence: "幻觉", boundary: "" },
        { claimAtom: "原子C", verdict: "不是合法值", evidence: "", boundary: "" },
      ]
    );
    // 顺序：先按输入覆盖的原子，再补未覆盖的
    expect(result.map((r) => r.claimAtom)).toEqual(["原子A", "原子C", "原子B"]);
    expect(result[0]?.verdict).toBe("true");
    // 非法 verdict 回退 unverified
    expect(result[1]?.verdict).toBe("unverified");
    // 未覆盖原子：确定性补 unverified，不预填任何证据
    expect(result[2]?.verdict).toBe("unverified");
    expect(result[2]?.boundary).toContain("未覆盖");
    expect(result[2]?.supportingSources).toEqual([]);
  });

  it("完全无来源的 true/false 收 unverified 并补「待补证」", () => {
    const result = mergeSubclaimVerdicts(
      ["原子A", "原子B"],
      [
        { claimAtom: "原子A", verdict: "true", evidence: "", boundary: "", supportingSources: [], contradictingSources: [] },
        { claimAtom: "原子B", verdict: "false", evidence: "", boundary: "", supportingSources: [], contradictingSources: [] },
      ]
    );
    for (const row of result) {
      expect(row.verdict).toBe("unverified");
      expect(row.evidenceGaps.some((g) => g.includes("待补证"))).toBe(true);
    }
  });
});

describe("qa:contracts — 报告级引用归一（normalizeReportCitations）", () => {
  it("全局编号来自判词来源（first-seen），conclusion 越界 marker 删除", () => {
    const report: Record<string, unknown> = {
      conclusion: "结论引用 [2] 与越界 [5]。",
      subclaimVerdicts: [
        {
          claimAtom: "原子A",
          verdict: "true",
          evidence: "证据 [1]。",
          supportingSources: [src("https://t.test/1")],
          contradictingSources: [],
        },
        {
          claimAtom: "原子B",
          verdict: "true",
          evidence: "另一来源 [1]。",
          supportingSources: [src("https://t.test/2")],
          contradictingSources: [],
        },
      ],
    };
    normalizeReportCitations(report);
    const conclusion = String(report.conclusion);
    expect(conclusion).toContain("[2]");
    expect(conclusion).not.toContain("[5]");
    const sources = report.citationSources as Array<{ url: string }>;
    expect(sources.map((s) => s.url)).toEqual(["https://t.test/1", "https://t.test/2"]);
  });
});
