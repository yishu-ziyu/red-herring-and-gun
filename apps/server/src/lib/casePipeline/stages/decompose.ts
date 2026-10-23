/**
 * 阶段 1 拆题：拆题 → 收窄 → 去重 → 对回原句 → 类型闸。不再另跑模型校验拆出的命题。
 */
import { collapseNarrativeAtoms, ensureLeapAtoms, retainAtomTypes } from "../../claimAtom/textbookAtoms.js";
import { collapseShortSingleClaim, dropUntraceableAtoms, keepOriginalWording, ensureStanceAtom, markStanceAtoms } from "../../claimAtom/roles.js";
import { forceCheckableAtomTypes } from "../../claimAtom/forceCheckable.js";
import { prefilterClaimAtoms } from "../../claimAtom/prefilter.js";
import { looksLikePlanOrPrediction } from "../../atomSearchQuery.js";
import { collapseFollowUpAtoms } from "../../followUpReuse.js";
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

export async function decompose(ctx: PipelineContext): Promise<PipelineStep> {
  const { claim, steps, snapshots, throwIfAborted } = ctx;
  const { runAgent } = ctx.input;

  // Phase 1: RumorDetector — fail-open to the original sentence so search still runs.
  let rumorStep: PipelineStep;
  try {
    rumorStep = await runAgent("rumor_detector", steps);
  } catch (error) {
    rumorStep = fallbackRumorStep(claim, error);
  }
  steps.push(rumorStep);

  throwIfAborted();
  // 长文先抽断言、追问先收成这句追问，避免核 9 条课文或把 IARC 拆出来顶替。
  const rawAtoms = Array.isArray(rumorStep?.output?.claimAtoms) ? rumorStep.output.claimAtoms : [];
  const narrowed = ensureLeapAtoms(claim, collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, rawAtoms)));
  if (!rumorStep.output || typeof rumorStep.output !== "object") {
    rumorStep.output = {};
  }
  rumorStep.output.claimAtoms = narrowed;
  rumorStep.output.claimAtomTypes = retainAtomTypes(narrowed, rumorStep.output.claimAtomTypes);
  // 只发布原文对齐与合并之后的问题，避免把随后被删除的模型草稿显示给用户。
  const pre = prefilterClaimAtoms(claim, rumorStep?.output?.claimAtoms ?? []);
  const deduped = ensureLeapAtoms(
    claim,
    collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, pre.atoms)),
  );
  // 每一部分要对得上原句的一截（编造的丢掉）；短单句不拆。角色标记跟着命题走（在类型表里）。
  const worded = keepOriginalWording(claim, deduped, rumorStep.output.claimAtomTypes);
  if (worded.restored.length > 0) console.warn(`[decompose] restored original wording for ${JSON.stringify(worded.restored)}`);
  const traced = dropUntraceableAtoms(claim, worded.atoms, worded.types);
  const single = collapseShortSingleClaim(claim, traced.atoms, traced.types);
  const stanced = ensureStanceAtom(claim, single.atoms, single.types, rumorStep.output.stanceClaimType);
  rumorStep.output.claimAtoms = stanced.atoms;
  rumorStep.output.claimAtomTypes = stanced.types;
  const keptAtoms = Array.isArray(rumorStep.output.claimAtoms)
    ? (rumorStep.output.claimAtoms as string[])
    : [];
  rumorStep.output.claimAtomTypes = markStanceAtoms(
    retainAtomTypes(keptAtoms, forceCheckableAtomTypes(rumorStep.output.claimAtomTypes))
  );

  // 里程碑：拆题完成（对回原句后保留的命题才是用户主张）。
  snapshots.decomposed({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
  });
  return rumorStep;
}
