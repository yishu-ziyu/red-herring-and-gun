import { describe, expect, it } from "vitest";
import { buildDeterministicFinalReport } from "./handlers";

function expectNoInfraLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/ReportComposer|providers failed|API error|quota|credits|exceeded|timeout|time out|Error:|Exception|https?:\/\/|\/v1|\/api|调用失败|调用异常|超时|invalid api key|Insufficient Balance/i);
}

describe("deterministic final report fallback", () => {
  it("keeps provider failures out of public report fields and includes score breakdown", () => {
    const report = buildDeterministicFinalReport(
      "测试命题",
      [
        {
          agent: "rumor_detector",
          output: { severity: "high", rumorIndicators: ["绝对化表达"], detectedPatterns: [] },
        },
        {
          agent: "fact_checker",
          output: {
            factCheckResult: "unverified",
            confidence: "low",
            keyFindings: [],
            counterEvidence: [],
            sources: [],
          },
        },
        {
          agent: "source_validator",
          output: {
            sourceReliability: "unverified",
            verifiedSources: [],
            questionableSources: [],
            missingSources: ["缺少官方原始来源"],
            verificationNotes: "",
          },
        },
      ],
      { sources: [], unresolvedEvidenceGaps: ["缺少一手材料"] },
      "ReportComposer all providers failed: API error quota exceeded at https://internal.example.com/v1/messages",
    );

    expect(report._scoreBreakdown).toEqual(expect.objectContaining({
      factCheckSignal: expect.any(Number),
      searchSignal: expect.any(Number),
      sourceSignal: expect.any(Number),
      rumorPenalty: expect.any(Number),
      missingPenalty: expect.any(Number),
      supportForce: expect.any(Number),
      refuteForce: expect.any(Number),
    }));
    expectNoInfraLeak(report.whyHardToVerify);
    expectNoInfraLeak(report._fallbackReason);
  });
});
