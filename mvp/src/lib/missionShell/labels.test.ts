import { describe, expect, it } from "vitest";
import {
  formatReviewIssue,
  humanizeClaimType,
  humanizeConfidenceLevel,
  humanizeFactCheckResult,
  humanizeVerdictType,
} from "./labels";

describe("humanizeVerdictType", () => {
  it("maps known verdictType enums to Chinese labels", () => {
    expect(humanizeVerdictType("true")).toBe("能信");
    expect(humanizeVerdictType("false")).toBe("不能信");
    expect(humanizeVerdictType("mixed_misleading")).toBe("只能信一部分");
    expect(humanizeVerdictType("unverified")).toBe("还查不清");
  });

  it("maps common aliases without leaking English", () => {
    expect(humanizeVerdictType("uncertain")).toBe("还查不清");
    expect(humanizeVerdictType("maybe")).toBe("还查不清");
    expect(humanizeVerdictType("partial")).toBe("只能信一部分");
    expect(humanizeVerdictType("mixed")).toBe("只能信一部分");
  });

  it("falls back to em dash for empty values", () => {
    expect(humanizeVerdictType(undefined)).toBe("—");
    expect(humanizeVerdictType(null)).toBe("—");
    expect(humanizeVerdictType("")).toBe("—");
    expect(humanizeVerdictType("   ")).toBe("—");
  });

  it("does not pass through raw machine tokens", () => {
    expect(humanizeVerdictType("unknown_enum")).toBe("还查不清");
    expect(humanizeVerdictType("foo-bar")).toBe("还查不清");
  });

  it("keeps free-form Chinese or mixed prose", () => {
    expect(humanizeVerdictType("证据不足，暂不下定论")).toBe("证据不足，暂不下定论");
  });
});

describe("humanizeFactCheckResult", () => {
  it("maps factCheckResult enums to Chinese", () => {
    expect(humanizeFactCheckResult("true")).toBe("能信");
    expect(humanizeFactCheckResult("false")).toBe("不能信");
    expect(humanizeFactCheckResult("partial")).toBe("只能信一部分");
    expect(humanizeFactCheckResult("unverified")).toBe("还查不清");
  });
});

describe("humanizeClaimType", () => {
  it("maps planner claimType enums", () => {
    expect(humanizeClaimType("causal")).toBe("因果命题");
    expect(humanizeClaimType("concept")).toBe("概念命题");
    expect(humanizeClaimType("event")).toBe("事件命题");
    expect(humanizeClaimType("mixed")).toBe("混合命题");
  });

  it("returns empty for missing claimType", () => {
    expect(humanizeClaimType(undefined)).toBe("");
    expect(humanizeClaimType("")).toBe("");
  });
});

describe("humanizeConfidenceLevel", () => {
  it("maps high/medium/low", () => {
    expect(humanizeConfidenceLevel("high")).toBe("高");
    expect(humanizeConfidenceLevel("medium")).toBe("中");
    expect(humanizeConfidenceLevel("low")).toBe("低");
  });
});

describe("formatReviewIssue", () => {
  it("prefixes error with 严重 · and preserves message", () => {
    expect(
      formatReviewIssue({ severity: "error", message: "缺少关键证据" }),
    ).toBe("严重 · 缺少关键证据");
  });

  it("prefixes warn with 注意 · and preserves message", () => {
    expect(
      formatReviewIssue({ severity: "warn", message: "来源可信度偏低" }),
    ).toBe("注意 · 来源可信度偏低");
  });

  it("treats warning as warn", () => {
    expect(
      formatReviewIssue({ severity: "warning", message: "表述略夸大" }),
    ).toBe("注意 · 表述略夸大");
  });

  it("returns bare message when severity is neither error nor warn", () => {
    expect(
      formatReviewIssue({ severity: "info", message: "仅供参考" }),
    ).toBe("仅供参考");
    expect(formatReviewIssue({ message: "无严重度" })).toBe("无严重度");
  });

  it("returns empty for missing message", () => {
    expect(formatReviewIssue({ severity: "error", message: "" })).toBe("");
    expect(formatReviewIssue({ severity: "error" })).toBe("");
  });
});
