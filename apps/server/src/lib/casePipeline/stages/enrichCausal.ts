/**
 * 阶段 6 因果增强：仅当拆出的命题含因果断言时，并行运行替代解释搜索 + 反证评分；失败可继续（不阻断收束）。
 */
import type { CaseState, PipelineContext } from "../caseState.js";

export async function enrichCausal(ctx: PipelineContext, state: CaseState): Promise<void> {
  const { steps, budget } = ctx;
  const { runAgent } = ctx.input;
  const { rumorStep, search360Result, atomSearchBundle } = state;
  const hasCausalAtom = Array.isArray(rumorStep?.output?.claimAtomTypes)
    && rumorStep.output.claimAtomTypes.some((t) => (t as { type?: string })?.type === "causal");
  if (hasCausalAtom && budget.hasComposerHeadroom()) {
    const causalSteps = await Promise.allSettled([
      runAgent("alternative_explanation_searcher", steps, search360Result, atomSearchBundle),
      runAgent("counter_evidence_grader", steps, search360Result, atomSearchBundle),
    ]);
    for (const settled of causalSteps) {
      if (settled.status === "fulfilled") steps.push(settled.value);
    }
  }
}
