import { expect, it, vi } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { buildAgentInput } from "../agentConfigs";

it("质询→原命题补查→主调查回应→报告使用更新判词", async () => {
  const atom = "该研究证明儿童也有效";
  const first = { url: "https://study.test/adult", title: "成人研究", snippet: "成人研究结果" };
  const extra = { url: "https://study.test/children", title: "儿童范围", snippet: "未纳入儿童" };
  const searchOne = vi.fn(async (query: string) => ({ sources: query === atom ? [first] : [extra] }));
  let checks = 0;
  const runAgent = async (agent: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (agent === "rumor_detector") return { agent, output: { claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }] } };
    if (agent !== "fact_checker") return { agent, output: {} };
    checks++;
    if (checks === 2) expect(buildAgentInput(agent, atom, steps).crossExam).toMatchObject({ atoms: [expect.objectContaining({ challenge: "研究是否纳入儿童？", searchStatus: "completed" })] });
    return { agent, output: { factCheckResult: checks === 1 ? "true" : "false", subclaimVerdicts: [{ claimAtom: atom, verdict: checks === 1 ? "true" : "false", evidence: "研究未纳入儿童", evidenceGaps: ["年龄范围"], supportingSources: [checks === 1 ? first : extra], crossExamResponse: checks === 2 ? "原文未纳入儿童，撤回适用于儿童的判断" : undefined }] } };
  };
  const result = await runCasePipeline({ claim: atom, runAgent, searchOne, citationLiveness: false, evidenceLoop: { enabled: false }, callSelfProofModel: async () => ({ output: { results: [{ atom, supported: true }] }, model: "self" }), crossExam: { callRaw: async ({ userContent }) => {
    expect(userContent).not.toContain("primaryVerdict");
    return { model: "second", output: { verdict: "unverified", reason: "范围缺口", challenge: "研究是否纳入儿童？", query: "研究 儿童 纳入标准", sources: [first.url] } };
  } }, runReport: async ({ steps }) => {
    expect(buildAgentInput("report_composer", atom, steps).factCheck).toMatchObject({ result: "false" });
    return { agent: "report_composer", output: { conclusion: "不能推出儿童有效", verdictType: "false" } };
  } });
  expect(checks).toBe(2);
  expect(searchOne).toHaveBeenCalledTimes(2);
  expect(result.atomSearchBundle.atomsSearched).toEqual([atom]);
  expect(result.finalReport.crossExam).toMatchObject({ atoms: [expect.objectContaining({ status: "answered", response: "原文未纳入儿童，撤回适用于儿童的判断", finalVerdict: "false" })] });
});
