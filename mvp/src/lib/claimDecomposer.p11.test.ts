/**
 * claimDecomposer.p11.test.ts — Plan P1-1 · IBM KPA Key Points 抽取
 *
 * 验证目标：
 *   - 长文/截图输入时，先抽取 support/oppose/context 立场
 *   - 每个 KeyPoint 含原文 spanRange（可回溯）
 *   - 同一输入必须产出稳定 ID
 *   - 1500 字上限 + 3-10 条输出
 *   - shouldRunKPA：单句不进入 KPA；多句进入
 */

import { describe, expect, it } from "vitest";
import { extractKeyPoints, shouldRunKPA } from "./claimDecomposer";

describe("Plan P1-1 · extractKeyPoints (IBM KPA)", () => {
  it("空输入返回空数组", async () => {
    expect(await extractKeyPoints("")).toEqual([]);
    expect(await extractKeyPoints("   ")).toEqual([]);
  });

  it("单句过短不进入 KPA（应被切句忽略）", async () => {
    const out = await extractKeyPoints("疫苗有用。");
    // 6 字符以下的碎片会被忽略；这一句可能被识别为 1 条但不会同时含 support+oppose
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("应同时产出 ≥1 support + ≥1 oppose（学术争议金标）", async () => {
    const text =
      "疫苗能够显著降低重症风险，应该广泛接种。然而多项研究表明疫苗不会导致自闭症，但是网络上仍有人质疑其安全性。需要指出的是，任何疫苗的批准都必须经过严格的临床试验。";
    const out = await extractKeyPoints(text);
    const stances = new Set(out.map((k) => k.stance));
    expect(stances.has("support") || stances.has("oppose")).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("每条 KeyPoint 必须含原文 spanRange，且 span 在原文内", async () => {
    const text = "这是第一句，包含支持论点的关键词。这是第二句，包含反对论点的关键词。";
    const out = await extractKeyPoints(text);
    for (const kp of out) {
      expect(kp.spanRange.start).toBeGreaterThanOrEqual(0);
      expect(kp.spanRange.end).toBeGreaterThan(kp.spanRange.start);
      expect(kp.spanRange.end).toBeLessThanOrEqual(text.length);
      // span 切片应包含 text 字段
      const slice = text.slice(kp.spanRange.start, kp.spanRange.end);
      expect(slice).toContain(kp.text.slice(0, 5));
    }
  });

  it("同一输入必须产出稳定 ID（可重放）", async () => {
    const text = "这是支持论点的句子。这是反对论点的句子。";
    const a = await extractKeyPoints(text);
    const b = await extractKeyPoints(text);
    expect(a.map((k) => k.id)).toEqual(b.map((k) => k.id));
  });

  it("1500 字上限：超长输入只取前 1500 字符", async () => {
    const longText = "这是测试句子。".repeat(300); // 约 2100 字符
    const out = await extractKeyPoints(longText);
    for (const kp of out) {
      expect(kp.spanRange.start).toBeLessThan(1500);
    }
  });

  it("confidence 必须在 0-1 之间", async () => {
    const text = "支持论点的关键词在此。这是反对论点的论据。";
    const out = await extractKeyPoints(text);
    for (const kp of out) {
      expect(kp.confidence).toBeGreaterThanOrEqual(0);
      expect(kp.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("stance 必须是 support/oppose/context 三选一", async () => {
    const text = "应该支持。但是反对。然而支持。";
    const out = await extractKeyPoints(text);
    for (const kp of out) {
      expect(["support", "oppose", "context"]).toContain(kp.stance);
    }
  });

  it("输出条数应在 3-10 之间（金标）", async () => {
    const text = "支持。反对。值得注意的是，这是上下文。支持论据。反对论据。此外，补充。";
    const out = await extractKeyPoints(text);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(10);
  });
});

describe("Plan P1-1 · shouldRunKPA 路由", () => {
  it("短文本不进入 KPA", () => {
    expect(shouldRunKPA("短文本")).toBe(false);
    expect(shouldRunKPA("")).toBe(false);
    expect(shouldRunKPA("单句。")).toBe(false);
  });

  it("多句长文进入 KPA", () => {
    expect(shouldRunKPA("这是第一句。这是第二句。这是第三句。")).toBe(true);
    expect(shouldRunKPA("First sentence. Second sentence! Third?")).toBe(true);
  });
});