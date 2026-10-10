/**
 * 阶段 1 拆题：拆题 → 收窄 → 自证（含重试与 fail-open）→ 类型闸 → 整句审计规划。
 * 同一案追问且上一轮有可点开证据时不再完整拆题，沿用已核命题（+ 新冒出来的小问题）。
 */
import {
  collapseNarrativeAtoms,
  collapseShortSingleClaim,
  dropUntraceableAtoms,
  keepOriginalWording,
  ensureLeapAtoms,
  ensureStanceAtom,
  forceCheckableAtomTypes,
  markStanceAtoms,
  prefilterClaimAtoms,
  retainAtomTypes,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../../claimAtom/index.js";
import { looksLikePlanOrPrediction } from "../../atomSearchQuery.js";
import { collapseFollowUpAtoms } from "../../followUpReuse.js";
import { applyCheckabilityRevisions, runWholeClaimPlanning } from "../../wholeClaimAudit/index.js";
import type { PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";

function fallbackRumorStep(claim: string, error: unknown): PipelineStep {
  const text = claim.replace(/\s+/g, " ").trim() || claim;
  const type = looksLikePlanOrPrediction(text) ? "prediction" : "fact";
  return {
    agent: "rumor_detector",
    agentName: "RumorDetector",
    output: {
      claimAtoms: [text],
      claimAtomTypes: [{ text, verifiable: true, type }],
      stanceClaimType: {
        verifiable: true,
        type,
        reason: "拆题模型失败，整句按可核查流传说法继续检索",
      },
      rumorIndicators: [],
      severity: "medium",
      analysis: "拆题服务未完成，已把原句当作一条可核查判断继续检索。",
      detectedPatterns: [],
    },
    status: "completed",
    error: error instanceof Error ? error.message : "rumor_detector failed",
    timestamp: Date.now(),
  };
}

/**
 * self-proof 全丢兜底（主路 P0 Change B）：模型偶发把全部候选判为不支持时，
 * 先重试一次；仍全丢则 fail-open 保留全部候选继续管道，不让拆题结果凭空归零。
 * 判定标准与拆题候选都不改，只兜「全丢」这一种结局。
 */
async function runSelfProofWithRetry(
  claim: string,
  rawAtoms: unknown,
  callModel: SelfProofModelCall
): Promise<Awaited<ReturnType<typeof runClaimAtomSelfProof>>> {
  const first = await runClaimAtomSelfProof(claim, rawAtoms, callModel);
  if (first.kept.length > 0) return first;
  // 候选为空 = 本来就没有可保留的命题，不是「全丢」，不重试也不兜底。
  const candidates = prefilterClaimAtoms(claim, rawAtoms).atoms;
  if (candidates.length === 0) return first;
  const retried = await runClaimAtomSelfProof(claim, rawAtoms, callModel);
  if (retried.kept.length > 0) return retried;
  console.warn(
    `[casePipeline] self-proof 两次均未保留任何候选（候选 ${candidates.length} 条），` +
      `fail-open 保留全部候选继续管道；被丢弃的候选：${retried.dropped
        .slice(0, 3)
        .map((item) => item.text)
        .join(" / ")}`
  );
  // kept 已覆盖全部候选，没有任何候选被这一闸门丢掉。
  return { kept: candidates, dropped: [], model: retried.model };
}

export async function decompose(ctx: PipelineContext): Promise<PipelineStep> {
  const { claim, steps, hooks, reusePlan, audit, budget, snapshots, throwIfAborted } = ctx;
  const { runAgent, callSelfProofModel } = ctx.input;

  // Phase 1: RumorDetector — fail-open to the original sentence so search still runs.
  let rumorStep: PipelineStep;
  if (reusePlan) {
    rumorStep = {
      agent: "rumor_detector",
      agentName: "RumorDetector",
      output: {
        claimAtoms: reusePlan.atoms,
        claimAtomTypes: reusePlan.atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
        claimAtomSelfProof: { kept: reusePlan.atoms, dropped: [], model: "followup-reuse:skip" },
        stanceClaimType: {
          verifiable: true,
          type: "fact",
          reason: "同一条核查的追问，沿用上一轮已拆命题",
        },
        rumorIndicators: [],
        severity: "medium",
        analysis: "追问沿用上一轮已拆命题，不再完整拆题。",
        detectedPatterns: [],
      },
      status: "completed",
      timestamp: Date.now(),
    };
    steps.push(rumorStep);
  } else {
    try {
      rumorStep = await runAgent("rumor_detector", steps);
    } catch (error) {
      rumorStep = fallbackRumorStep(claim, error);
    }
    steps.push(rumorStep);

    throwIfAborted();
    // 拆题后再自证：长文先抽断言、追问先收成这句追问，避免自证 9 条课文或把 IARC 拆出来顶替。
    const rawAtoms = Array.isArray(rumorStep?.output?.claimAtoms) ? rumorStep.output.claimAtoms : [];
    const narrowed = ensureLeapAtoms(claim, collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, rawAtoms)));
    if (!rumorStep.output || typeof rumorStep.output !== "object") {
      rumorStep.output = {};
    }
    rumorStep.output.claimAtoms = narrowed;
    rumorStep.output.claimAtomTypes = retainAtomTypes(narrowed, rumorStep.output.claimAtomTypes);
    // 拆题模型已经回来：有命题就立刻上屏，不等自证。没拆出条才停在核对句。
    if (!rumorStep.error && narrowed.length > 0) {
      snapshots.decomposed({ claimAtoms: narrowed });
    } else if (!rumorStep.error) {
      snapshots.receivedChecking();
    }
    const selfProof = rumorStep.error
      ? (() => {
          const pre = prefilterClaimAtoms(claim, rumorStep?.output?.claimAtoms ?? []);
          return { kept: pre.atoms, dropped: pre.dropped, model: "fallback:skip-after-rumor-error" };
        })()
      : await runSelfProofWithRetry(claim, rumorStep?.output?.claimAtoms ?? [], callSelfProofModel);
    const selfProven = ensureLeapAtoms(
      claim,
      collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, selfProof.kept)),
    );
    // 每一部分要对得上原句的一截（编造的丢掉）；短单句不拆。角色标记跟着命题走（在类型表里）。
    const worded = keepOriginalWording(claim, selfProven, rumorStep.output.claimAtomTypes);
    if (worded.restored.length > 0) console.warn(`[decompose] restored original wording for ${JSON.stringify(worded.restored)}`);
    const traced = dropUntraceableAtoms(claim, worded.atoms, worded.types);
    const single = collapseShortSingleClaim(claim, traced.atoms, traced.types);
    const stanced = ensureStanceAtom(claim, single.atoms, single.types, rumorStep.output.stanceClaimType);
    rumorStep.output.claimAtoms = stanced.atoms;
    rumorStep.output.claimAtomTypes = stanced.types;
    rumorStep.output.claimAtomSelfProof = {
      kept: rumorStep.output.claimAtoms,
      dropped: selfProof.dropped,
      model: selfProof.model,
    };
    const keptAtoms = Array.isArray(rumorStep.output.claimAtoms)
      ? (rumorStep.output.claimAtoms as string[])
      : [];
    rumorStep.output.claimAtomTypes = markStanceAtoms(
      retainAtomTypes(keptAtoms, forceCheckableAtomTypes(rumorStep.output.claimAtomTypes))
    );
    hooks?.onSelfProof?.({ ...selfProof, kept: keptAtoms });

    // Whole-Claim Audit Planning（Issue #78）：检索前做可核查性语义修订，记下整句缺口基线。
    if (audit.callModel && budget.canPlanWholeClaim()) {
      const planning = await runWholeClaimPlanning({
        claim,
        keptAtoms: Array.isArray(rumorStep.output.claimAtoms) ? (rumorStep.output.claimAtoms as string[]) : [],
        claimAtomTypes: rumorStep.output.claimAtomTypes,
        stanceClaimType: rumorStep.output.stanceClaimType,
        callModel: audit.callModel,
      });
      if (planning) {
        const revised = applyCheckabilityRevisions(
          rumorStep.output.claimAtomTypes,
          Array.isArray(rumorStep.output.claimAtoms) ? (rumorStep.output.claimAtoms as string[]) : [],
          planning.plan.checkabilityRevisions
        );
        rumorStep.output.claimAtomTypes = revised.claimAtomTypes;
        audit.run.plan = planning.plan;
        audit.run.model = planning.model;
        rumorStep.output.wholeClaimAuditPlan = {
          overallQuestion: planning.plan.overallQuestion,
          checkabilityRevisions: planning.plan.checkabilityRevisions,
          appliedRevisions: revised.applied,
          ignoredRevisions: revised.ignored,
          missingJustifications: planning.plan.missingJustifications,
          model: planning.model,
        };
        audit.unresolvedGaps = [...(planning.plan.missingJustifications ?? [])];
      }
    }
  }

  // 里程碑：拆题完成（self-proof 后保留的原子才是用户主张；dropped 不进 claims）。
  snapshots.decomposed({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
  });
  return rumorStep;
}
