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

  it("buildDeterministicFinalReport 产出 subclaimVerdicts（claimAtoms 为空时返回 []）", () => {
    const steps = [
      {
        agent: "rumor_detector",
        output: {
          severity: "high",
          claimAtoms: ["原子A", "原子B"],
          rumorIndicators: ["绝对化表达"],
          detectedPatterns: [],
        },
      },
      {
        agent: "fact_checker",
        output: {
          factCheckResult: "partial",
          confidence: "medium",
          keyFindings: [],
          counterEvidence: [],
          sources: [],
          subclaimVerdicts: [
            { claimAtom: "原子A", verdict: "true", evidence: "证据A", boundary: "边界A" },
            { claimAtom: "编造原子", verdict: "false", evidence: "幻觉", boundary: "幻觉" },
          ],
        },
      },
      {
        agent: "source_validator",
        output: {
          sourceReliability: "medium",
          verifiedSources: [],
          questionableSources: [],
          missingSources: [],
          verificationNotes: "",
        },
      },
    ];
    const report = buildDeterministicFinalReport("测试命题", steps, {}, "fallback reason");
    expect(Array.isArray(report.subclaimVerdicts)).toBe(true);
    expect(report.subclaimVerdicts).toHaveLength(2);
    expect(report.subclaimVerdicts.map((r: any) => r.claimAtom)).toEqual(["原子A", "原子B"]);
    expect(report.subclaimVerdicts.find((r: any) => r.claimAtom === "原子A")?.verdict).toBe("true");
    expect(report.subclaimVerdicts.find((r: any) => r.claimAtom === "原子B")).toEqual({
      claimAtom: "原子B",
      verdict: "unverified",
      evidence: "",
      boundary: "模型未覆盖，待补证",
      supportingSources: [],
      contradictingSources: [],
      evidenceGaps: [],
    });
    expect(report.subclaimVerdicts.some((r: any) => r.claimAtom === "编造原子")).toBe(false);

    // claimAtoms 为空 → 空数组，不伪造空条目
    const emptyReport = buildDeterministicFinalReport("无原子", [], {}, "fallback reason");
    expect(emptyReport.subclaimVerdicts).toEqual([]);
  });

  it("buildDeterministicFinalReport 透传 per-verdict 结构化来源（与搜索结果交叉校验，编造 URL 丢弃）", () => {
    const realUrl = "https://real.example.com/a";
    const steps = [
      {
        agent: "rumor_detector",
        output: { severity: "medium", claimAtoms: ["原子A"], rumorIndicators: [], detectedPatterns: [] },
      },
      {
        agent: "fact_checker",
        output: {
          factCheckResult: "true",
          confidence: "high",
          keyFindings: [],
          counterEvidence: [],
          sources: [],
          subclaimVerdicts: [
            {
              claimAtom: "原子A",
              verdict: "true",
              evidence: "证据",
              boundary: "边界",
              supportingSources: [
                { url: realUrl, title: "真实来源", snippet: "真实摘要" },
                { url: "https://fabricated.example.com/x", title: "编造来源", snippet: "编造" },
              ],
              contradictingSources: [],
              evidenceGaps: ["缺官方公告"],
            },
          ],
        },
      },
      {
        agent: "source_validator",
        output: { sourceReliability: "high", verifiedSources: [], questionableSources: [], missingSources: [], verificationNotes: "" },
      },
    ];
    const report = buildDeterministicFinalReport(
      "测试命题",
      steps,
      { sources: [{ url: realUrl, title: "真实来源", snippet: "真实摘要" }], unresolvedEvidenceGaps: [] },
      "fallback reason"
    );
    const item = (report.subclaimVerdicts as any[]).find((r: any) => r.claimAtom === "原子A");
    expect(item.supportingSources).toEqual([{ url: realUrl, title: "真实来源", snippet: "真实摘要" }]);
    expect(item.contradictingSources).toEqual([]);
    expect(item.evidenceGaps).toEqual(["缺官方公告"]);
  });
});
