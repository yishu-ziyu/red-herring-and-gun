/**
 * 来源关系审计（Issue #90）：FactChecker 准备上屏的支持 / 反驳来源，必须先经 SourceValidator 对 claimAtom + URL 独立审核。
 *
 * 补查、质询、整句审计都可能往检索包里加新来源；每次加完，先刷新审计，再让新来源带方向上屏。
 * 刷新不了（没时间或审计失败）时，新来源一律只作背景（fail-closed），不会闪一下绿色「支持」再被纠正。
 */
import { createHash } from "node:crypto";
import { bindAtomEvidenceToVerdicts, type AtomSearchBundle } from "../atomSearch.js";
import { claimAtomKey } from "../claimAtom/index.js";
import { applyClaimSourceRelationAudit, parseClaimSourceRelationAudits, relationAuditCoversDirectionalSources } from "../sourceRelationAudit.js";
import type { CaseState, PipelineContext } from "./caseState.js";

export type SourceAudit = {
  /** 按当前生效的审计重算公开判词（从未降级的原始候选算起）。 */
  apply: () => void;
  /** 检索包变了或审计没覆盖全部方向性来源时，再审一次。 */
  refreshIfNeeded: () => Promise<void>;
  /** 调用方自己刚审过一次（整句审计补查）：记下此刻的检索包。 */
  markAudited: () => void;
};

/** Validate each model quote against the body for this claim and URL. */
export function groundClaimSourceRelations(rows: unknown, bundle: AtomSearchBundle): unknown {
  return parseClaimSourceRelationAudits(rows).map((row) => {
    if (row.relation !== "support" && row.relation !== "contradict") return row;
    const source = bundle.byAtomKey[claimAtomKey(row.claimAtom)]
      ?.find((item) => item.url === row.url);
    const body = source?.originalText?.replace(/\s+/g, "") ?? "";
    const quote = row.quote?.replace(/\s+/g, "") ?? "";
    const scope = source?.originalScope?.replace(/\s+/g, "");
    if (source && quote.length >= 8 && body.includes(quote) && (!scope || scope.includes(quote))) {
      return { ...row, quoteVerified: true };
    }
    return {
      ...row,
      relation: "unverified",
      quoteVerified: false,
      reason: "没有取得与这条命题对应且可在正文中核对的原句",
    };
  });
}

export function createSourceAudit(ctx: PipelineContext, state: Omit<CaseState, "sourceAudit">): SourceAudit {
  const { steps, budget } = ctx;
  const { runAgent } = ctx.input;
  const bundleSignature = () => createHash("sha256")
    .update(JSON.stringify(Object.values(state.atomSearchBundle.byAtomKey)
      .flatMap((items) => items.map((item) => [item.url, item.snippet, item.originalText, item.originalScope]))
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))))
    .digest("hex");
  let auditedSignature = bundleSignature();

  const apply = () => {
    const factStep = state.factStep;
    if (ctx.input.archiveEvidence && state.sourceStep?.output) {
      state.sourceStep.output.claimSourceRelations = groundClaimSourceRelations(
        state.sourceStep.output.claimSourceRelations, state.atomSearchBundle);
    }
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

  return {
    apply,
    refreshIfNeeded,
    markAudited: () => {
      auditedSignature = bundleSignature();
    },
  };
}
