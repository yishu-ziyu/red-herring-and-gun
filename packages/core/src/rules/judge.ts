import type { ClaimVerdict, Evidence, Stance } from "../casefile/schema.js";
import { defaultJudgeConfig, type JudgeConfig } from "./judgeConfig.js";

export type JudgeInput = {
  claimId: string;
  stances: Stance[];
  evidence: Evidence[];
  updatedAt?: string;
};

type Direction = "supports" | "refutes" | "partial";

/**
 * 只读 stance / evidence 的结构化字段，不读 quote 正文、不读 URL、不做关键词启发式。
 * 模型自由文本已经被 assess 挡在 quoteFidelity / confidence 之外。
 */
export function judge(input: JudgeInput, config: JudgeConfig = defaultJudgeConfig): ClaimVerdict {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const valid: Stance[] = [];
  for (const stance of input.stances) {
    if (stance.claimId !== input.claimId) continue;
    if (!stance.quoteFidelity) continue;
    if (stance.confidence < config.MIN_CONFIDENCE) continue;
    const evidence = evidenceById.get(stance.evidenceId);
    if (!evidence) continue;
    if (evidence.reachable === false) continue;
    valid.push(stance);
  }

  if (valid.length === 0) {
    return { claimId: input.claimId, verdict: "unverified", basis: [], rule: "no-evidence", updatedAt };
  }

  const clusters = new Map<string, Stance[]>();
  for (const stance of valid) {
    const evidence = evidenceById.get(stance.evidenceId)!;
    const key = evidence.clusterId ?? evidence.id;
    const group = clusters.get(key);
    if (group) group.push(stance);
    else clusters.set(key, [stance]);
  }

  let sup = 0;
  let ref = 0;
  let par = 0;
  const basis: string[] = [];
  const seen = new Set<string>();

  const take = (group: Stance[], direction: Direction, add: (weight: number) => void): void => {
    const ofType = group.filter((item) => item.stance === direction);
    if (ofType.length === 0) return;
    let maxWeight = 0;
    const weighted: { stance: Stance; weight: number }[] = [];
    for (const stance of ofType) {
      const evidence = evidenceById.get(stance.evidenceId)!;
      const weight = config.TIER_WEIGHT[evidence.tier];
      weighted.push({ stance, weight });
      if (weight > maxWeight) maxWeight = weight;
    }
    add(maxWeight);
    for (const row of weighted) {
      if (row.weight !== maxWeight) continue;
      if (seen.has(row.stance.id)) continue;
      seen.add(row.stance.id);
      basis.push(row.stance.id);
    }
  };

  for (const group of clusters.values()) {
    take(group, "supports", (weight) => {
      sup += weight;
    });
    take(group, "refutes", (weight) => {
      ref += weight;
    });
    take(group, "partial", (weight) => {
      par += weight;
    });
  }

  const tally = { sup, ref, par };
  if (sup >= config.CONTESTED_MIN && ref >= config.CONTESTED_MIN) {
    return { claimId: input.claimId, verdict: "contested", basis, rule: "contested", tally, updatedAt };
  }
  if (ref >= config.FALSE_MIN && ref > sup) {
    return { claimId: input.claimId, verdict: "false", basis, rule: "false", tally, updatedAt };
  }
  if (sup >= config.TRUE_MIN && sup > ref) {
    return { claimId: input.claimId, verdict: "true", basis, rule: "true", tally, updatedAt };
  }
  if (par >= config.PARTIAL_MIN && par >= sup && par >= ref) {
    return { claimId: input.claimId, verdict: "partial", basis, rule: "partial", tally, updatedAt };
  }
  return { claimId: input.claimId, verdict: "unverified", basis, rule: "insufficient", tally, updatedAt };
}
