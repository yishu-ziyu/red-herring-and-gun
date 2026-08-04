/**
 * sourceLineage.p13.test.ts — Plan P1-3 · 句子级引用溯源（Logically.app 借鉴）
 *
 * 关键校验：
 *   - quote 必须是原文子串（diff=0）
 *   - 找不到定位时 verified=false，禁止编页码/编偏移
 *   - 支持 HTML 段落 / PDF / OCR / 纯文本四种 mediaType
 */

import { describe, expect, it } from "vitest";
import {
  buildCitationSpan,
  locateQuoteInText,
  type CitationSpan,
} from "./sourceLineage";

describe("Plan P1-3 · locateQuoteInText", () => {
  it("直接命中：quote 在全文中唯一出现", () => {
    const text = "国务院决定下月起取消退休金。原文已经发布。";
    const out = locateQuoteInText(text, "下月起取消退休金");
    expect(out).not.toBeNull();
    expect(out!.verified).toBe(true);
    expect(text.slice(out!.start, out!.end)).toBe("下月起取消退休金");
  });

  it("找不到定位返回 null（不编偏移）", () => {
    const out = locateQuoteInText("ABC", "XYZ");
    expect(out).toBeNull();
  });

  it("容忍空白差异（多空格/换行折叠后命中）", () => {
    const text = "隔夜菜\n\n会致癌。\n\n正常储存远低于限量。";
    const out = locateQuoteInText(text, "隔夜菜 会致癌");
    expect(out).not.toBeNull();
    expect(out!.verified).toBe(false);
  });

  it("首次命中位置正确", () => {
    const text = "开头填充文字。后半段包含目标片段。再来一次目标片段。";
    const out = locateQuoteInText(text, "目标片段");
    // "开头填充文字。" (7) + "后半段包含" (5) = offset 12
    expect(out!.start).toBe(12);
    expect(text.slice(out!.start, out!.end)).toBe("目标片段");
  });
});

describe("Plan P1-3 · buildCitationSpan", () => {
  it("HTML 段落定位成功", () => {
    const html = "<p>前文</p><p>这是关键引用段</p><p>后文</p>";
    const span = buildCitationSpan(
      "https://example.com/post",
      "html",
      html,
      "这是关键引用段",
      "p:nth-of-type(2)",
    );
    expect(span.verified).toBe(true);
    expect(span.mediaType).toBe("html");
    expect(span.selector).toBe("p:nth-of-type(2)");
    expect(html.slice(span.charOffsetStart, span.charOffsetEnd)).toBe("这是关键引用段");
  });

  it("PDF 页码定位（mediaType=pdf + selector 为页号）", () => {
    const pdfText = "Page 1 content. Page 2 has the key finding. Page 3 end.";
    const span = buildCitationSpan(
      "https://example.com/paper.pdf",
      "pdf",
      pdfText,
      "key finding",
      "page=2",
    );
    expect(span.verified).toBe(true);
    expect(span.mediaType).toBe("pdf");
    expect(span.selector).toBe("page=2");
    expect(span.snippet).toBe("key finding");
  });

  it("OCR 区域定位（mediaType=ocr + selector 为区域 id）", () => {
    const ocrText = "头部：广告。前景：核心事实陈述。底部：脚注。";
    const span = buildCitationSpan(
      "https://example.com/image.png",
      "ocr",
      ocrText,
      "核心事实陈述",
      "region=foreground",
    );
    expect(span.verified).toBe(true);
    expect(span.mediaType).toBe("ocr");
    expect(span.selector).toBe("region=foreground");
  });

  it("纯文本（mediaType=text）无 selector 也应能命中", () => {
    const text = "今天天气晴朗，最高气温 28 度，紫外线较强。";
    const span = buildCitationSpan(
      "https://example.com/weather.txt",
      "text",
      text,
      "紫外线较强",
    );
    expect(span.verified).toBe(true);
    expect(span.mediaType).toBe("text");
    expect(span.selector).toBeUndefined();
  });

  it("无法定位时 verified=false + charOffset=-1 + snippet=''（禁止编造）", () => {
    const span = buildCitationSpan(
      "https://example.com/post",
      "html",
      "完全不相关的正文。",
      "找不到的引用",
    );
    expect(span.verified).toBe(false);
    expect(span.charOffsetStart).toBe(-1);
    expect(span.charOffsetEnd).toBe(-1);
    expect(span.snippet).toBe("");
  });

  it("空 quote 返回未定位", () => {
    const span = buildCitationSpan(
      "https://example.com",
      "text",
      "任何正文",
      "",
    );
    expect(span.verified).toBe(false);
    expect(span.charOffsetStart).toBe(-1);
  });

  it("CitationSpan 必须含 url/mediaType 字段", () => {
    const span: CitationSpan = buildCitationSpan(
      "https://example.com",
      "unknown",
      "",
      "",
    );
    expect(span.url).toBe("https://example.com");
    expect(span.mediaType).toBe("unknown");
  });
});