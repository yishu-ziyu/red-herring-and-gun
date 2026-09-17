/**
 * 中断帧：phase=interrupted，保留已真实获得的 claims/sources/gaps/conflicts。
 * 已有 conclusion 必须留下。没有 conclusion、但每条可核查命题都有判断时，
 * 用分条判断拼一句有界总答，不装成报告写完。
 */
import { boundedInterruptedAnswer } from "./publicCopy.js";
import {
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "./investigation/index.js";

export function interruptedInvestigationSnapshot(
  last: InvestigationSnapshotV1 | undefined,
  claim: string
): InvestigationSnapshotV1 {
  if (!last) {
    return {
      schemaVersion: 1,
      originalClaim: claim,
      phase: "interrupted",
      claims: [],
      sources: [],
      conflicts: [],
    };
  }
  const claims = last.claims.map((claimRow) =>
    claimRow.progress === "complete"
      ? claimRow
      : { ...claimRow, progress: "interrupted" as const }
  );
  const conclusion = last.conclusion ?? synthesizeInterruptedConclusion(claims);
  return validateInvestigationSnapshot({
    ...last,
    phase: "interrupted",
    conclusion,
    checkedAt: last.conclusion ? last.checkedAt : undefined,
    claims,
  });
}

function synthesizeInterruptedConclusion(
  claims: InvestigationSnapshotV1["claims"]
): InvestigationSnapshotV1["conclusion"] {
  const bounded = boundedInterruptedAnswer(claims);
  if (!bounded) return undefined;
  const sourceIds = [
    ...new Set(claims.flatMap((row) => row.evidence.map((link) => link.sourceId))),
  ];
  return {
    directAnswer: bounded.directAnswer,
    judgment: bounded.judgment,
    boundaries: [],
    claimIds: claims.map((row) => row.id),
    sourceIds,
  };
}
