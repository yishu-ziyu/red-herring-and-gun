/**
 * 分数是原句可信度 0–100，不是证据质量；一句话的可信度不高于它最弱的一环。
 * 裁判阈值也集中在这里：改这里，不要在 judge / overall / score 里再写魔法数。
 *
 * 权重刻度故意用 1/2/3：A 单独够证伪（FALSE_MIN=3），两独立 B 或 A+C 才够证实（TRUE_MIN=4）。
 * 证伪门槛低于证实——一条官方口径足以推翻，一条官方口径不足以单独坐实。
 */

/** A 一手官方/央媒，单独即可推翻；B 主流媒体需两簇独立；C / unknown 只作辅证。 */
export const TIER_WEIGHT = { A: 3, B: 2, C: 1, unknown: 1 } as const;

/** 低于此的立场视为模型没看清，不进加权。0.5 是「至少不比瞎蒙差」。 */
export const MIN_CONFIDENCE = 0.5;

/** 两边都至少有一记 A 级分量（或等价 3）才叫争议，避免单条 C 反驳就撕成 contested。 */
export const CONTESTED_MIN = 3;

/** 一方权重达另一方两倍即压制，不再算争议。 */
export const CONTESTED_DOMINANCE = 2;

/** 坐实为真：两独立 B（2+2）或一 A 加一独立辅证（3+1）。单 A 仍可能是孤证。 */
export const TRUE_MIN = 4;

/** 坐实为假：一条 A 级反驳即可。证伪门槛低于证实。 */
export const FALSE_MIN = 3;

/** partial 权重至少这么多、且占比最高才判部分成立。2 = 两独立 C 或一 B，一条 C 不够。 */
export const PARTIAL_MIN = 2;

/** true 的可信度下限；strength 再在 SPAN 上加。 */
export const SCORE_TRUE_BASE = 0.70;

/** true 随 strength 从 BASE 走到 1.0 的幅度。 */
export const SCORE_TRUE_SPAN = 0.30;

/** contested 的固定可信度：两边都有据、无法判定，是不确定的中间态。 */
export const SCORE_MID = 0.50;

/** partial 的固定可信度：部分属实即误导，可信度必须低于一半。 */
export const SCORE_PARTIAL = 0.30;

/** unverified 且 tally.sup 为 0 时的可信度。 */
export const SCORE_UNVERIFIED_BASE = 0.15;

/** unverified 且 tally.sup > 0 时在 BASE 上再加的幅度。 */
export const SCORE_UNVERIFIED_SUPPORTED = 0.15;

/** false 的可信度上限；strength 越大越往 0 压。 */
export const SCORE_FALSE_BASE = 0.15;

/** strength 里独立簇数的封顶，超过不再加分。 */
export const SCORE_STRENGTH_CLUSTER_CAP = 3;

/** 整句 contested 时的固定扣分。两边都有据就不应还是高可信。 */
export const SCORE_CONTESTED_PENALTY = 10;
export const ASSESS_MAX_EVIDENCE = 12;

export const defaultJudgeConfig = {
  TIER_WEIGHT,
  MIN_CONFIDENCE,
  CONTESTED_MIN,
  CONTESTED_DOMINANCE,
  TRUE_MIN,
  FALSE_MIN,
  PARTIAL_MIN,
  SCORE_TRUE_BASE,
  SCORE_TRUE_SPAN,
  SCORE_MID,
  SCORE_PARTIAL,
  SCORE_UNVERIFIED_BASE,
  SCORE_UNVERIFIED_SUPPORTED,
  SCORE_FALSE_BASE,
  SCORE_STRENGTH_CLUSTER_CAP,
  SCORE_CONTESTED_PENALTY,
} as const;

export type JudgeConfig = {
  TIER_WEIGHT: { A: number; B: number; C: number; unknown: number };
  MIN_CONFIDENCE: number;
  CONTESTED_MIN: number;
  CONTESTED_DOMINANCE: number;
  TRUE_MIN: number;
  FALSE_MIN: number;
  PARTIAL_MIN: number;
  SCORE_TRUE_BASE: number;
  SCORE_TRUE_SPAN: number;
  SCORE_MID: number;
  SCORE_PARTIAL: number;
  SCORE_UNVERIFIED_BASE: number;
  SCORE_UNVERIFIED_SUPPORTED: number;
  SCORE_FALSE_BASE: number;
  SCORE_STRENGTH_CLUSTER_CAP: number;
  SCORE_CONTESTED_PENALTY: number;
};
