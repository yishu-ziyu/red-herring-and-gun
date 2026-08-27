import { describe, expect, it } from "vitest";
import { composeResearchMemo, looksLikeResearchMemo, parseInline, parseResearchMemo } from "./memoMarkdown";

describe("looksLikeResearchMemo", () => {
  it("treats headings and tables as a memo", () => {
    expect(looksLikeResearchMemo("不能信。")).toBe(false);
    expect(
      looksLikeResearchMemo("## 核心结论\n\n**不能信。** 原句把两件事捆在一起。\n\n## 一、出处\n\n没有官方通报。")
    ).toBe(true);
  });
});

describe("composeResearchMemo", () => {
  it("wraps a short verdict into 核心结论 + REFERENCES, not a slogan card", () => {
    const md = composeResearchMemo({
      title: "隔夜菜加热会致癌吗",
      verdictLabel: "只能信一部分",
      conclusion: "说法存在夸大，加热不当有风险但不宜直接等同致癌。",
      findings: ["加热不当可能产生有害物，但不等于必然致癌"],
      sources: [{ title: "食品安全科普", url: "https://example.com/food-safety" }],
    });
    expect(md).toContain("# 隔夜菜加热会致癌吗");
    expect(md).toContain("## 核心结论");
    expect(md).not.toContain("**只能信一部分。**");
    expect(md).toContain("说法存在夸大");
    expect(md).toContain("REFERENCES");
    expect(md).toContain("https://example.com/food-safety");
    expect(md).not.toMatch(/美联储|Federal Reserve/);
  });

  it("strips a four-word stamp from an already-written memo", () => {
    const raw = "## 核心结论\n\n**不能信。** 没有可点开的出处。\n\n## 一、核对\n\nx";
    const out = composeResearchMemo({ verdictLabel: "不能信", conclusion: raw });
    expect(out).toContain("## 核心结论");
    expect(out).toContain("没有可点开的出处");
    expect(out).not.toMatch(/## 核心结论\s+\*\*不能信/);
  });
});

describe("parseResearchMemo", () => {
  it("parses layers, table, inline chips, references", () => {
    const md = [
      "# 隔夜菜加热会致癌吗",
      "",
      "## 核心结论",
      "",
      "**不能信。** 这一判断分两层：",
      "",
      "1. **字面致癌：没有依据。** 未见国家级通报 [who.int](https://www.who.int/food) +2。",
      "2. **加热不当有害：只能信一部分。**",
      "",
      "## 一、已核对的事实",
      "",
      "| 说法 | 判断 | 出处 |",
      "| --- | --- | --- |",
      "| 必然致癌 | 不成立 | [example.com](https://example.com/food-safety) |",
      "",
      "REFERENCES",
      "",
      "1. [食品安全科普](https://example.com/food-safety)",
    ].join("\n");
    const blocks = parseResearchMemo(md);
    expect(blocks[0]).toEqual({ type: "h1", text: "隔夜菜加热会致癌吗" });
    expect(blocks.some((b) => b.type === "h2" && b.text === "核心结论")).toBe(true);
    expect(blocks.some((b) => b.type === "list" && b.ordered)).toBe(true);
    const table = blocks.find((b) => b.type === "table");
    expect(table?.type === "table" && table.headers[0]).toBe("说法");
    const refs = blocks.find((b) => b.type === "refs");
    expect(refs?.type === "refs" && refs.items[0]?.url).toContain("example.com");
    expect(JSON.stringify(blocks)).not.toMatch(/美联储|Federal Reserve/);
  });
});

describe("parseInline", () => {
  it("splits bold, chips, and [n] cites", () => {
    const spans = parseInline("**不能信。** 见 [who.int](https://www.who.int/x) 与 [1]。");
    expect(spans[0]).toEqual({ kind: "strong", text: "不能信。" });
    expect(spans.some((s) => s.kind === "chip" && s.href?.includes("who.int"))).toBe(true);
    expect(spans.some((s) => s.kind === "ref" && s.n === 1)).toBe(true);
  });
});
