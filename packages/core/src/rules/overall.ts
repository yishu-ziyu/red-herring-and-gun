import type { ClaimVerdict, Overall } from "../casefile/schema.js";

/**
 * 命题判决 → 整句 verdictType + contested 标记。
 *
 * 顺序：
 * 1. 任一 contested → contested: true（标记，不单独成为 verdictType）
 * 2. 全 true → true
 * 3. 全 false → false
 * 4. 同时有 true 与 false，或有 partial → mixed_misleading
 * 5. 全 unverified → unverified
 * 6. 其余（true+unverified、false+contested 等）按占多数的那类：
 *    true / false / unverified 对应该字面；contested 多数 → mixed_misleading
 *    平票：含 contested 且含 true/false → mixed_misleading；
 *    含 unverified 的其它平票 → unverified（保守，不把半句未核说成已判）；
 *    其余平票 → mixed_misleading
 * 空列表 → unverified, contested false（避免 [].every 的空真）。
 */

export type OverallJudgement = Pick<Overall, "verdictType" | "contested">;

export function overall(verdicts: ClaimVerdict[]): OverallJudgement {
  if (verdicts.length === 0) {
    return { verdictType: "unverified", contested: false };
  }

  const contested = verdicts.some((item) => item.verdict === "contested");
  if (verdicts.every((item) => item.verdict === "true")) {
    return { verdictType: "true", contested };
  }
  if (verdicts.every((item) => item.verdict === "false")) {
    return { verdictType: "false", contested };
  }

  const hasTrue = verdicts.some((item) => item.verdict === "true");
  const hasFalse = verdicts.some((item) => item.verdict === "false");
  const hasPartial = verdicts.some((item) => item.verdict === "partial");
  if ((hasTrue && hasFalse) || hasPartial) {
    return { verdictType: "mixed_misleading", contested };
  }
  if (verdicts.every((item) => item.verdict === "unverified")) {
    return { verdictType: "unverified", contested };
  }

  let nTrue = 0;
  let nFalse = 0;
  let nUnverified = 0;
  let nContested = 0;
  for (const item of verdicts) {
    if (item.verdict === "true") nTrue += 1;
    else if (item.verdict === "false") nFalse += 1;
    else if (item.verdict === "unverified") nUnverified += 1;
    else if (item.verdict === "contested") nContested += 1;
  }

  const max = Math.max(nTrue, nFalse, nUnverified, nContested);
  const trueWins = nTrue === max;
  const falseWins = nFalse === max;
  const unverifiedWins = nUnverified === max;
  const contestedWins = nContested === max;
  const winners = (trueWins ? 1 : 0) + (falseWins ? 1 : 0) + (unverifiedWins ? 1 : 0) + (contestedWins ? 1 : 0);

  if (winners === 1) {
    if (trueWins) return { verdictType: "true", contested };
    if (falseWins) return { verdictType: "false", contested };
    if (unverifiedWins) return { verdictType: "unverified", contested };
    return { verdictType: "mixed_misleading", contested };
  }
  if (contestedWins && (trueWins || falseWins)) {
    return { verdictType: "mixed_misleading", contested };
  }
  if (unverifiedWins) {
    return { verdictType: "unverified", contested };
  }
  return { verdictType: "mixed_misleading", contested };
}
