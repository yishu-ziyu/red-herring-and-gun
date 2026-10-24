/**
 * 中断帧：phase=interrupted，保留已真实获得的 claims/sources/gaps/conflicts。
 * 已有 conclusion 必须留下。没有 conclusion、但每条可核查命题都有判断时，
 * 用分条判断拼一句有界总答，不装成报告写完。
 */
import { VERDICT_OUTCOME, decideSentenceVerdict, standingForJudgment, type SentenceJudgment } from "./domain/verdict.js";
import {
  LABEL_TEXT,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "./investigation/index.js";
import { claimLabel } from "./investigation/presentation.js";

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

type BoundedInterruptedClaim = Pick<InvestigationSnapshotV1["claims"][number], "text" | "checkability" | "judgment" | "label">;

type BoundedInterruptedAnswer = {
  directAnswer: string;
  judgment: SentenceJudgment;
};

/**
 * 中断且报告还没写成时：用已有分条判断拼一句总答。
 * 每条可核查命题都有 judgment 才写；不编来源、不装成报告写完。
 */
function boundedInterruptedAnswer(
  claims: readonly BoundedInterruptedClaim[]
): BoundedInterruptedAnswer | null {
  const checkable = claims.filter((c) => c.checkability === "checkable");
  if (checkable.length === 0) return null;
  if (checkable.some((c) => !c.judgment)) return null;

  const phrases = checkable.map((c) => `「${c.text}」${LABEL_TEXT[claimLabel(c) ?? "unresolved"]}`);
  const directAnswer = `${phrases.join("；")}。`;

  // 快照里的命题没有角色，规则表按「没标主要主张时每一条都是主要主张」处理。
  const decision = decideSentenceVerdict(
    checkable.map((c) => ({ text: c.text, role: "main" as const, standing: standingForJudgment(c.judgment) })),
  );
  return { directAnswer, judgment: VERDICT_OUTCOME[decision.verdict].judgment };
}
