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

  it("buildDeterministicFinalReport 排除层：verifiable=false 原子进 nonVerifiableAtoms，不进 subclaimVerdicts", () => {
    const steps = [
      {
        agent: "rumor_detector",
        output: {
          severity: "medium",
          claimAtoms: ["事实A", "价值B", "事实C"],
          claimAtomTypes: [
            { text: "事实A", verifiable: true, type: "fact" },
            { text: "价值B", verifiable: false, type: "value" },
            { text: "事实C", verifiable: true, type: "fact" },
          ],
          claimType: { verifiable: false, type: "value", reason: "整句为价值判断" },
          rumorIndicators: [],
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
            { claimAtom: "事实A", verdict: "true", evidence: "E", boundary: "B" },
            { claimAtom: "价值B", verdict: "false", evidence: "E", boundary: "B" },
            { claimAtom: "事实C", verdict: "false", evidence: "E", boundary: "B" },
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
    // 不变量：verifiable=false 的价值B 绝不进 subclaimVerdicts
    expect(report.subclaimVerdicts.map((r: any) => r.claimAtom)).toEqual(["事实A", "事实C"]);
    expect(report.subclaimVerdicts.some((r: any) => r.claimAtom === "价值B")).toBe(false);
    // 非核查原子单独承载
    expect(report.nonVerifiableAtoms).toEqual([{ text: "价值B", type: "value" }]);
    // 整句立场信息透传
    expect(report.claimType).toEqual({ verifiable: false, type: "value", reason: "整句为价值判断" });
    // 全局原子顺序：立场原子按原句序原位插回（A、B、C 交错），而非可核查在前、立场沉底
    expect(report.claimAtomOrder).toEqual(["事实A", "价值B", "事实C"]);
  });

  it("buildDeterministicFinalReport 排除层：claimAtomOrder 只含真正展示的原子（超限原子不进）", () => {
    const steps = [
      {
        agent: "rumor_detector",
        output: {
          severity: "medium",
          claimAtoms: ["原子1", "原子2", "原子3", "原子4", "原子5", "原子6", "原子7"],
          claimAtomTypes: [
            { text: "原子1", verifiable: true, type: "fact" },
            { text: "原子7", verifiable: false, type: "value" },
          ],
          rumorIndicators: [],
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
          subclaimVerdicts: [],
        },
      },
      {
        agent: "source_validator",
        output: { sourceReliability: "medium", verifiedSources: [], questionableSources: [], missingSources: [], verificationNotes: "" },
      },
    ];
    const report = buildDeterministicFinalReport("测试命题", steps, {}, "fallback reason");
    // compactStrings 截断到 6 条：原子7 超限不展示，也就不能进 order
    expect(report.claimAtomOrder).toEqual(["原子1", "原子2", "原子3", "原子4", "原子5", "原子6"]);
    expect(report.claimAtomOrder).not.toContain("原子7");
  });

  it("buildDeterministicFinalReport 排除层：claimAtomTypes 缺失时全部可核查、不产生非核查桶", () => {
    const steps = [
      {
        agent: "rumor_detector",
        output: { severity: "medium", claimAtoms: ["原子A"], rumorIndicators: [], detectedPatterns: [] },
      },
      {
        agent: "fact_checker",
        output: {
          factCheckResult: "partial",
          confidence: "medium",
          keyFindings: [],
          counterEvidence: [],
          sources: [],
          subclaimVerdicts: [{ claimAtom: "原子A", verdict: "true", evidence: "E", boundary: "B" }],
        },
      },
      {
        agent: "source_validator",
        output: { sourceReliability: "medium", verifiedSources: [], questionableSources: [], missingSources: [], verificationNotes: "" },
      },
    ];
    const report = buildDeterministicFinalReport("测试命题", steps, {}, "fallback reason");
    expect(report.subclaimVerdicts.map((r: any) => r.claimAtom)).toEqual(["原子A"]);
    expect(report.nonVerifiableAtoms).toEqual([]);
    expect(report.claimType).toBeUndefined();
  });
});
