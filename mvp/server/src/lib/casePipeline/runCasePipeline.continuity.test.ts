import { expect, it } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { buildReportEvidenceInputs } from "../searchProviders";
import { buildDeterministicFinalReport } from "../reportFallback";

it("both report evidence and fallback consume the latest investigation", () => {
  const steps = ["true", "false"].map(factCheckResult => ({ agent: "fact_checker", output: { factCheckResult } }));
  expect(buildReportEvidenceInputs(steps, {}).factFindings.result).toBe("false");
  expect(buildDeterministicFinalReport("原句", steps, {}, "").verdictType).toBe("false");
});

it.each(["missing-atom", "missing-response"])("does not replace the investigation with an incomplete %s reply", async (failure) => {
  const a = "甲已经发生", b = "乙已经发生";
  const source = { url: "https://example.org/evidence", title: "证据", snippet: "材料" };
  const initial = [
    { claimAtom: a, verdict: "true", supportingSources: [source] },
    { claimAtom: b, verdict: "true", supportingSources: [source], evidenceGaps: ["时间"] },
  ];
  let checks = 0;
  const runAgent = async (agent: string): Promise<PipelineStep> => ({ agent, output:
    agent === "rumor_detector" ? { claimAtoms: [a, b], claimAtomTypes: [a, b].map(text => ({ text, verifiable: true, type: "fact" })) } :
    agent === "fact_checker" ? { factCheckResult: "true", subclaimVerdicts: ++checks === 1 ? initial : [
      ...(failure === "missing-atom" ? [] : [initial[0]]),
      { claimAtom: b, verdict: "false", contradictingSources: [source], ...(failure === "missing-response" ? {} : { crossExamResponse: "乙未发生" }) },
    ] } : {},
  });
  const result = await runCasePipeline({
    claim: `${a}；${b}`, runAgent,
    searchOne: async () => ({ sources: [source] }),
    citationLiveness: false, evidenceLoop: { enabled: false },
    callSelfProofModel: async () => ({ output: { results: [a, b].map(atom => ({ atom, supported: true })) }, model: "stub" }),
    crossExam: { callRaw: async () => ({ model: "stub", output: { verdict: "false", reason: "时间缺口", challenge: "乙发生时间？" } }) },
    runReport: async () => ({ agent: "report_composer", output: { conclusion: "保留原调查", verdictType: "true" } }),
  });
  expect(result.finalReport.subclaimVerdicts).toEqual(expect.arrayContaining(initial.map(v => expect.objectContaining({ claimAtom: v.claimAtom, verdict: v.verdict }))));
  expect(result.finalReport.crossExam).toMatchObject({ atoms: [expect.objectContaining({ status: "unresolved" })] });
});
