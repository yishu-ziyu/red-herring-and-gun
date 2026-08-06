import { describe, expect, it, vi } from "vitest";
import { runCasePipeline } from "./runCasePipeline";
import type { PipelineStep } from "./runCasePipeline";

describe("runCasePipeline", () => {
  it("顺序：rumor → self-proof 过滤 → 只搜可核查 → assemble 排除立场", async () => {
    const searchOne = vi.fn(async (atom: string) => ({
      answer: atom,
      model: "m",
      sources: [{ url: `https://t.test/${encodeURIComponent(atom)}`, title: atom, snippet: "s" }],
    }));

    const runAgent = vi.fn(async (agentId: string, _steps: PipelineStep[]): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["事实A", "价值B", "幻觉碎片"],
            claimAtomTypes: [
              { text: "事实A", verifiable: true, type: "fact" },
              { text: "价值B", verifiable: false, type: "value" },
              { text: "幻觉碎片", verifiable: true, type: "fact" },
            ],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "partial",
            subclaimVerdicts: [
              { claimAtom: "事实A", verdict: "true", evidence: "e", boundary: "b" },
              { claimAtom: "价值B", verdict: "false", evidence: "no", boundary: "x" },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      if (agentId === "report_composer") {
        return {
          agent: "report_composer",
          output: {
            verdictType: "mixed_misleading",
            conclusion: "c",
            subclaimVerdicts: [
              { claimAtom: "事实A", verdict: "true", evidence: "e", boundary: "b" },
            ],
          },
        };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "原句含事实A与价值B",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: {
          results: [
            { atom: "事实A", supported: true, reason: "ok" },
            { atom: "价值B", supported: true, reason: "stance ok" },
            { atom: "幻觉碎片", supported: false, reason: "not in claim" },
          ],
        },
        model: "selfproof-m",
      }),
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        runAgent("report_composer", steps, search360Result, atomSearchBundle),
    });

    // 幻觉碎片被自证丢掉后不应被检索
    expect(searchOne.mock.calls.map((c) => c[0])).toEqual(["事实A"]);
    expect(result.finalReport.subclaimVerdicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimAtom: "事实A", verdict: "true" }),
      ])
    );
    expect(
      (result.finalReport.subclaimVerdicts as Array<{ claimAtom: string }>).map((v) => v.claimAtom)
    ).not.toContain("价值B");
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: "价值B", type: "value" }]);
    expect(result.rumorStep.output.claimAtoms).toEqual(["事实A", "价值B"]);
  });
});
