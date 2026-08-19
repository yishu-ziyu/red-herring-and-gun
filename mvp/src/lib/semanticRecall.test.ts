import { describe, expect, it } from "vitest";
import {
  hanCharDice,
  semanticClaimSimilarity,
  semanticTokensOf,
  synonymTokensOf,
} from "./semanticRecall";

describe("synonymTokensOf", () => {
  it("同义词组内任意成员 → 同一规范 token", () => {
    const a = synonymTokensOf("我的电瓶车被偷走了");
    const b = synonymTokensOf("电动车失窃送国外");
    expect(a.size).toBeGreaterThan(0);
    // 交集非空：电瓶车↔电动车（syn:0）、被偷↔失窃（syn:1）桥接成功
    const shared = [...a].filter((token) => b.has(token));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it("无命中返回空集", () => {
    expect(synonymTokensOf("今天天气不错")).toBeInstanceOf(Set);
    expect(synonymTokensOf("今天天气不错").size).toBe(0);
  });
});

describe("semanticTokensOf", () => {
  it("包含 bigram、拉丁词与同义词 token", () => {
    const tokens = semanticTokensOf("电瓶车 stolen in Beijing 辟谣");
    expect(tokens.has("syn:0")).toBe(true); // 电瓶车组
    expect(tokens.has("stolen")).toBe(true);
    expect(tokens.has("beijing")).toBe(true);
    expect(tokens.has("辟谣")).toBe(true);
  });
});

describe("hanCharDice", () => {
  it("相同文本 = 1，全异 = 0，转述有中间值", () => {
    expect(hanCharDice("电瓶车被偷", "电瓶车被偷")).toBe(1);
    expect(hanCharDice("完全不同", "毫无关系吧")).toBe(0);
    const mid = hanCharDice("电瓶车被偷到非洲", "电动车失窃送往国外");
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("semanticClaimSimilarity", () => {
  it("同义改写说法仍有可观相似度（G2 核心场景）", () => {
    const score = semanticClaimSimilarity(
      "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
      "电动车失窃后被送往国外的核查记录"
    );
    expect(score).toBeGreaterThanOrEqual(25);
  });

  it("完全相同 → 高分", () => {
    expect(semanticClaimSimilarity("冷冻馒头致癌", "冷冻馒头致癌")).toBeGreaterThanOrEqual(95);
  });

  it("无关说法 → 低分不误召回", () => {
    const score = semanticClaimSimilarity(
      "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
      "高考录取通知书丢失爱心接力"
    );
    expect(score).toBeLessThan(25);
  });

  it("空输入 → 0", () => {
    expect(semanticClaimSimilarity("", "任意")).toBe(0);
    expect(semanticClaimSimilarity("任意", "")).toBe(0);
  });
});
