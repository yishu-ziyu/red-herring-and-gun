import { expect, it, vi } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline.js";
import { confirmedSourceValidatorStep } from "./testSourceRelationAudit.js";

const atom = "某地发布了新规定";
const a = { url: "https://example.org/a", title: "公告", snippet: "公告原文" };
const b = { url: "https://example.org/b", title: "回应", snippet: "回应原文" };
const c = { url: "https://gov.cn/c", title: "新证据", snippet: "新取得的原文" };

function base(runAgent: (id: string, steps: PipelineStep[]) => Promise<PipelineStep>, searchOne: (query: string) => Promise<unknown>) {
  return {
    claim: atom,
    runAgent,
    searchOne,
    citationLiveness: false as const,
    callSelfProofModel: async () => ({ output: { results: [{ atom, supported: true }] }, model: "self" }),
    runReport: async ({ judgment }: { judgment: Record<string, unknown> }) => ({
      agent: "report_composer", output: { explanation: "这段解释由报告模型写出。", verdictType: "false" },
    }),
  };
}

it("没有冲突或缺口只判一次，报告读正式结果并保留模型解释", async () => {
  let factCalls = 0;
  const secondOpinion = vi.fn(async () => ({ model: "second", output: { verdict: "false", reason: "反对" } }));
  const searchOne = vi.fn(async () => ({ sources: [a] }));
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }] } };
    if (id === "fact_checker") { factCalls++; return { agent: id, output: { factCheckResult: "true", subclaimVerdicts: [{ claimAtom: atom, verdict: "true", supportingSources: [a] }] } }; }
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, searchOne), crossExam: { callRaw: secondOpinion } });
  expect(factCalls).toBe(1);
  expect(searchOne).toHaveBeenCalledTimes(1);
  expect(secondOpinion).not.toHaveBeenCalled();
  expect(result.finalReport.verdictType).toBe("true");
  expect(result.finalReport.conclusion).toContain("这段解释由报告模型写出");
});

it("儿童适用范围有明确缺口时经唯一补查入口找新原文，再重判一次", async () => {
  const claim = "该研究证明儿童也有效";
  const adult = { url: "https://study.test/adult", title: "成人研究", snippet: "研究只纳入成人" };
  const child = { url: "https://gov.cn/child-limits", title: "儿童范围", snippet: "原文未纳入儿童" };
  let factCalls = 0;
  const searchOne = vi.fn(async (query: string) => ({ sources: query === claim ? [adult] : [child] }));
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [claim], claimAtomTypes: [{ text: claim, verifiable: true, type: "fact" }] } };
    if (id === "fact_checker") {
      factCalls++;
      return { agent: id, output: { factCheckResult: factCalls === 1 ? "true" : "false", subclaimVerdicts: [{
        claimAtom: claim, verdict: factCalls === 1 ? "true" : "false",
        evidenceGaps: factCalls === 1 ? ["年龄范围"] : [],
        supportingSources: factCalls === 1 ? [adult] : [],
        contradictingSources: factCalls === 1 ? [] : [child],
      }] } };
    }
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, searchOne), claim,
    callSelfProofModel: async () => ({ output: { results: [{ atom: claim, supported: true }] }, model: "self" }),
    evidenceLoop: { maxRounds: 1, maxPasses: 1 },
  });
  expect(searchOne.mock.calls.some(([query]) => query.includes("年龄范围"))).toBe(true);
  expect(factCalls).toBe(2);
  expect(result.finalReport.verdictType).toBe("false");
});

it("真实双向冲突才质询；质询问题通过唯一补查入口，第二意见不改判", async () => {
  const events: string[] = [];
  let factCalls = 0;
  const query = "新规定 正文 冲突";
  const searchOne = vi.fn(async (q: string) => {
    events.push(`search:${q}`);
    return { sources: q === atom ? [a, b] : [c] };
  });
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    events.push(`agent:${id}`);
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }] } };
    if (id === "fact_checker") { factCalls++; return { agent: id, output: { factCheckResult: "partial", subclaimVerdicts: [{ claimAtom: atom, verdict: "disputed", supportingSources: [a], contradictingSources: [b] }] } }; }
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, searchOne), crossExam: { callRaw: async () => {
    events.push("secondOpinion");
    return { model: "second", output: { verdict: "false", reason: "两边相反", challenge: "应以哪份为准？", query } };
  } }, evidenceLoop: { maxRounds: 1, maxPasses: 1 } });
  expect(result.crossExam?.ran).toBe(true);
  expect(events.indexOf("secondOpinion")).toBeGreaterThan(events.indexOf("agent:source_validator"));
  expect(searchOne).toHaveBeenCalledWith(query);
  expect(factCalls).toBeLessThanOrEqual(2);
  expect(result.finalReport.verdictType).toBe("disputed");
  expect(result.finalReport.crossExam).toMatchObject({ adjustment: 0 });
});

