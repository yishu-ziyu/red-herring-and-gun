import { describe, expect, it, vi } from "vitest";
import { runReportComposerWithFallback } from "../reportFallback.js";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline.js";

describe("case pipeline report timeout closure", () => {
  it("ReportComposer 不返回时用已有分条判断确定性收束，并最终发 complete", async () => {
    const sourceUrl = "https://example.com/source";
    const snapshots: Array<{ phase: string }> = [];

    const runAgent = vi.fn(
      async (
        agentId: string,
        _steps: PipelineStep[],
        _search?: unknown,
        _bundle?: unknown,
      ): Promise<PipelineStep> => {
        if (agentId === "rumor_detector") {
          return {
            agent: "rumor_detector",
            output: {
              claimAtoms: ["事实A"],
              claimAtomTypes: [{ text: "事实A", verifiable: true, type: "fact" }],
              severity: "medium",
              rumorIndicators: [],
            },
          };
        }
        if (agentId === "fact_checker") {
          return {
            agent: "fact_checker",
            output: {
              factCheckResult: "true",
              confidence: "high",
              keyFindings: ["公开材料支持事实A"],
              counterEvidence: [],
              subclaimVerdicts: [
                {
                  claimAtom: "事实A",
                  verdict: "true",
                  evidence: "公开材料支持事实A",
                  boundary: "只支持事实A本身",
                  supportingSources: [{ url: sourceUrl, title: "来源A", snippet: "事实A" }],
                  contradictingSources: [],
                },
              ],
            },
          };
        }
        if (agentId === "source_validator") {
          return {
            agent: "source_validator",
            output: {
              sourceReliability: "high",
              verifiedSources: [sourceUrl],
              questionableSources: [],
              missingSources: [],
            },
          };
        }
        if (agentId === "report_composer") {
          return await new Promise<PipelineStep>(() => {});
        }
        throw new Error(`unexpected ${agentId}`);
      },
    );

    const result = await runCasePipeline({
      claim: "事实A",
      runAgent,
      searchOne: async () => ({
        answer: "事实A",
        sources: [{ url: sourceUrl, title: "来源A", snippet: "事实A" }],
      }),
      callSelfProofModel: async () => ({
        output: { results: [{ atom: "事实A", supported: true, reason: "原句明确包含" }] },
        model: "self-proof-test",
      }),
      runReport: ({ claim, steps, search360Result, atomSearchBundle }) =>
        runReportComposerWithFallback({
          claim,
          steps,
          search360Result,
          runAgent: (agentId, reportSteps, search) =>
            runAgent(agentId, reportSteps as PipelineStep[], search, atomSearchBundle),
          timeoutMs: 5,
        }),
      evidenceLoop: { enabled: false },
      crossExam: { enabled: false },
      citationLiveness: false,
      hooks: {
        onInvestigationSnapshot: (snapshot) => snapshots.push(snapshot),
      },
    });

    expect(result.reportStep.model).toBe("fallback:deterministic-report");
    expect(result.finalReport.investigation).toEqual(expect.objectContaining({ phase: "complete" }));
    expect(snapshots.at(-1)).toEqual(expect.objectContaining({ phase: "complete" }));
    expect(result.finalReport.verdictType).not.toBeUndefined();
  });

  it("没有事实判断时超时兜底保持 unverified，不伪造硬结论", async () => {
    const step = await runReportComposerWithFallback({
      claim: "没有足够材料的说法",
      steps: [],
      search360Result: { sources: [] },
      runAgent: async () => await new Promise(() => {}),
      timeoutMs: 5,
    });

    expect(step.model).toBe("fallback:deterministic-report");
    expect(step.output.verdictType).toBe("unverified");
    expect(step.output.subclaimVerdicts).toEqual([]);
  });
});
