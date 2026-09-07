/**
 * Whole-Claim Audit（Issue #78 第一版）——整句在拆题后继续作为被审计对象。
 * Planning（检索前）→ Evaluation（初轮核查后）→ ≤1 次 audit-driven 补查 → 收权门。
 * artifact 只进实现层；不进 UI、不进 Evidence、不改 InvestigationSnapshot schema。
 */
export type {
  WholeClaimAuditModelCall,
  WholeClaimAuditPlan,
  WholeClaimAuditEvaluation,
  WholeClaimAuditQuestion,
  WholeClaimAuditExtraPass,
  WholeClaimAuditRun,
} from "./types.js";
export {
  WHOLE_CLAIM_PLANNING_SYSTEM_PROMPT,
  wholeClaimPlanningSchema,
  buildPlanningUserContent,
  parseWholeClaimPlan,
  applyCheckabilityRevisions,
  runWholeClaimPlanning,
  type AppliedCheckabilityRevisions,
} from "./planning.js";
export {
  WHOLE_CLAIM_EVALUATION_SYSTEM_PROMPT,
  wholeClaimEvaluationSchema,
  buildEvaluationUserContent,
  compactVerdicts,
  parseWholeClaimEvaluation,
  runWholeClaimEvaluation,
  resolveQuestionAtomKey,
} from "./evaluation.js";
export {
  applyConclusionGate,
  needsConstrainedConclusion,
  repairGatedConclusion,
  type ConclusionGateInput,
  type ConclusionGateResult,
  type ConstrainedConclusionDecision,
  type ConstrainedConclusionInput,
  type GatedConclusionRepairInput,
} from "./conclusionGate.js";
