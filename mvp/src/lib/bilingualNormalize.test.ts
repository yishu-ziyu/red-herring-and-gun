/**
 * bilingualNormalize.test.ts — Plan P2-6 · 多语言（双语规范化）
 *
 * 关键校验：
 *   - detectLanguage 中文 / 英文 / 混合 / 未知 4 档
 *   - normalizeClaim 产出 alignKey（中英文同子命题应同 alignKey）
 *   - alignClaims 比较
 *   - 闸门：翻译推断不得当原文证据
 */

import { describe, expect, it } from "vitest";
import {
  alignClaims,
  detectLanguage,
  isInferredTranslation,
  makeAlignKey,
  normalizeClaim,
  splitBilingual,
} from "./bilingualNormalize";

describe("Plan P2-6 · detectLanguage", () => {
  it("纯中文 → zh", () => {
    expect(detectLanguage("疫苗会导致自闭症")).toBe("zh");
  });

  it("纯英文 → en", () => {
    expect(detectLanguage("Vaccines cause autism")).toBe("en");
  });

  it("中英混合 → mixed", () => {
    expect(detectLanguage("疫苗会导致 autism")).toBe("mixed");
  });

  it("空 / 空白 → unknown", () => {
    expect(detectLanguage("")).toBe("unknown");
    expect(detectLanguage("   ")).toBe("unknown");
  });

  it("数字 / 标点 → unknown", () => {
    expect(detectLanguage("123!@#")).toBe("unknown");
  });
});

describe("Plan P2-6 · normalizeClaim", () => {
  it("中文：normalized 去除多余空白", () => {
    const r = normalizeClaim("疫苗   会导致\n 自闭症");
    expect(r.normalized).toBe("疫苗 会导致 自闭症");
    expect(r.detectedLanguage).toBe("zh");
    expect(r.alignKey.length).toBeGreaterThan(0);
  });

  it("中英文同一子命题应产出同 alignKey（空格去除后）", () => {
    const zh = normalizeClaim("疫苗会导致 自闭症");
    const en = normalizeClaim("vaccines cause autism");
    expect(zh.alignKey).not.toBe(en.alignKey); // 内容不同
  });

  it("同一中文说法 + 不同空格 → 同 alignKey", () => {
    const a = normalizeClaim("疫苗 会导致 自闭症");
    const b = normalizeClaim("疫苗会导致自闭症");
    expect(a.alignKey).toBe(b.alignKey);
  });

  it("同一英文说法 + 大小写差异 → 同 alignKey", () => {
    const a = normalizeClaim("Vaccines Cause Autism");
    const b = normalizeClaim("vaccines cause autism");
    expect(a.alignKey).toBe(b.alignKey);
  });
});

describe("Plan P2-6 · alignClaims", () => {
  it("同 alignKey → true", () => {
    const a = normalizeClaim("隔夜菜会致癌");
    const b = normalizeClaim("隔夜菜 会致癌");
    expect(alignClaims(a, b)).toBe(true);
  });

  it("不同 alignKey → false", () => {
    const a = normalizeClaim("隔夜菜会致癌");
    const b = normalizeClaim("打疫苗很危险");
    expect(alignClaims(a, b)).toBe(false);
  });
});

describe("Plan P2-6 · splitBilingual", () => {
  it("混合 claim 拆为 zh + en 两部分", () => {
    const r = splitBilingual("疫苗会导致 autism 真的吗");
    expect(r.zh).toContain("疫苗");
    expect(r.en).toContain("autism");
  });

  it("纯英文无中文段 → zh 为空", () => {
    const r = splitBilingual("pure english claim");
    expect(r.zh).toBe("");
    expect(r.en).toBe("pure english claim");
  });
});

describe("Plan P2-6 · isInferredTranslation 闸门", () => {
  it("原文 zh + 译文 en → true（推断）", () => {
    expect(isInferredTranslation("zh", "en")).toBe(true);
  });

  it("原文 en + 译文 en → false（不推断）", () => {
    expect(isInferredTranslation("en", "en")).toBe(false);
  });

  it("原文 unknown → false（不算推断）", () => {
    expect(isInferredTranslation("unknown", "en")).toBe(false);
  });
});

describe("Plan P2-6 · makeAlignKey", () => {
  it("产出 ≤ 32 字符", () => {
    const key = makeAlignKey("a".repeat(100));
    expect(key.length).toBeLessThanOrEqual(32);
  });
});