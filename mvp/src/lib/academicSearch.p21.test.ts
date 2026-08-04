/**
 * academicSearch.p21.test.ts — Plan P2-1 · 学术通道 + Consensus 测试
 *
 * 关键校验：
 *   - DOI 去重（非法 DOI 跳过）
 *   - 共识度 0-1 + verdict 分类（support/contradict/mixed/insufficient）
 *   - <3 论文 → insufficient（不得 high consensus）
 *   - stance 优先级：support > contradict > neutral
 */

import { describe, expect, it } from "vitest";
import {
  computeAcademicConsensus,
  deduplicatePapers,
  sortPapersByCitation,
  sortPapersByDoi,
  type Paper,
} from "./academicSearch";
import { formatAPA, formatChicago, formatMLA } from "./citationFormatter";

function p(doi: string, stance: Paper["stance"], opts?: Partial<Paper>): Paper {
  return {
    doi,
    title: opts?.title ?? `Title of ${doi}`,
    authors: opts?.authors ?? ["Smith, John", "Doe, Jane"],
    year: opts?.year ?? 2024,
    venue: opts?.venue ?? "Nature",
    stance,
    citationCount: opts?.citationCount, // 不设默认值；undefined 表示"无引用数"
  };
}

describe("Plan P2-1 · deduplicatePapers", () => {
  it("不同 DOI → 全部保留", () => {
    const out = deduplicatePapers([
      p("10.1234/a", "support"),
      p("10.1234/b", "contradict"),
    ]);
    expect(out.length).toBe(2);
  });

  it("同 DOI 不同 stance → 保留 support 优先（> contradict > neutral）", () => {
    const out = deduplicatePapers([
      p("10.1234/same", "neutral"),
      p("10.1234/same", "contradict"),
      p("10.1234/same", "support"),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].stance).toBe("support");
  });

  it("非法 DOI（前缀非 10.）必须跳过", () => {
    const out = deduplicatePapers([
      p("not-a-doi", "support"),
      p("10.9999/valid", "support"),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].doi).toBe("10.9999/valid");
  });

  it("空 DOI 跳过", () => {
    const out = deduplicatePapers([p("", "support")]);
    expect(out.length).toBe(0);
  });
});

describe("Plan P2-1 · computeAcademicConsensus", () => {
  it("空输入：verdict=insufficient + description=暂无学术证据", () => {
    const out = computeAcademicConsensus([]);
    expect(out.total).toBe(0);
    expect(out.verdict).toBe("insufficient");
    expect(out.description).toContain("暂无");
  });

  it("<3 论文强制 insufficient（无论比例如何）", () => {
    const out = computeAcademicConsensus([p("10.1/a", "support")]);
    expect(out.total).toBe(1);
    expect(out.verdict).toBe("insufficient");
    expect(out.description).toContain("样本不足");
  });

  it("3 论文 + 2 support / 1 contradict → verdict=support + score=0.67", () => {
    const out = computeAcademicConsensus([
      p("10.1/a", "support"),
      p("10.1/b", "support"),
      p("10.1/c", "contradict"),
    ]);
    expect(out.total).toBe(3);
    expect(out.support).toBe(2);
    expect(out.contradict).toBe(1);
    expect(out.consensusScore).toBeCloseTo(2 / 3, 2);
    expect(out.verdict).toBe("support");
  });

  it("3 论文 + 0/3 → verdict=contradict", () => {
    const out = computeAcademicConsensus([
      p("10.1/a", "contradict"),
      p("10.1/b", "contradict"),
      p("10.1/c", "contradict"),
    ]);
    expect(out.verdict).toBe("contradict");
  });

  it("5 论文 + 2/2/1 → verdict=mixed（未达 60% 阈值）", () => {
    const out = computeAcademicConsensus([
      p("10.1/a", "support"),
      p("10.1/b", "support"),
      p("10.1/c", "contradict"),
      p("10.1/d", "contradict"),
      p("10.1/e", "neutral"),
    ]);
    expect(out.total).toBe(5);
    expect(out.verdict).toBe("mixed");
    expect(out.consensusScore).toBe(0.4);
  });

  it("自定义阈值（threshold=0.5）应生效", () => {
    const out = computeAcademicConsensus(
      [p("10.1/a", "support"), p("10.1/b", "support"), p("10.1/c", "contradict")],
      { consensusThreshold: 0.5 },
    );
    expect(out.verdict).toBe("support"); // 2/3 = 0.67 > 0.5
  });

  it("consensusScore 必须 ∈ [0, 1]", () => {
    const out = computeAcademicConsensus([
      p("10.1/a", "support"),
      p("10.1/b", "contradict"),
      p("10.1/c", "neutral"),
      p("10.1/d", "support"),
      p("10.1/e", "contradict"),
    ]);
    expect(out.consensusScore).toBeGreaterThanOrEqual(0);
    expect(out.consensusScore).toBeLessThanOrEqual(1);
  });
});

