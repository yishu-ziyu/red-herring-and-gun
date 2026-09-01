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
      verdictLabel: "只能信一部分",
      conclusion: "说法存在夸大，加热不当有风险但不宜直接等同致癌。",
      findings: ["加热不当可能产生有害物，但不等于必然致癌"],
      sources: [{ title: "食品安全科普", url: "https://example.com/food-safety" }],
    });
    // 被核查原句绝不作为 h1 出现：放大谣言=暗示谣言（错觉真相效应）
    expect(md).not.toContain("# 隔夜菜加热会致癌吗");
    expect(md).not.toMatch(/^# /m);
    expect(md.startsWith("## 核心结论")).toBe(true);
    expect(md).not.toContain("**只能信一部分。**");
    expect(md).toContain("说法存在夸大");
    expect(md).toContain("REFERENCES");
    expect(md).toContain("https://example.com/food-safety");
    expect(md).not.toMatch(/美联储|Federal Reserve/);
  });

  it("renders the 核查路径 receipt with per-stage quantitative details", () => {
    const md = composeResearchMemo({
      verdictLabel: "不能信",
      conclusion: "该说法没有证据支持。",
      path: [
        { label: "确认核查问题" },
        { label: "拆开要核对的部分", detail: "2 个可核查命题" },
        { label: "检索公开材料", detail: "8 条来源" },
      ],
    });
    expect(md).toContain("## 核查路径");
    expect(md).toContain("- ✓ 拆开要核对的部分 · 2 个可核查命题");
    expect(md).toContain("- ✓ 检索公开材料 · 8 条来源");
    expect(md).toContain("- ✓ 确认核查问题");
  });

  it("emphasizes the short verdict clause when the first sentence is too long", () => {
    const long =
      "该说法无法核查：未指明具体历史人物姓名、未定义精神病症状类型、没有任何历史文献或学术研究出处，检索到的全部来源均为咖啡因安全摄入量的通用科普，与「历史人物精神病症状」无关。";
    const md = composeResearchMemo({ verdictLabel: "还查不清", conclusion: long });
    expect(md).toContain("**该说法无法核查：**");
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
