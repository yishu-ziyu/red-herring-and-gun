import { describe, expect, it } from "vitest";
import { aggregateRepeats } from "./score";

describe("aggregateRepeats", () => {
  it("verdict 取多数票，credibility 取中位数", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 4 },
      { verdict: "unverified", credibility: 30 },
      { verdict: "false", credibility: 9 },
    ]);
    expect(result.verdict).toBe("false");
    expect(result.credibility).toBe(9);
    expect(result.verdictVotes).toEqual({ false: 2, unverified: 1 });
    expect(result.error).toBeUndefined();
  });

  it("偶数样本 credibility 取中间两值平均并四舍五入", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 4 },
      { verdict: "false", credibility: 10 },
    ]);
    expect(result.credibility).toBe(7);
  });

  it("全部 error 时返回 ERROR", () => {
    const result = aggregateRepeats([
      { verdict: "?", credibility: 0, error: "timeout" },
      { verdict: "?", credibility: 0, error: "timeout" },
    ]);
    expect(result.verdict).toBe("ERROR");
    expect(result.error).toBe("timeout");
  });

  it("部分 error 时只聚合成功轮次", () => {
    const result = aggregateRepeats([
      { verdict: "false", credibility: 6 },
      { verdict: "?", credibility: 0, error: "boom" },
      { verdict: "mixed_misleading", credibility: 20 },
    ]);
    // 并列 1:1 时按字典序取更小者（false < mixed_misleading）
    expect(result.verdict).toBe("false");
    expect(result.credibility).toBe(13);
    expect(result.error).toBeUndefined();
  });
});