describe("Plan P2-1 · sorting", () => {
  it("sortPapersByDoi 按 DOI 字典序", () => {
    const out = sortPapersByDoi([
      p("10.2/zzz", "support"),
      p("10.1/aaa", "support"),
    ]);
    expect(out.map((x) => x.doi)).toEqual(["10.1/aaa", "10.2/zzz"]);
  });

  it("sortPapersByCitation 按引用数降序", () => {
    const out = sortPapersByCitation([
      p("10.1/low", "support", { citationCount: 1 }),
      p("10.1/high", "support", { citationCount: 100 }),
      p("10.1/mid", "support", { citationCount: 50 }),
    ]);
    expect(out.map((x) => x.doi)).toEqual(["10.1/high", "10.1/mid", "10.1/low"]);
  });

  it("无 citationCount 的论文应排到最后", () => {
    const out = sortPapersByCitation([
      p("10.1/no-cite", "support"),
      p("10.1/has-cite", "support", { citationCount: 5 }),
    ]);
    expect(out.map((x) => x.doi)).toEqual(["10.1/has-cite", "10.1/no-cite"]);
  });
});

describe("Plan P2-1 · citationFormatter", () => {
  const sample: Paper = {
    doi: "10.1038/nature12373",
    title: "Test Paper",
    authors: ["Smith, John", "Doe, Jane"],
    year: 2024,
    venue: "Nature",
    stance: "support",
  };

  it("APA 7th 格式含年份 / 标题 / DOI", () => {
    const out = formatAPA(sample);
    expect(out).toContain("(2024)");
    expect(out).toContain("Test Paper");
    expect(out).toContain("https://doi.org/10.1038/nature12373");
  });

  it("APA 多作者：3+ 应使用 & 形 + 逗号串联", () => {
    const paper: Paper = { ...sample, authors: ["Alice, A.", "Bob, B.", "Charlie, C."] };
    const out = formatAPA(paper);
    expect(out).toContain("&");
    expect(out).toContain(", ");
  });

  it("MLA 9th 含 et al.（3+ 作者）", () => {
    const paper: Paper = { ...sample, authors: ["Alice, A.", "Bob, B.", "Charlie, C."] };
    const out = formatMLA(paper);
    expect(out).toContain("et al.");
  });

  it("MLA 2 作者含 and", () => {
    const paper: Paper = { ...sample, authors: ["Alice, A.", "Bob, B."] };
    const out = formatMLA(paper);
    expect(out).toContain("and");
    expect(out).not.toContain("et al.");
  });

  it("Chicago 格式含年份和 DOI URL", () => {
    const out = formatChicago(sample);
    expect(out).toContain("2024");
    expect(out).toContain("https://doi.org/10.1038/nature12373");
  });

  it("零作者应退化为 Unknown Author", () => {
    const paper: Paper = { ...sample, authors: [] };
    expect(formatAPA(paper)).toContain("Unknown Author");
    expect(formatMLA(paper)).toContain("Unknown Author");
  });
});