import { describe, expect, it } from "vitest";
import {
  formatReviewIssue,
  humanizeClaimType,
  humanizeConfidenceLevel,
  humanizeFactCheckResult,
  humanizeVerdictType,
  displayFaceVerdict,
  displayShareAdvice,
  shareAdviceFromVerdict,
} from "./labels";

describe("humanizeVerdictType", () => {
  it("maps known verdictType enums to Chinese labels", () => {
    expect(humanizeVerdictType("true")).toBe("能信");
    expect(humanizeVerdictType("false")).toBe("不能信");
    expect(humanizeVerdictType("mixed_misleading")).toBe("有真有假");
    expect(humanizeVerdictType("unverified")).toBe("还查不清");
  });

  it("maps common aliases without leaking English", () => {
    expect(humanizeVerdictType("uncertain")).toBe("还查不清");
    expect(humanizeVerdictType("maybe")).toBe("还查不清");
    expect(humanizeVerdictType("partial")).toBe("部分成立");
    expect(humanizeVerdictType("mixed")).toBe("有真有假");
  });

  it("does not collapse mixed and partial into one slogan", () => {
    expect(humanizeVerdictType("mixed_misleading")).not.toBe(humanizeVerdictType("partial"));
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

describe("displayFaceVerdict", () => {
  it("rewrites the old mixed stamp using verdictType, without treating other Chinese as that stamp", () => {
    expect(displayFaceVerdict("只能信一部分", "mixed_misleading")).toBe("有真有假");
    expect(displayFaceVerdict("只能信一部分。", "mixed")).toBe("有真有假");
    expect(displayFaceVerdict("只能信一部分", "partial")).toBe("部分成立");
    expect(displayFaceVerdict("只能信一部分", undefined)).toBe("有真有假");
    expect(displayFaceVerdict("立场型 / 不适用真/假判断", "mixed_misleading")).toBe(
      "立场型 / 不适用真/假判断",
    );
    expect(displayFaceVerdict("证据不足，暂不下定论", "unverified")).toBe("证据不足，暂不下定论");
    expect(displayFaceVerdict("有真有假", "mixed_misleading")).toBe("有真有假");
    expect(displayFaceVerdict("", "mixed_misleading")).toBe("有真有假");
  });
});

describe("shareAdviceFromVerdict", () => {
  it("falls back to distinct copy for mixed, partial, and unverified", () => {
    expect(shareAdviceFromVerdict("", "mixed_misleading")).toMatch(/^有真有假/);
    expect(shareAdviceFromVerdict("", "partial")).toMatch(/^部分成立/);
    expect(shareAdviceFromVerdict("", "unverified")).toMatch(/^还查不清/);
    expect(shareAdviceFromVerdict("", "mixed_misleading")).not.toBe(shareAdviceFromVerdict("", "partial"));
  });
});

describe("displayShareAdvice", () => {
  it("rewrites a stored recommendation that starts with the old mixed stamp", () => {
    expect(displayShareAdvice("只能信一部分。加热不当有风险，不能等同致癌。", "mixed_misleading")).toBe(
      "有真有假。加热不当有风险，不能等同致癌。",
    );
    expect(displayShareAdvice("只能信一部分", "mixed_misleading")).toMatch(/^有真有假。/);
    expect(displayShareAdvice("哪一截成立、哪一截没有依据，看下面。", "mixed_misleading")).toBe(
      "哪一截成立、哪一截没有依据，看下面。",
    );
    expect(displayShareAdvice("", "mixed_misleading")).toBe("");
  });
});

describe("humanizeFactCheckResult", () => {
  it("maps factCheckResult enums to Chinese", () => {
    expect(humanizeFactCheckResult("true")).toBe("能信");
    expect(humanizeFactCheckResult("false")).toBe("不能信");
    expect(humanizeFactCheckResult("partial")).toBe("部分成立");
    expect(humanizeFactCheckResult("mixed_misleading")).toBe("有真有假");
    expect(humanizeFactCheckResult("unverified")).toBe("还查不清");
  });
});

describe("humanizeClaimType", () => {
  it("maps planner claimType enums", () => {
    expect(humanizeClaimType("causal")).toBe("因果推断");
    expect(humanizeClaimType("concept")).toBe("概念说法");
    expect(humanizeClaimType("event")).toBe("事件说法");
    expect(humanizeClaimType("mixed")).toBe("混合说法");
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
