/**
 * 阶段 4 证据补查（ADR-004 + 翻案续期）：提问 → 重判 → 判词仍翻转中且问题仍产证据 → 换策略再问（pass 2+）→ 再重判。
 * 好问题续命（翻转判词的提问 earns another pass），坏问题判停（整 pass 零新增）。
 * 判停全确定性：无新证据 / 全部收敛 / pass 上限。同一案追问沿用上一轮的命题不再补查。
 */
import { claimAtomKey } from "../../claimAtom/index.js";
import {
  findLoopTargets,
  runEvidenceLoop,
  MAX_EVIDENCE_LOOP_PASSES,
  MAX_EVIDENCE_LOOP_ROUNDS,
  type EvidenceLoopAtomOutcome,
} from "../../evidenceLoop/index.js";
import type { PursuitHop } from "../../evidencePursuit/index.js";
import { reusedAtomKeysOf } from "../../followUpReuse.js";
import type { CaseState, PipelineContext } from "../caseState.js";

export async function pursueEvidence(ctx: PipelineContext, state: CaseState): Promise<void> {
  const { input, claim, steps, hooks, reusePlan, budget, snapshots } = ctx;
  const { runAgent, searchOne } = input;
  const { rumorStep, atomSearchBundle, search360Result } = state;
  const loopAtoms = reusePlan
    ? atomSearchBundle.atomsSearched.filter((atom) => !reusedAtomKeysOf(reusePlan).has(claimAtomKey(atom)))
    : atomSearchBundle.atomsSearched;
  if (input.evidenceLoop?.enabled === false || loopAtoms.length === 0) return;

  const roundsPerPass = Math.max(
    1,
    input.evidenceLoop?.maxRounds ?? MAX_EVIDENCE_LOOP_ROUNDS
  );
  const maxPasses = Math.max(
    1,
    input.evidenceLoop?.maxPasses ?? MAX_EVIDENCE_LOOP_PASSES
  );
  const atomOutcomes = new Map<string, EvidenceLoopAtomOutcome>();
  const currentVerdicts = () =>
    Array.isArray(state.factStep?.output?.subclaimVerdicts)
      ? (state.factStep!.output.subclaimVerdicts as Array<Record<string, unknown>>)
      : [];
  let totalNewSources = 0;
  let recheckFactChecker = false;
  let passes = 0;
  const pursuitHops: PursuitHop[] = [];
  const suggestedQueriesByAtomKey = Object.fromEntries(
    (state.crossExam?.atoms ?? [])
      .filter((atom) => typeof atom.query === "string" && atom.query.trim())
      .map((atom) => [claimAtomKey(atom.atom), atom.query!.trim()])
  );

  while (passes < maxPasses) {
    if (budget.tooLateForEvidencePass()) break;
    passes += 1;
    const seedQueriesByAtomKey: Record<string, string[]> = {};
    for (const [key, outcome] of atomOutcomes) {
      seedQueriesByAtomKey[key] = outcome.rounds.map((r) => r.query);
    }
    const passOutcome = await runEvidenceLoop({
      claim,
      bundle: { ...atomSearchBundle, atomsSearched: loopAtoms },
      factVerdicts: currentVerdicts(),
      searchOne,
      claimAtomKeyFn: claimAtomKey,
      callRewriteModel: input.evidenceLoop?.callRewriteModel,
      maxRounds: roundsPerPass,
      startRound: (passes - 1) * roundsPerPass + 1,
      seedQueriesByAtomKey,
      suggestedQueriesByAtomKey,
      needImageOrigin: Boolean(input.lookupImageOrigin),
      shouldStopEarly: () => budget.mustYieldToComposer(),
      hooks: {
        onLoopStart: hooks?.onEvidenceLoopStart,
        onRoundStart: hooks?.onEvidenceLoopRoundStart,
        onRoundResult: hooks?.onEvidenceLoopRoundResult,
        onAtomStopped: hooks?.onEvidenceLoopStopped,
      },
    });
    for (const a of passOutcome.atoms) {
      const prev = atomOutcomes.get(a.atomKey);
      if (prev) {
        prev.rounds.push(...a.rounds);
        prev.stopReason = a.stopReason;
        prev.trigger = a.trigger;
      } else {
        atomOutcomes.set(a.atomKey, { ...a, rounds: [...a.rounds] });
      }
    }
    totalNewSources += passOutcome.totalNewSources;
    if (passOutcome.pursuitHops?.length) pursuitHops.push(...passOutcome.pursuitHops);
    // 坏问题停：整 pass 零新增（边际增益判停）
    if (!passOutcome.recheckFactChecker) break;
    if (budget.mustYieldToComposer()) break;
    recheckFactChecker = true;
    // 有新证据 → 重判（判词可能翻转）
    try {
      const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
      const previous = currentVerdicts();
      const next = Array.isArray(rechecked.output?.subclaimVerdicts)
        ? rechecked.output.subclaimVerdicts as Array<{ claimAtom?: unknown }>
        : [];
      const expected = new Set(previous.map((row) => claimAtomKey(String(row.claimAtom ?? ""))));
      const received = new Set(next.map((row) => claimAtomKey(String(row.claimAtom ?? ""))));
      if (rechecked.error || rechecked.status === "failed" || next.length !== expected.size ||
          received.size !== expected.size || [...expected].some((key) => !received.has(key))) {
        break;
      }
      steps.push(rechecked);
      state.factStep = rechecked;
      // The evidence loop just added URLs. Before deciding whether the atom
      // has converged, refresh the independent relation audit; otherwise a
      // correct recheck would be temporarily demoted and spuriously trigger
      // another pursuit pass.
      await state.sourceAudit.refreshIfNeeded();
    } catch {
      // 重判失败保留原 factStep；补查证据已入 bundle，报告/溯源仍可见。不再续期。
      break;
    }
    // 问完了：重判后无 unverified / 冲突原子 → 停
    const remaining = findLoopTargets({
      atomsSearched: loopAtoms,
      verdicts: currentVerdicts(),
      claimAtomKeyFn: claimAtomKey,
    });
    if (remaining.length === 0) break;
    // 仍有未解决原子且上一 pass 问题还在产证据 → 翻案续期（下一 pass 换策略）
  }

  // 里程碑：证据补查收束（判词可能翻转；缺口与追索目标入快照）。
  snapshots.judging({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
    subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
    sourceRelationAudits: state.sourceStep?.output?.claimSourceRelations,
    pursuitHops,
  });
  if (atomOutcomes.size > 0) {
    state.evidenceLoop = {
      ran: true,
      atoms: [...atomOutcomes.values()],
      totalNewSources,
      recheckFactChecker,
      passes,
      pursuitHops,
    };
  }
}
