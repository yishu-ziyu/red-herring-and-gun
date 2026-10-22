/**
 * 中断帧：phase=interrupted，保留已真实获得的 claims/sources/gaps/conflicts。
 * 已有 conclusion 必须留下。没有 conclusion、但每条可核查命题都有判断时，
 * 用分条判断拼一句有界总答，不装成报告写完。
 */
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

const CLAIM_JUDGMENT_PHRASE: Record<string, string> = {
  supported: "站得住",
  refuted: "站不住",
  mixed: "有对有错",
  unresolved: "还查不清",
};

type BoundedInterruptedClaim = {
  text: string;
  checkability: string;
  judgment: string | null;
};

type BoundedInterruptedAnswer = {
  directAnswer: string;
  judgment: "supported" | "refuted" | "mixed" | "unresolved";
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
  if (checkable.some((c) => c.judgment == null || c.judgment === "")) return null;

  const phrases = checkable.map((c) => {
    const word = CLAIM_JUDGMENT_PHRASE[c.judgment!] ?? "还查不清";
    return `「${c.text}」${word}`;
  });
  const directAnswer = `${phrases.join("；")}。`;

  const judgments = new Set(checkable.map((c) => c.judgment));
  const hasSupported = judgments.has("supported");
  const hasRefuted = judgments.has("refuted");
  const hasMixed = judgments.has("mixed");
  const judgment: BoundedInterruptedAnswer["judgment"] =
    hasMixed || (hasSupported && hasRefuted)
      ? "mixed"
      : hasRefuted
        ? "refuted"
        : hasSupported
          ? "supported"
          : "unresolved";
  return { directAnswer, judgment };
}
