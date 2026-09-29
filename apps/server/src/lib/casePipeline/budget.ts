/**
 * 一次调查的时间预算：证据补查、交叉复核、因果增强、整句审计是「锦上添花」，报告写作是「必须发生」。
 * 剩余时间不足时提前收敛补查类阶段，把时间让给报告写作。所有「剩余时间够不够」的判断都在这里。
 *
 * 每个判断保留原来的比较方向（> / >= / < / <=），截止时间不是有限数时的结果也因此不变。
 */
import { MINIMAX_M27_DEFAULT_TIMEOUT_MS } from "../minimaxM3.js";

/** 给报告写作留的时间。 */
export const COMPOSER_RESERVE_MS = 90_000;
/** 质询的最低启动余量。 */
export const CROSS_EXAM_MIN_MS = 45_000;
/** 证据补查每一 pass 的最低启动余量。 */
export const EVIDENCE_PASS_MIN_MS = 100_000;
/** Whole-Claim Audit（Issue #78）：Planning 的最低启动余量。 */
export const AUDIT_MIN_MS = 45_000;
/** 来源审计刷新的最低余量；不够时新来源一律只作背景（fail-closed）。 */
export const SOURCE_AUDIT_REFRESH_MIN_MS = 20_000;
/** 写一次完整报告需要的时间（窗口约 90s，MiniMax 单次默认 180s）。 */
export const REPORT_WRITE_MS = Math.max(COMPOSER_RESERVE_MS, MINIMAX_M27_DEFAULT_TIMEOUT_MS);

export type Budget = {
  /** 距管线截止还剩多少毫秒；没有截止时间时为无穷大。 */
  timeLeftMs: () => number;
  /** 拆题后还来得及做整句审计规划。 */
  canPlanWholeClaim: () => boolean;
  /** 来不及再刷新一次来源审计。 */
  tooLateForSourceAuditRefresh: () => boolean;
  /** 来不及再开一 pass 证据补查。 */
  tooLateForEvidencePass: () => boolean;
  /** 已进入报告写作的保留时间：补查、质询要停。 */
  mustYieldToComposer: () => boolean;
  /** 来得及启动质询。 */
  canCrossExamine: () => boolean;
  /** 在报告写作的保留时间之外还有余量（因果增强、整句审计、审计补查与重评）。 */
  hasComposerHeadroom: () => boolean;
  /** 审计补查逐条进行时：余量已用完。 */
  composerHeadroomUsedUp: () => boolean;
};

export function createBudget(deadline: number | undefined): Budget {
  const timeLeftMs = () => (deadline == null ? Number.POSITIVE_INFINITY : deadline - Date.now());
  return {
    timeLeftMs,
    canPlanWholeClaim: () => timeLeftMs() > AUDIT_MIN_MS,
    tooLateForSourceAuditRefresh: () => timeLeftMs() <= SOURCE_AUDIT_REFRESH_MIN_MS,
    tooLateForEvidencePass: () => timeLeftMs() < EVIDENCE_PASS_MIN_MS,
    mustYieldToComposer: () => timeLeftMs() < COMPOSER_RESERVE_MS,
    canCrossExamine: () => timeLeftMs() > CROSS_EXAM_MIN_MS,
    hasComposerHeadroom: () => timeLeftMs() > COMPOSER_RESERVE_MS,
    composerHeadroomUsedUp: () => timeLeftMs() <= COMPOSER_RESERVE_MS,
  };
}
