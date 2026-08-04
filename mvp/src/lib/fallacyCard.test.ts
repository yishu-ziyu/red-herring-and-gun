/**
 * fallacyCard.test.ts — Plan P1-5 · 逻辑谬误诊断卡测试
 *
 * 关键校验：
 *   - 5 类常见谬误（strawman/false_cause/hasty_gen/ad_hominem/appeal_to_authority）应被识别
 *   - 每条 finding 含 quote/charOffsetStart/charOffsetEnd/rationale/confidence
 *   - 不得从缺证据自动推断谬误
 *   - quote 必须是原文子串（diff=0）
 *   - 短中性文本不命中
 */

import { describe, expect, it } from "vitest";
import { detectFallacies, FALLACY_TYPE_LABELS } from "./fallacyCard";

describe("Plan P1-5 · detectFallacies", () => {
  it("空文本：0 finding + hasFallacy=false", () => {
    const out = detectFallacies("");
    expect(out.findings).toEqual([]);
    expect(out.hasFallacy).toBe(false);
    expect(out.count).toBe(0);
  });

  it("中性短文本（无谬误）：不命中", () => {
    const out = detectFallacies("今天天气晴朗，最高气温 28 度。");
    expect(out.findings.length).toBe(0);
  });

  it("false_cause（因果跳跃）：应被识别", () => {
    const out = detectFallacies("因为今年冬天特别冷，所以明年房价一定会下跌。");
    const hit = out.findings.find((f) => f.type === "false_cause");
    expect(hit).toBeDefined();
    expect(out.hasFallacy).toBe(true);
  });

  it("strawman（稻草人）：应被识别", () => {
    const out = detectFallacies("说白了他们就是想让房价崩盘然后抄底收购。");
    const hit = out.findings.find((f) => f.type === "strawman");
    expect(hit).toBeDefined();
  });

  it("hasty_gen（以偏概全）：应被识别", () => {
    const out = detectFallacies("看到某地某事发生，所以全国都一样。");
    const hit = out.findings.find((f) => f.type === "hasty_gen");
    expect(hit).toBeDefined();
  });

  it("appeal_to_authority（诉诸权威）：应被识别", () => {
    const out = detectFallacies("权威人士说这个药 100% 有效。");
    const hit = out.findings.find((f) => f.type === "appeal_to_authority");
    expect(hit).toBeDefined();
  });

  it("每条 finding 必须含完整字段（type/quote/charOffset/rationale/confidence）", () => {
    const text = "因为天气冷，所以病毒传播更快。"
    const out = detectFallacies(text);
    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) {
      expect(f.type).toBeTruthy();
      expect(typeof f.quote).toBe("string");
      expect(f.quote.length).toBeGreaterThan(0);
      expect(typeof f.charOffsetStart).toBe("number");
      expect(typeof f.charOffsetEnd).toBe("number");
      expect(f.charOffsetStart).not.toBeNull();
      expect(f.charOffsetEnd).not.toBeNull();
      expect(text.slice(f.charOffsetStart!, f.charOffsetEnd!)).toBe(f.quote);
      expect(typeof f.rationale).toBe("string");
      expect(f.rationale.length).toBeGreaterThan(0);
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("闸门：不得从缺证据自动推断谬误（中性陈述不标）", () => {
    const text = "该研究尚未发布最终结论，证据不足以支持任何因果判断。";
    const out = detectFallacies(text);
    // 这段话在讲"证据不足"，本身不包含谬误信号词
    expect(out.findings.length).toBe(0);
  });

  it("FALLACY_TYPE_LABELS 必须含 5 类中文标签", () => {
    expect(Object.keys(FALLACY_TYPE_LABELS).length).toBe(5);
    expect(FALLACY_TYPE_LABELS.false_cause).toBeTruthy();
    expect(FALLACY_TYPE_LABELS.strawman).toBeTruthy();
    expect(FALLACY_TYPE_LABELS.hasty_gen).toBeTruthy();
    expect(FALLACY_TYPE_LABELS.ad_hominem).toBeTruthy();
    expect(FALLACY_TYPE_LABELS.appeal_to_authority).toBeTruthy();
  });

  it("按 confidence 降序排列", () => {
    const text = "因为天气冷，所以病毒传播。看到了某个案例，所以全国都是。";
    const out = detectFallacies(text);
    for (let i = 1; i < out.findings.length; i++) {
      expect(out.findings[i - 1].confidence).toBeGreaterThanOrEqual(
        out.findings[i].confidence,
      );
    }
  });

  it("复杂三正例 + 一无谬误负例（混合场景）", () => {
    const examples = [
      { text: "因为网络速度慢，所以国家发展停滞。", expectType: "false_cause" as const },
      { text: "说白了他们就是想让经济崩盘然后抄底。", expectType: "strawman" as const },
      { text: "看到某地发生事故，这就是全国的常态。", expectType: "hasty_gen" as const },
      { text: "今天出版了新书，封面很好看。", expectType: null },
    ];
    for (const ex of examples) {
      const out = detectFallacies(ex.text);
      if (ex.expectType === null) {
        expect(out.findings.length).toBe(0);
      } else {
        const hit = out.findings.find((f) => f.type === ex.expectType);
        expect(hit).toBeDefined();
      }
    }
  });
});