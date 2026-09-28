/**
 * 整句判定：原句该得到什么结论，由各命题的角色与证据状态推出。
 *
 * 这是产品最稳定的业务规则（2026-09-28 用户确认，docs/evals/2026-09-28-judgment-refactor.md），
 * 换模型、换搜索、换存储都不变。本文件不得引用任何外部模块（domain.boundary.test.ts 机器检查）。
 *
 * 参照：Snopes 按「主要内容 / 次要细节」定级；台湾事实查核中心「主要内容错误 / 部分错误 / 证据不足」。
 */

/** 命题在原句里的角色。拆题还不能区分前提、并列与背景时，除主要主张外都记为 secondary。 */
export type ClaimRole = "primary" | "secondary";

/** 一条命题的证据状态。只有能点开、方向一致的出处才算 refuted / supported。 */
export type ClaimStanding = "refuted" | "supported" | "mixed" | "unresolved";

export type AssessedClaim = {
  text: string;
  role: ClaimRole;
  standing: ClaimStanding;
};

/** 用户看到的整句结论。 */
export type SentenceVerdict = "cannot-believe" | "can-believe" | "part-true-part-false" | "not-enough-evidence";

export type VerdictDecision = {
  verdict: SentenceVerdict;
  /** 哪条规则得出的结论，写进报告便于回查。 */
  rule:
    | "primary-refuted"
    | "all-supported"
    | "supported-and-refuted"
    | "primary-mixed"
    | "primary-supported-others-unresolved"
    | "primary-unresolved"
    | "no-checkable-claim";
  /** 不决定结论、只作边界说明的命题：主要主张定了性之后，其余查不清的部分。 */
  boundaryClaims: AssessedClaim[];
};

export function decideSentenceVerdict(claims: readonly AssessedClaim[]): VerdictDecision {
  const primary = claims.find((claim) => claim.role === "primary");
  if (!primary) return { verdict: "not-enough-evidence", rule: "no-checkable-claim", boundaryClaims: [] };
  const others = claims.filter((claim) => claim !== primary);
  const unresolvedOthers = others.filter((claim) => claim.standing === "unresolved");

  // 主要主张被反驳：整句站不住，其余没查清的只作边界，不能把已知的错盖住。
  if (primary.standing === "refuted") {
    return { verdict: "cannot-believe", rule: "primary-refuted", boundaryClaims: unresolvedOthers };
  }
  if (primary.standing === "mixed") {
    return { verdict: "part-true-part-false", rule: "primary-mixed", boundaryClaims: unresolvedOthers };
  }
  if (primary.standing === "supported") {
    if (others.some((claim) => claim.standing === "refuted" || claim.standing === "mixed")) {
      return { verdict: "part-true-part-false", rule: "supported-and-refuted", boundaryClaims: unresolvedOthers };
    }
    // 成立要求每一截都有据：前提没查清就不能说撑得住。
    if (unresolvedOthers.length > 0) {
      return { verdict: "not-enough-evidence", rule: "primary-supported-others-unresolved", boundaryClaims: unresolvedOthers };
    }
    return { verdict: "can-believe", rule: "all-supported", boundaryClaims: [] };
  }
  return { verdict: "not-enough-evidence", rule: "primary-unresolved", boundaryClaims: unresolvedOthers };
}