it("补查得到新来源但重判缺一条命题，不覆盖完整初判", async () => {
  const second = "政策有例外";
  let factCalls = 0;
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [atom, second], claimAtomTypes: [atom, second].map((text) => ({ text, verifiable: true, type: "fact" })) } };
    if (id === "fact_checker") {
      factCalls++;
      return { agent: id, output: { factCheckResult: "unverified", subclaimVerdicts: factCalls === 1
        ? [{ claimAtom: atom, verdict: "unverified" }, { claimAtom: second, verdict: "true", supportingSources: [a] }]
        : [{ claimAtom: atom, verdict: "false", contradictingSources: [c] }] } };
    }
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, async (query) => ({ sources: query === atom || query === second ? [a] : [c] })),
    claim: `${atom}；${second}`,
    callSelfProofModel: async () => ({ output: { results: [atom, second].map((text) => ({ atom: text, supported: true })) }, model: "self" }),
    evidenceLoop: { maxRounds: 1, maxPasses: 1 } });
  expect(factCalls).toBe(2);
  expect(result.factStep.output.subclaimVerdicts).toEqual(expect.arrayContaining([
    expect.objectContaining({ claimAtom: atom, verdict: "unverified" }),
    expect.objectContaining({ claimAtom: second, verdict: "true" }),
  ]));
});

it("知识库已存正文的 URL 即使探活判死也保留正式判断", async () => {
  const searchOne = vi.fn(async () => ({ sources: [] }));
  const saved = { ...a, originalText: "公告原文明确说明某地发布了新规定。" };
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }] } };
    if (id === "fact_checker") return { agent: id, output: { factCheckResult: "true", subclaimVerdicts: [{ claimAtom: atom, verdict: "true", supportingSources: [saved] }] } };
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, searchOne),
    citationLiveness: { liveness: new Map([[a.url, "dead"]]) },
    knowledgeBase: {
      lookup: () => ({ originDate: new Date().toISOString().slice(0, 10), priorVerdict: "true", evidence: [saved] }),
      markInjected: () => {}, conclude: () => {}, settle: () => {},
    },
  });
  expect(searchOne).not.toHaveBeenCalled();
  expect(Object.values(result.atomSearchBundle.byAtomKey).flat()[0]?.provenance).toBe("knowledge");
  expect(result.finalReport.verdictType).toBe("true");
});

it("唯一引用失效时总答和分条都退回暂时无法判断", async () => {
  const runAgent = async (id: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }] } };
    if (id === "fact_checker") return { agent: id, output: { factCheckResult: "true", subclaimVerdicts: [{ claimAtom: atom, verdict: "true", supportingSources: [a] }] } };
    if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
    throw new Error(`unexpected ${id}`);
  };
  const result = await runCasePipeline({ ...base(runAgent, async () => ({ sources: [a] })),
    citationLiveness: { liveness: new Map([[a.url, "dead"]]) },
    hooks: { onInvestigationSnapshot: () => {} },
  });
  expect(result.finalReport.verdictType).toBe("unverified");
  expect((result.finalReport.subclaimVerdicts as Array<{ verdict: string }>)[0]?.verdict).toBe("unverified");
  expect((result.finalReport.investigation as { claims: Array<{ judgment: string }> }).claims[0]?.judgment).toBe("unresolved");
});

it("苏打水真实反例：只有反驳原文不能保留部分成立，总答与分条一致", async () => {
  const first = "气泡水可以中和胃酸";
  const second = "胃不舒服喝苏打水就够了";
  const source = { url: "https://m.3zhijk.com/kpar/mip/mip_article/7125157494457946112.html", title: "胃不舒服喝苏打水可以缓解吗", snippet: "苏打水并不能代替药物治疗，因此不建议长期大量饮用苏打水来治疗疾病。" };
  const result = await runCasePipeline({
    claim: `${first}，${second}`,
    runAgent: async (id, steps) => {
      if (id === "rumor_detector") return { agent: id, output: { claimAtoms: [first, second], claimAtomTypes: [first, second].map(text => ({ text, verifiable: true, type: "fact", role: text === second ? "main" : "premise" })) } };
      if (id === "fact_checker") return { agent: id, output: { subclaimVerdicts: [
        { claimAtom: first, verdict: "unverified", evidenceGaps: ["缺少对应原文"] },
        { claimAtom: second, verdict: "partial", contradictedElement: "就够了", supportingSources: [], contradictingSources: [source], evidence: "多位医生确认了这一点。然而不能替代药物。" },
      ] } };
      if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
      throw new Error(id);
    },
    searchOne: async (query) => ({ sources: query.includes("苏打水") ? [source] : [] }),
    callSelfProofModel: async () => ({ model: "self", output: { results: [first, second].map(atom => ({ atom, supported: true })) } }),
    evidenceLoop: { enabled: false }, citationLiveness: false,
    runReport: async () => ({ agent: "report_composer", output: { explanation: "两项均部分成立。" } }),
    hooks: { onInvestigationSnapshot: () => {} },
  });
  expect(result.finalReport.verdictType, JSON.stringify(result.finalReport.subclaimVerdicts)).toBe("false");
  expect(result.finalReport.subclaimVerdicts).toMatchObject([{ verdict: "unverified" }, { verdict: "false" }]);
  expect(result.finalReport.investigation).toMatchObject({ claims: [{ judgment: "unresolved" }, { judgment: "refuted" }] });
  expect(result.finalReport.conclusion).toContain("尚未查清");
  expect(result.finalReport.conclusion).not.toMatch(/部分成立|多位医生确认/);
});
