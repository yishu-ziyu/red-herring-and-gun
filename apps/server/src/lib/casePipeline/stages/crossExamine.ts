/** Independent opinion records a real source conflict; evidence search stays in pursueEvidence. */
import { claimAtomKey } from "../../claimAtom/index.js";
import { findCrossExamTargets, makeSecondOpinionCall, runCrossExam } from "../../crossExam/index.js";
import type { CaseState, PipelineContext } from "../caseState.js";

export async function crossExamine(ctx: PipelineContext, state: CaseState): Promise<void> {
  const { input, claim, steps, budget, throwIfAborted } = ctx;
  const verdicts = Array.isArray(state.factStep.output.subclaimVerdicts)
    ? state.factStep.output.subclaimVerdicts as Array<Record<string, unknown>>
    : [];
  const targets = findCrossExamTargets({
    verdicts,
    bundle: state.atomSearchBundle,
    claimAtomKeyFn: claimAtomKey,
  }).filter((target) => target.supporting.length > 0 && target.contradicting.length > 0);

  if (input.crossExam?.enabled === false || !input.crossExam?.callRaw || !budget.canCrossExamine() || targets.length === 0) {
    state.crossExam = {
      ran: false,
      atoms: [],
      confidenceAdjustment: 0,
      model: "",
      skippedReason: targets.length === 0 ? "没有已绑定的证据冲突" : "独立意见未接入或时间预算不足",
    };
    return;
  }

  throwIfAborted();
  state.crossExam = await runCrossExam({
    claim,
    targets,
    callSecondOpinion: makeSecondOpinionCall(input.crossExam.callRaw),
    signal: input.signal,
    deadline: input.deadline,
    shouldStop: () => budget.mustYieldToComposer(),
  });
  steps.push({
    agent: "cross_examiner",
    agentName: "CrossExaminer",
    output: { kind: "cross_exam", atoms: state.crossExam.atoms, model: state.crossExam.model },
    model: state.crossExam.model,
    status: "completed",
    timestamp: Date.now(),
  });
}
