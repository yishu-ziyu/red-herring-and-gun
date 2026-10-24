/**
 * 来源关系审计：FactChecker 准备上屏的支持 / 反驳来源，必须先经 SourceValidator 对 claimAtom + URL 独立审核。
 *
 * 首次审计没覆盖全部方向性来源时，再审一次；刷新不了（没时间或审计失败）时，
 * 没审过的来源一律只作背景（fail-closed），不会闪一下绿色「支持」再被纠正。
 */
import { bindAtomEvidenceToVerdicts } from "../atomSearch.js";
import { applyClaimSourceRelationAudit, relationAuditCoversDirectionalSources } from "../sourceRelationAudit.js";
import type { CaseState, PipelineContext } from "./caseState.js";

type Verdict = { claimAtom: string; [key: string]: unknown };

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
  // 审计前的方向性候选。公开判词可能在 fail-closed 时被临时去掉方向，
  // 之后审计成功还要能从原始候选恢复，所以审计永远从这里算起，不从公开判词算起。
  let candidates: Verdict[] | undefined;

  const apply = () => {
    const fromModel = state.factStep.output?.subclaimVerdicts;
    const raw = candidates ?? (Array.isArray(fromModel) ? (fromModel as Verdict[]) : []);
    const bound = bindAtomEvidenceToVerdicts(raw, state.atomSearchBundle.byAtomKey);
    candidates ??= bound;
    state.subclaimVerdicts = applyClaimSourceRelationAudit(bound, state.sourceStep.output?.claimSourceRelations);
  };

  const refreshIfNeeded = async () => {
    const nextSignature = bundleSignature();
    const covered = relationAuditCoversDirectionalSources(
      state.subclaimVerdicts,
      state.sourceStep.output?.claimSourceRelations,
    );
    if (nextSignature === auditedSignature && covered) return;
    // If there is no room for another source audit, keep new/unknown material non-directional.
    // apply() below is fail-closed for uncovered URLs.
    if (budget.tooLateForSourceAuditRefresh()) {
      apply();
      return;
    }
    try {
      // 审计要看的是审计前的候选，不是已经按旧审计降级过的公开判词。
      const factStep = { ...state.factStep, relationAuditCandidates: candidates };
      const inputSteps = steps.map((step) => (step === state.factStep ? factStep : step));
      const refreshed = await runAgent("source_validator", inputSteps, state.search360Result, state.atomSearchBundle);
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
