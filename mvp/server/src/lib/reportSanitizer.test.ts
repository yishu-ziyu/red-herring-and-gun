import { describe, expect, it } from "vitest";
import { sanitizePublicReportArray, sanitizePublicReportText } from "./reportSanitizer";

const SAFE_FALLBACK = "最终写作服务暂时不可用，系统已改用保守兜底报告。";

function expectNoInfraLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/ReportComposer|providers failed|API error|quota|credits|exceeded|timeout|time out|Error:|Exception|https?:\/\/|\/v1|\/api|调用失败|调用异常|超时|invalid api key|Insufficient Balance/i);
}

describe("reportSanitizer", () => {
  it("replaces provider and infrastructure errors with stable public copy", () => {
    const result = sanitizePublicReportText(
      "ReportComposer all providers failed: API error quota exceeded at https://internal.example.com/v1/messages",
      SAFE_FALLBACK,
    );

    expect(result).toBe(SAFE_FALLBACK);
    expectNoInfraLeak(result);
  });

  it("keeps normal evidence text", () => {
    const text = "原始 claim 中未明确提及研究或机构，需要补充一手来源。";
    expect(sanitizePublicReportText(text, SAFE_FALLBACK)).toBe(text);
  });

  it("keeps blank and source URL text as content, not fallback failures", () => {
    expect(sanitizePublicReportText("", SAFE_FALLBACK)).toBe("");
    expect(sanitizePublicReportText("官方说明见 https://example.com/news/v1-release", SAFE_FALLBACK)).toBe(
      "官方说明见 https://example.com/news/v1-release",
    );
  });

  it("sanitizes arrays and preserves safe items", () => {
    const result = sanitizePublicReportArray(
      [
        "搜索服务暂时不可用：360 AI Search 调用失败：quota exceeded",
        "搜索结果和 Agent 输出只能作为核查线索，不能替代原始材料。",
      ],
      SAFE_FALLBACK,
    );

    expect(result).toEqual([
      SAFE_FALLBACK,
      "搜索结果和 Agent 输出只能作为核查线索，不能替代原始材料。",
    ]);
    expectNoInfraLeak(result);
  });
});
