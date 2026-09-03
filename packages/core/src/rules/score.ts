import type { Claim, ClaimVerdict, Evidence, Overall, Stance } from "../casefile/schema.js";
import { defaultJudgeConfig, type JudgeConfig } from "./judgeConfig.js";

export type ScoreInput = {
  claims: Claim[];
  verdicts: ClaimVerdict[];
  stances: Stance[];
  evidence: Evidence[];
  contested: boolean;
};

export type ScoreResult = Pick<Overall, "score" | "breakdown">;

type BreakdownRow = Overall["breakdown"][number];

/**
 * 分数是原句可信度 0–100，不是证据质量；一句话的可信度不高于它最弱的一环。
 */
export function score(input: ScoreInput, config: JudgeConfig = defaultJudgeConfig): ScoreResult {
  const checkable = input.claims.filter((claim) => claim.checkable);
  if (checkable.length === 0) {
    return {
      score: 50,
      breakdown: [{ key: "none", label: "没有可核对的命题", value: 50 }],
    };
  }

  const verdictByClaim = new Map(input.verdicts.map((item) => [item.claimId, item]));
  const stanceById = new Map(input.stances.map((item) => [item.id, item]));
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const n = checkable.length;
  const ranked = checkable.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const ptsList: number[] = [];
  const breakdown: BreakdownRow[] = [];
  for (const claim of ranked) {
    const pts = claimPts(verdictByClaim.get(claim.id), stanceById, evidenceById, config);
    ptsList.push(pts);
    breakdown.push({
      key: `claim:${claim.id}`,
      label: `命题 ${claim.order + 1}`,
      value: Math.round(pts / (2 * n)),
    });
  }

  const minPts = Math.min(...ptsList);
  breakdown.push({ key: "weakest", label: "最弱一环", value: Math.round(minPts / 2) });
  if (input.contested) {
    breakdown.push({ key: "contested", label: "争议", value: -config.SCORE_CONTESTED_PENALTY });
  }

  const raw = breakdown.reduce((sum, row) => sum + row.value, 0);
  const clamped = Math.max(0, Math.min(100, raw));
  if (clamped !== raw) {
    breakdown.push({ key: "clamp", label: "裁剪", value: clamped - raw });
  }
  return { score: clamped, breakdown };
}

function claimPts(
  verdict: ClaimVerdict | undefined,
  stanceById: Map<string, Stance>,
  evidenceById: Map<string, Evidence>,
  config: JudgeConfig,
): number {
  const kind = verdict?.verdict ?? "unverified";
  let p: number;
  if (kind === "true") {
    p = config.SCORE_TRUE_BASE + config.SCORE_TRUE_SPAN * strength(verdict, stanceById, evidenceById, config);
  } else if (kind === "partial" || kind === "contested") {
    p = config.SCORE_MID;
  } else if (kind === "false") {
    const s = strength(verdict, stanceById, evidenceById, config);
    p = config.SCORE_FALSE_BASE - config.SCORE_FALSE_BASE * s;
  } else {
    const supported = (verdict?.tally?.sup ?? 0) > 0 ? 1 : 0;
    p = config.SCORE_UNVERIFIED_BASE + config.SCORE_UNVERIFIED_SUPPORTED * supported;
  }
  return Math.round(100 * p);
}

/** 簇键与旧实现相同：clusterId ?? id，同稿多条只算一簇。 */
function strength(
  verdict: ClaimVerdict | undefined,
  stanceById: Map<string, Stance>,
  evidenceById: Map<string, Evidence>,
  config: JudgeConfig,
): number {
  if (!verdict) return 0;
  const keys = new Set<string>();
  let hasA = false;
  for (const stanceId of verdict.basis) {
    const stance = stanceById.get(stanceId);
    if (!stance) continue;
    const evidence = evidenceById.get(stance.evidenceId);
    if (!evidence) continue;
    keys.add(evidence.clusterId ?? evidence.id);
    if (evidence.tier === "A") hasA = true;
  }
  const cap = config.SCORE_STRENGTH_CLUSTER_CAP;
  return (0.5 * Math.min(keys.size, cap)) / cap + 0.5 * (hasA ? 1 : 0);
}
