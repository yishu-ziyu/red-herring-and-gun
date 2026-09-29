/**
 * 来源关系审计的刷新（Issue #90）：新来源先审再带方向；没时间或审计失败时新来源只作背景。
 */
import { describe, expect, it, vi } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import { createBudget } from "./budget.js";
import type { CaseState, PipelineContext } from "./caseState.js";
import type { CasePipelineInput, PipelineStep } from "./runCasePipeline.js";
import { createSourceAudit } from "./sourceAudit.js";
import { confirmedSourceValidatorStep } from "./testSourceRelationAudit.js";

const ATOM = "胰岛素可以降低血糖";
const OLD = { url: "https://t.test/old", title: "旧来源", snippet: "胰岛素降低血糖" };
const NEW = { url: "https://t.test/new", title: "新来源（检索原标题）", snippet: "胰岛素用于糖尿病治疗" };

function factStep(sources: Array<{ url: string; title: string; snippet: string }>): PipelineStep {
  return {
    agent: "fact_checker",
    output: {
      subclaimVerdicts: [{ claimAtom: ATOM, verdict: "true", evidence: "胰岛素降低血糖[1]。", supportingSources: sources, contradictingSources: [] }],
    },
  };
}

function setup(options: { runAgent?: CasePipelineInput["runAgent"]; deadline?: number } = {}) {
  const first = factStep([OLD]);
  const steps: PipelineStep[] = [first];
  const firstAudit = confirmedSourceValidatorStep(steps);
  steps.push(firstAudit);
  const runAgent = vi.fn(options.runAgent ?? (async (_agentId: string, current: PipelineStep[]) => confirmedSourceValidatorStep(current)));
  const ctx = { steps, budget: createBudget(options.deadline), input: { runAgent } } as unknown as PipelineContext;
  const state = {
    rumorStep: { agent: "rumor_detector", output: { claimAtoms: [ATOM] } },
    atomSearchBundle: { atomsSearched: [ATOM], byAtomKey: { [claimAtomKey(ATOM)]: [OLD] } },
    search360Result: { sources: [OLD] },
    factStep: first,
    sourceStep: firstAudit,
  } as unknown as CaseState;
  state.sourceAudit = createSourceAudit(ctx, state);
  state.sourceAudit.apply();
  // 补查拿到新来源，重判引用了它（模型还改写了它的标题）。
  const recheck = () => {
    state.atomSearchBundle.byAtomKey[claimAtomKey(ATOM)]!.push(NEW);
    state.factStep = factStep([OLD, { ...NEW, title: "模型改写的标题" }]);
    steps.push(state.factStep);
  };
  return { ctx, state, steps, runAgent, recheck };
}

const supportOf = (state: CaseState) =>
  ((state.factStep.output.subclaimVerdicts as Array<{ supportingSources: Array<{ url: string; title: string }> }>)[0]!.supportingSources);

describe("sourceAudit", () => {
  it("检索包没变、审计也覆盖了全部方向性来源：不再审", async () => {
    const { state, runAgent } = setup();
    await state.sourceAudit.refreshIfNeeded();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("新来源进来：再审一次，按新审计重算判词；来源标题回到检索原文", async () => {
    const { state, steps, runAgent, recheck } = setup();
    recheck();
    await state.sourceAudit.refreshIfNeeded();
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]![0]).toBe("source_validator");
    expect(state.sourceStep).toBe(steps.at(-1));
    expect(supportOf(state).map((s) => [s.url, s.title])).toEqual([
      [OLD.url, OLD.title],
      [NEW.url, NEW.title],
    ]);
  });

  it("来不及再审：不调用审计，新来源不带方向", async () => {
    const { state, runAgent, recheck } = setup({ deadline: Date.now() + 10_000 });
    recheck();
    await state.sourceAudit.refreshIfNeeded();
    expect(runAgent).not.toHaveBeenCalled();
    expect(supportOf(state).map((s) => s.url)).toEqual([OLD.url]);
  });

  it("审计失败：保留上一次审计，新来源不带方向", async () => {
    const { state, runAgent, recheck } = setup({
      runAgent: async () => {
        throw new Error("validator down");
      },
    });
    const before = state.sourceStep;
    recheck();
    await state.sourceAudit.refreshIfNeeded();
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(state.sourceStep).toBe(before);
    expect(supportOf(state).map((s) => s.url)).toEqual([OLD.url]);
  });

  it("调用方自己刚审过（markAudited）：检索包没再变就不重复审", async () => {
    const { state, runAgent, recheck } = setup();
    recheck();
    state.sourceStep = confirmedSourceValidatorStep([state.factStep]);
    state.sourceAudit.markAudited();
    state.sourceAudit.apply();
    await state.sourceAudit.refreshIfNeeded();
    expect(runAgent).not.toHaveBeenCalled();
  });
});
