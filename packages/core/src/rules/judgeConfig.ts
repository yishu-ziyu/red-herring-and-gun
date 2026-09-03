/**
 * 裁判与打分的全部阈值。改这里，不要在 judge / overall / score 里再写魔法数。
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

/** 坐实为真：两独立 B（2+2）或一 A 加一独立辅证（3+1）。单 A 仍可能是孤证。 */
export const TRUE_MIN = 4;

/** 坐实为假：一条 A 级反驳即可。证伪门槛低于证实。 */
export const FALSE_MIN = 3;

/** partial 权重至少这么多、且占比最高才判部分成立。2 = 两独立 C 或一 B，一条 C 不够。 */
export const PARTIAL_MIN = 2;

/** 分数起点。覆盖/簇/A 级加分到满配 100；全未核 = 30 − 15 = 15，表示「几乎没查到」而不是 0。 */
export const SCORE_BASE = 30;

/** 有 basis 的命题占比满分。依据覆盖是「查过」的主信号。 */
export const SCORE_COVERAGE_MAX = 30;

/** 独立簇项满分。来源独立性与覆盖分开计，避免同稿堆量。 */
export const SCORE_CLUSTER_MAX = 20;

/** 4 个独立簇就把独立性学分用尽；再多的来源改走覆盖率和 A 级占比。 */
export const SCORE_CLUSTER_CAP = 4;

/** basis 里 A 级证据占比满分。一手来源是可解释加分，不是关键词启发式。 */
export const SCORE_TIER_A_MAX = 20;

/** 未核命题占比的扣分上限。全未核 −15，避免「没查清」看起来像中性。 */
export const SCORE_UNVERIFIED_PENALTY = 15;

/** 整句 contested 时的固定扣分。两边都有据就不应还是高可信。 */
export const SCORE_CONTESTED_PENALTY = 15;

export const defaultJudgeConfig = {
  TIER_WEIGHT,
  MIN_CONFIDENCE,
  CONTESTED_MIN,
  TRUE_MIN,
  FALSE_MIN,
  PARTIAL_MIN,
  SCORE_BASE,
  SCORE_COVERAGE_MAX,
  SCORE_CLUSTER_MAX,
  SCORE_CLUSTER_CAP,
  SCORE_TIER_A_MAX,
  SCORE_UNVERIFIED_PENALTY,
  SCORE_CONTESTED_PENALTY,
} as const;

export type JudgeConfig = {
  TIER_WEIGHT: { A: number; B: number; C: number; unknown: number };
  MIN_CONFIDENCE: number;
  CONTESTED_MIN: number;
  TRUE_MIN: number;
  FALSE_MIN: number;
  PARTIAL_MIN: number;
  SCORE_BASE: number;
  SCORE_COVERAGE_MAX: number;
  SCORE_CLUSTER_MAX: number;
  SCORE_CLUSTER_CAP: number;
  SCORE_TIER_A_MAX: number;
  SCORE_UNVERIFIED_PENALTY: number;
  SCORE_CONTESTED_PENALTY: number;
};
