/**
 * 阶段 5 质询（G3/P1）：最多两条命题，各一次独立质询、定向补查、主调查回应。
 * 分歧不重写判词：降可信度、标 contested、SSE 可见。没接入、关闭或时间不够时记下跳过原因。
 */
import { buildAtomSearchBundle } from "../../atomSearch.js";
import { claimAtomKey } from "../../claimAtom/index.js";
import { findCrossExamTargets, makeSecondOpinionCall, runCrossExam } from "../../crossExam/index.js";
import { mergeSourcesIntoBundle } from "../../evidenceLoop/evidenceLoop.js";
import type { CaseState, PipelineContext } from "../caseState.js";

export async function crossExamine(ctx: PipelineContext, state: CaseState): Promise<void> {
  const { input, claim, steps, budget, throwIfAborted } = ctx;
  const { runAgent, searchOne } = input;
  const { atomSearchBundle, search360Result } = state;
  if (
    input.crossExam?.enabled !== false &&
    input.crossExam?.callRaw &&
    budget.canCrossExamine()
  ) {
    const factVerdicts = Array.isArray(state.factStep?.output?.subclaimVerdicts)
      ? (state.factStep.output.subclaimVerdicts as Array<Record<string, unknown>>)
      : [];
    const crossTargets = findCrossExamTargets({
      verdicts: factVerdicts,
      bundle: atomSearchBundle,
      claimAtomKeyFn: claimAtomKey,
    });
    throwIfAborted();
    const crossExam = await runCrossExam({
      claim,
      targets: crossTargets,
      callSecondOpinion: makeSecondOpinionCall(input.crossExam.callRaw),
      signal: input.signal,
      deadline: input.deadline,
      shouldStop: () => budget.mustYieldToComposer(),
      search: async (target, query) => {
        const result = await searchOne(query);
        if ((result as { _source?: string } | null)?._source === "tool-error") throw new Error("定向补查失败");
        const found = buildAtomSearchBundle([{ atom: target.atom, result }], claimAtomKey);
        const incoming = found.byAtomKey[target.atomKey] ?? [];
        mergeSourcesIntoBundle(atomSearchBundle, target.atomKey, incoming, claimAtomKey);
        return incoming.filter(s => (atomSearchBundle.byAtomKey[target.atomKey] ?? []).some(known => known.url === s.url));
      },
      respond: async (target, challenge) => {
        steps.push({ agent: "cross_examiner", output: { kind: "cross_exam", atoms: [challenge] }, timestamp: Date.now() });
        const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
        if (rechecked.error || rechecked.status === "failed") throw new Error("回应未完成");
        const verdicts = Array.isArray(rechecked.output?.subclaimVerdicts) ? rechecked.output.subclaimVerdicts as Array<{ claimAtom: string; [key: string]: unknown }> : [];
        // 不让一次不完整的回应替换整份调查，也不接受没有回应说明的暗中改判。
        const previousVerdicts = Array.isArray(state.factStep?.output?.subclaimVerdicts)
          ? state.factStep.output.subclaimVerdicts as Array<{ claimAtom: string }> : [];
        const expectedKeys = new Set(previousVerdicts.map(v => claimAtomKey(v.claimAtom)));
        const returnedKeys = new Set(verdicts.filter(v => v && typeof v.claimAtom === "string").map(v => claimAtomKey(v.claimAtom)));
        const reply = verdicts.find(v => v && typeof v.claimAtom === "string" && claimAtomKey(v.claimAtom) === target.atomKey);
        if (returnedKeys.size !== verdicts.length || returnedKeys.size !== expectedKeys.size ||
            [...expectedKeys].some(key => !returnedKeys.has(key)) ||
            typeof reply?.crossExamResponse !== "string" || !reply.crossExamResponse.trim()) {
          throw new Error("主调查回应不完整，保留先前调查");
        }
        steps.push(rechecked);
        state.factStep = rechecked;
        // Cross-exam can add a new source immediately before this reply.
        // Audit it before returning finalVerdict to the cross-exam record;
        // later correction is too late for an already-published relation.
        await state.sourceAudit.refreshIfNeeded();
        const verdict = (rechecked.output.subclaimVerdicts as typeof verdicts).find(v => claimAtomKey(v.claimAtom) === target.atomKey);
        return {
          response: typeof verdict?.crossExamResponse === "string" ? verdict.crossExamResponse : "",
          finalVerdict: typeof verdict?.verdict === "string" ? verdict.verdict : undefined,
          sources: [...(Array.isArray(verdict?.supportingSources) ? verdict.supportingSources : []), ...(Array.isArray(verdict?.contradictingSources) ? verdict.contradictingSources : [])],
        };
      },
    });
    state.crossExam = crossExam;
    steps.push({
      agent: "cross_examiner",
      agentName: "CrossExaminer",
      output: {
        kind: "cross_exam",
        atoms: crossExam.atoms,
        confidenceAdjustment: crossExam.confidenceAdjustment,
        model: crossExam.model,
      },
      model: crossExam.model,
      status: "completed",
      timestamp: Date.now(),
    });
  } else {
    state.crossExam = { ran: false, atoms: [], confidenceAdjustment: 0, model: "", skippedReason: input.crossExam?.enabled === false ? "质询已关闭" : !input.crossExam?.callRaw ? "未接入独立复核" : "质询时间预算不足" };
  }
}
