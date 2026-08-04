/**
 * admiraltyRating.test.ts — Plan P2-3 · NATO Admiralty Code 双轴评级
 *
 * 关键校验：
 *   - 来源可靠性 A-F 映射（含 unrated 兜底 F）
 *   - 信息准确性 1-6 映射（含 0 来源 → 6）
 *   - 匿名/营销号强制降级 E
 *   - formatAdmiraltyRating 输出可读
 */

import { describe, expect, it } from "vitest";
import {
  formatAdmiraltyRating,
  rateAdmiralty,
  unratedAdmiralty,
} from "./admiraltyRating";

describe("Plan P2-3 · rateAdmiralty", () => {
  it("正向历史 + 一手 → A/1（最高级）", () => {
    const r = rateAdmiralty({
      sourceHistory: "positive",
      isPrimary: true,
      crossVerifiedByIndependentSources: 3,
      isRecent: true,
    });
    expect(r.sourceReliability).toBe("A");
    expect(r.informationCredibility).toBe("1");
  });

  it("正向历史 + 非一手 → B/2", () => {
    const r = rateAdmiralty({
      sourceHistory: "positive",
      isPrimary: false,
      crossVerifiedByIndependentSources: 3,
      isRecent: false,
    });
    expect(r.sourceReliability).toBe("B");
    expect(r.informationCredibility).toBe("2");
  });

  it("混合历史 → C/3", () => {
    const r = rateAdmiralty({
      sourceHistory: "mixed",
      crossVerifiedByIndependentSources: 1,
    });
    expect(r.sourceReliability).toBe("C");
    expect(r.informationCredibility).toBe("3");
  });

  it("负向历史 + 非一手 → E/4", () => {
    const r = rateAdmiralty({
      sourceHistory: "negative",
      isPrimary: false,
      crossVerifiedByIndependentSources: 0,
    });
    expect(r.sourceReliability).toBe("E");
    expect(r.informationCredibility).toBe("4");
  });

  it("负向历史 + 一手 → D/4（仍降级但保留一定可靠度）", () => {
    const r = rateAdmiralty({
      sourceHistory: "negative",
      isPrimary: true,
      crossVerifiedByIndependentSources: 0,
    });
    expect(r.sourceReliability).toBe("D");
  });

  it("匿名 / 营销号强制 E（覆盖正向历史）", () => {
    const r = rateAdmiralty({
      sourceHistory: "positive",
      isPrimary: true,
      isAnonymousOrMarketing: true,
      crossVerifiedByIndependentSources: 5,
      isRecent: true,
    });
    expect(r.sourceReliability).toBe("E");
  });

  it("unrated history + 0 独立来源 → F/6（无法判断）", () => {
    const r = rateAdmiralty({});
    expect(r.sourceReliability).toBe("F");
    expect(r.informationCredibility).toBe("6");
  });

  it("2 独立来源 + 不 recent → 信息准确性 3", () => {
    const r = rateAdmiralty({
      sourceHistory: "positive",
      crossVerifiedByIndependentSources: 2,
      isRecent: false,
    });
    expect(r.informationCredibility).toBe("3");
  });

  it("rationale 必须含两段描述", () => {
    const r = rateAdmiralty({
      sourceHistory: "mixed",
      crossVerifiedByIndependentSources: 1,
    });
    expect(r.rationale.length).toBeGreaterThan(0);
    expect(r.rationale).toContain("；");
  });

  it("assessed=true 当输入信号足够", () => {
    const r = rateAdmiralty({ sourceHistory: "positive" });
    expect(r.assessed).toBe(true);
  });
});

describe("Plan P2-3 · unratedAdmiralty", () => {
  it("返回 F/6 + assessed=false + 自定义理由", () => {
    const r = unratedAdmiralty("缺源历史");
    expect(r.sourceReliability).toBe("F");
    expect(r.informationCredibility).toBe("6");
    expect(r.assessed).toBe(false);
    expect(r.rationale).toBe("缺源历史");
  });

  it("默认理由为「无足够信号」", () => {
    const r = unratedAdmiralty();
    expect(r.rationale).toBe("无足够信号");
  });
});

describe("Plan P2-3 · formatAdmiraltyRating", () => {
  it("已评级：输出 A1 形式", () => {
    const out = formatAdmiraltyRating(rateAdmiralty({ sourceHistory: "positive", isPrimary: true, crossVerifiedByIndependentSources: 3, isRecent: true }));
    expect(out).toContain("A");
    expect(out).toContain("1");
    expect(out).toContain("完全可靠");
    expect(out).toContain("确认");
  });

  it("未评级：输出「无法评级」", () => {
    expect(formatAdmiraltyRating(unratedAdmiralty())).toBe("无法评级");
  });
});