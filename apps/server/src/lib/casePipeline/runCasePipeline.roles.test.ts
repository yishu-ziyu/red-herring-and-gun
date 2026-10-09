/** 拆题的角色与忠实性在真实管线里生效：短单句不拆、编造的命题丢掉、价值判断不当事实查。 */
import { describe, expect, it, vi } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { confirmedSourceValidatorStep } from "./testSourceRelationAudit";

async function run(claim: string, atoms: string[], types: Array<Record<string, unknown>>) {
  const searched: string[] = [];
  const runAgent = vi.fn(async (agentId: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (agentId === "rumor_detector") return { agent: agentId, output: { claimAtoms: atoms, claimAtomTypes: types } };
    if (agentId === "fact_checker") return { agent: agentId, output: { factCheckResult: "unverified", subclaimVerdicts: [] } };
    if (agentId === "source_validator") return confirmedSourceValidatorStep(steps, "medium");
    if (agentId === "report_composer") return { agent: agentId, output: { verdictType: "unverified", conclusion: "c" } };
    throw new Error(`unexpected ${agentId}`);
  });
  const result = await runCasePipeline({
    claim,
    runAgent,
    searchOne: async (query: string) => {
      searched.push(query);
      return { answer: "", model: "m", sources: [] };
    },
    callSelfProofModel: async () => ({
      output: { results: atoms.map((atom) => ({ atom, supported: true, reason: "ok" })) },
      model: "m",
    }),
    runReport: async () => ({ agent: "report_composer", output: { verdictType: "unverified", conclusion: "c" } }),
  });
  return { result, searched };
}

describe("拆题角色与忠实性（管线）", () => {
  it("短单句被拆成碎片：收回成原句一条主要主张，检索只搜这一条", async () => {
    const claim = "常穿黑色内衣易患癌";
    const { result, searched } = await run(claim, ["常穿黑色内衣", "内衣易患癌"], [
      { text: "常穿黑色内衣", verifiable: true, type: "fact" },
      { text: "内衣易患癌", verifiable: true, type: "causal" },
    ]);
    expect(result.rumorStep.output.claimAtoms).toEqual([claim]);
    expect(result.rumorStep.output.claimAtomTypes).toEqual([{ text: claim, verifiable: true, type: "fact", role: "main" }]);
    expect(searched.every((q) => q.includes("黑色内衣"))).toBe(true);
  });

  it("span 对不上原句的命题是拆题编造的，不进入检索与判定", async () => {
    const claim = "某药已获批准，而且能根治失眠";
    const { result, searched } = await run(claim, ["某药已获批准", "能根治失眠", "该药有明确剂量阈值"], [
      { text: "某药已获批准", verifiable: true, type: "fact", role: "background", span: "某药已获批准" },
      { text: "能根治失眠", verifiable: true, type: "fact", role: "main", span: "能根治失眠" },
      { text: "该药有明确剂量阈值", verifiable: true, type: "fact", role: "premise", span: "剂量阈值" },
    ]);
    expect(result.rumorStep.output.claimAtoms).toEqual(["某药已获批准", "能根治失眠"]);
    expect(searched.some((q) => q.includes("剂量阈值"))).toBe(false);
  });

  it("价值判断（NEW-301）：模型当事实标了 verifiable，也改标立场型，不检索", async () => {
    const claim = "小区里就不该允许养大型犬";
    const { result, searched } = await run(claim, [claim], [{ text: claim, verifiable: true, type: "fact" }]);
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: claim, type: "normative" }]);
    expect(searched).toEqual([]);
  });
});
