/**
 * factDeskWriter.p02.test.ts — 验证 Plan P0-2 求证语言模板
 *
 * 借鉴新华社 / 央视「求证」栏目：
 *   - 结论首句以「求证：网传『……』，经核查……」开头
 *   - 三段式边界：目前可以确认 / 目前不能确认
 *   - cannotSay 不得伪装成肯定句
 */

import { describe, expect, it } from "vitest";
import {
  canSaySentence,
  cannotSaySentence,
  qiuzhengSentence,
} from "./factDeskWriter";

describe("Plan P0-2 · 求证语言模板", () => {
  it("qiuzhengSentence 应以「求证：网传『…』，经核查」开头", () => {
    const out = qiuzhengSentence("某明星昨天因某事件被捕", null);
    expect(out.startsWith("求证：网传「")).toBe(true);
    expect(out).toContain("某明星");
    expect(out).toMatch(/经核查/);
  });

  it("qiuzhengSentence 在支持句为空时应注入「现有公开材料不足以按原强度成立」", () => {
    const out = qiuzhengSentence("网传：xxx 会导致 yyy", null);
    expect(out).toMatch(/现有公开材料不足以按原强度成立|暂无可靠证据/);
  });

  it("qiuzhengSentence 在支持句存在时复用之", () => {
    const out = qiuzhengSentence("网传：xxx", "公开材料（国食安）显示：正常储存远低于限量");
    expect(out).toContain("国食安");
    expect(out).toContain("正常储存");
  });

  it("qiuzhengSentence 在 claim 为空时进入 fallback 分支", () => {
    expect(qiuzhengSentence("", null)).toMatch(/边界不清/);
    expect(qiuzhengSentence("   ", null)).toMatch(/边界不清/);
  });

  it("canSaySentence 必须以「目前可以确认：」开头", () => {
    const out = canSaySentence(["官方已辟谣", "三家媒体报道"]);
    expect(out.startsWith("目前可以确认：")).toBe(true);
    expect(out).toContain("官方已辟谣");
    expect(out).toContain("三家媒体报道");
  });

  it("canSaySentence 空数组时必须降级到兜底句", () => {
    expect(canSaySentence([])).toMatch(/目前可以确认：暂无/);
  });

  it("cannotSaySentence 必须以「目前不能确认：」开头", () => {
    const out = cannotSaySentence(["缺少原始来源", "无独立信源"]);
    expect(out.startsWith("目前不能确认：")).toBe(true);
    expect(out).toContain("缺少原始来源");
  });

  it("cannotSaySentence 必须把肯定句开头的项目重写为「不能支持」", () => {
    const out = cannotSaySentence(["是已经证实的", "可以确定事件发生"]);
    // 防止 cannotSay 内容伪装成肯定句
    expect(out).not.toMatch(/^目前不能确认：是已经/);
    expect(out).not.toMatch(/^目前不能确认：可以确定/);
    expect(out).toContain("不能支持");
  });

  it("cannotSaySentence 空数组时必须降级到兜底句", () => {
    expect(cannotSaySentence([])).toMatch(/目前不能确认：.*不能按其原强度成立/);
  });

  it("qiuzhengSentence 长度不应超过 80 字符（控制读屏节奏）", () => {
    const long = "x".repeat(200);
    const out = qiuzhengSentence(long, null);
    expect(out.length).toBeLessThanOrEqual(80);
  });
});