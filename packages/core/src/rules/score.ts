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

/**
 * 0–100 可加分。精神来自 T05 sourceCredibility（按来源层级给可读加分），
 * 不用 credibilityScore 的谣言关键词 / log₂ 黑盒。
 *
 * breakdown 各项之和恒等于 score。可以有一项 base。
 */
export function score(input: ScoreInput, config: JudgeConfig = defaultJudgeConfig): ScoreResult {
  const verdictByClaim = new Map(input.verdicts.map((item) => [item.claimId, item]));
  const stanceById = new Map(input.stances.map((item) => [item.id, item]));
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));

  const claimCount = input.claims.length;
  let withBasis = 0;
  let unverifiedCount = 0;
  const clusterKeys = new Set<string>();
  let basisEvidence = 0;
  let tierA = 0;
  const countedEvidence = new Set<string>();

  for (const claim of input.claims) {
    const verdict = verdictByClaim.get(claim.id);
    if (!verdict || verdict.verdict === "unverified") unverifiedCount += 1;
    if (!verdict || verdict.basis.length === 0) continue;
    withBasis += 1;
    for (const stanceId of verdict.basis) {
      const stance = stanceById.get(stanceId);
      if (!stance) continue;
      const evidence = evidenceById.get(stance.evidenceId);
      if (!evidence) continue;
      clusterKeys.add(evidence.clusterId ?? evidence.id);
      if (countedEvidence.has(evidence.id)) continue;
      countedEvidence.add(evidence.id);
      basisEvidence += 1;
      if (evidence.tier === "A") tierA += 1;
    }
  }

  const coverage =
    claimCount === 0 ? 0 : Math.round((withBasis * config.SCORE_COVERAGE_MAX) / claimCount);
  const clusterPts = Math.round(
    (Math.min(clusterKeys.size, config.SCORE_CLUSTER_CAP) * config.SCORE_CLUSTER_MAX) /
      config.SCORE_CLUSTER_CAP,
  );
  const tierAPts =
    basisEvidence === 0 ? 0 : Math.round((tierA * config.SCORE_TIER_A_MAX) / basisEvidence);
  const unverifiedPts =
    claimCount === 0
      ? 0
      : -Math.round((unverifiedCount * config.SCORE_UNVERIFIED_PENALTY) / claimCount);
  const contestedPts = input.contested ? -config.SCORE_CONTESTED_PENALTY : 0;

  const breakdown = [
    { key: "base", label: "起点", value: config.SCORE_BASE },
    { key: "coverage", label: "依据覆盖率", value: coverage },
    { key: "clusters", label: "独立簇", value: clusterPts },
    { key: "tierA", label: "A 级占比", value: tierAPts },
    { key: "unverified", label: "未核占比", value: unverifiedPts },
    { key: "contested", label: "争议", value: contestedPts },
  ];
  const raw = breakdown.reduce((sum, row) => sum + row.value, 0);
  const clamped = Math.max(0, Math.min(100, raw));
  if (clamped !== raw) {
    breakdown.push({ key: "clamp", label: "裁剪", value: clamped - raw });
  }

  return { score: clamped, breakdown };
}
