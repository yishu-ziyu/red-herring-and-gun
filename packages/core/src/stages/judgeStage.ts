import type { ClaimVerdict } from "../casefile/schema.js";
import { judge } from "../rules/judge.js";
import { overall } from "../rules/overall.js";
import { score } from "../rules/score.js";
import type { StageContext } from "./context.js";

export type JudgeStageInput = {
  claimIds?: string[];
};

export async function runJudge(ctx: StageContext, input: JudgeStageInput = {}): Promise<void> {
  const selected = ctx.current.claims.filter((claim) => {
    if (!claim.checkable) return false;
    return input.claimIds === undefined || input.claimIds.includes(claim.id);
  });

  for (const claim of selected) {
    const next = judge({
      claimId: claim.id,
      stances: ctx.current.stances.filter((item) => item.claimId === claim.id),
      evidence: ctx.current.evidence,
      updatedAt: ctx.now(),
    });
    const prev = ctx.current.verdicts.find((item) => item.claimId === claim.id);
    if (sameVerdict(prev, next)) continue;
    ctx.emit({ type: "verdict.updated", verdict: next });
  }

  const checkableIds = new Set(
    ctx.current.claims.filter((claim) => claim.checkable).map((claim) => claim.id),
  );
  const judged = overall(ctx.current.verdicts.filter((item) => checkableIds.has(item.claimId)));
  const scored = score({
    claims: ctx.current.claims,
    verdicts: ctx.current.verdicts,
    stances: ctx.current.stances,
    evidence: ctx.current.evidence,
    contested: judged.contested,
  });
  ctx.emit({
    type: "overall.updated",
    overall: {
      verdictType: judged.verdictType,
      contested: judged.contested,
      score: scored.score,
      breakdown: scored.breakdown,
    },
  });
}

function sameVerdict(prev: ClaimVerdict | undefined, next: ClaimVerdict): boolean {
  if (!prev) return false;
  if (prev.verdict !== next.verdict) return false;
  if (prev.rule !== next.rule) return false;
  if (prev.basis.length !== next.basis.length) return false;
  const other = new Set(next.basis);
  return prev.basis.every((id) => other.has(id));
}
