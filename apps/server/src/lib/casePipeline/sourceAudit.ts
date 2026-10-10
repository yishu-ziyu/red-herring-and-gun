/**
 * 来源关系审计（Issue #90）：FactChecker 准备上屏的支持 / 反驳来源，必须先经 SourceValidator 对 claimAtom + URL 独立审核。
 *
 * 首次审计没覆盖全部方向性来源时，再审一次；刷新不了（没时间或审计失败）时，
 * 没审过的来源一律只作背景（fail-closed），不会闪一下绿色「支持」再被纠正。
 */
import { bindAtomEvidenceToVerdicts } from "../atomSearch.js";
import { claimAtomKey } from "../claimAtom/index.js";
import { applyClaimSourceRelationAudit, relationAuditCoversDirectionalSources } from "../sourceRelationAudit.js";
import type { CaseState, PipelineContext } from "./caseState.js";

export type SourceAudit = {
  /** 按当前生效的审计重算公开判词（从未降级的原始候选算起）。 */
  apply: () => void;
  /** 检索包变了或审计没覆盖全部方向性来源时，再审一次。 */
  refreshIfNeeded: () => Promise<void>;
};

export function createSourceAudit(ctx: PipelineContext, state: Omit<CaseState, "sourceAudit">): SourceAudit {
  const { steps, budget } = ctx;
  const { runAgent } = ctx.input;
  const bundleSignature = () =>
    Object.values(state.atomSearchBundle.byAtomKey)
      .flatMap((items) => items.map((item) => `${item.url}\u0000${item.snippet ?? ""}`))
      .sort()
      .join("\u0001");
  let auditedSignature = bundleSignature();

  const apply = () => {
    const factStep = state.factStep;
    // Never audit an already-demoted public result: fail-closed publication can
    // temporarily strip direction, but a later successful audit must still be
    // able to recover the original FactChecker candidates. Keep those candidates
    // internal and recompute the public verdict from them on every audit refresh.
    const raw = Array.isArray(factStep?.relationAuditCandidates)
      ? (factStep.relationAuditCandidates as Array<{ claimAtom: string; [key: string]: unknown }>)
      : Array.isArray(factStep?.output?.subclaimVerdicts)
        ? (factStep.output.subclaimVerdicts as Array<{ claimAtom: string; [key: string]: unknown }>)
      : [];
    const bound = bindAtomEvidenceToVerdicts(raw, state.atomSearchBundle.byAtomKey, claimAtomKey);
    if (!factStep.relationAuditCandidates) {
      factStep.relationAuditCandidates = bound as Array<Record<string, unknown>>;
    }
    factStep.output.subclaimVerdicts = applyClaimSourceRelationAudit(
      bound,
      state.sourceStep?.output?.claimSourceRelations,
      claimAtomKey,
    );
  };

  const refreshIfNeeded = async () => {
    const nextSignature = bundleSignature();
    const verdicts = state.factStep?.output?.subclaimVerdicts;
    const covered = relationAuditCoversDirectionalSources(
      verdicts,
      state.sourceStep?.output?.claimSourceRelations,
      claimAtomKey,
    );
    if (nextSignature === auditedSignature && covered) return;
    // If there is no room for another source audit, keep new/unknown material non-directional.
    // apply() below is fail-closed for uncovered URLs.
    if (budget.tooLateForSourceAuditRefresh()) {
      apply();
      return;
    }
    try {
      const refreshed = await runAgent("source_validator", steps, state.search360Result, state.atomSearchBundle);
      steps.push(refreshed);
      state.sourceStep = refreshed;
      auditedSignature = nextSignature;
    } catch {
      // Keep the last successful audit. Unknown new URLs stay context-only.
    }
    apply();
  };

  return { apply, refreshIfNeeded };
}
