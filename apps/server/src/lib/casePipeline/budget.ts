/**
 * 一次调查的时间预算。现在只剩一个判断：还来不来得及再审一次来源关系。
 * 截止时间不是有限数时视为没有截止。
 */

/** 来源审计刷新的最低余量；不够时新来源一律只作背景（fail-closed）。 */
export const SOURCE_AUDIT_REFRESH_MIN_MS = 20_000;

export type Budget = {
  /** 来不及再刷新一次来源审计。 */
  tooLateForSourceAuditRefresh: () => boolean;
};

export function createBudget(deadline: number | undefined): Budget {
  const timeLeftMs = () => (deadline == null ? Number.POSITIVE_INFINITY : deadline - Date.now());
  return {
    tooLateForSourceAuditRefresh: () => timeLeftMs() <= SOURCE_AUDIT_REFRESH_MIN_MS,
  };
}
