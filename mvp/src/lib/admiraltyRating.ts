/**
 * admiraltyRating.ts — Plan P2-3 · NATO Admiralty Code 双轴评级
 *
 * 借鉴北约 Admiralty System（情报评估标准）：
 *   - 来源可靠性 (Source Reliability)：A 完全可靠 / B 通常可靠 / C 尚可靠 /
 *     D 不通常可靠 / E 不可靠 / F 无法判断
 *   - 信息准确性 (Information Credibility)：1 确认 / 2 很可能真实 / 3 可能真实 /
 *     4 可疑 / 5 不大可能 / 6 无法判断
 *
 * 设计原则（plan §4）：
 *   - 不替代主分数（plan §4 冻结项：computeCredibilityScore 不变）
 *   - 未知源默认 F/6（"无法判断"）并附理由
 *   - 与现有四维评估（Relevance/Traceability/Method Fit/Context Fit）解耦
 */

export type SourceReliability = "A" | "B" | "C" | "D" | "E" | "F";
export type InformationCredibility = "1" | "2" | "3" | "4" | "5" | "6";

export const SOURCE_RELIABILITY_LABELS: Record<SourceReliability, string> = {
  A: "完全可靠",
  B: "通常可靠",
  C: "尚可靠",
  D: "不通常可靠",
  E: "不可靠",
  F: "无法判断",
};

export const INFORMATION_CREDIBILITY_LABELS: Record<InformationCredibility, string> = {
  "1": "确认",
  "2": "很可能真实",
  "3": "可能真实",
  "4": "可疑",
  "5": "不大可能",
  "6": "无法判断",
};

export interface AdmiraltyRating {
  sourceReliability: SourceReliability;
  informationCredibility: InformationCredibility;
  /** 评级的具体理由（人类可读） */
  rationale: string;
  /** 是否评估过（false = 未提供足够信息） */
  assessed: boolean;
}

export interface AdmiraltyInputs {
  /** 来源历史表现（如来自 P1-4 sourceReputationRegistry） */
  sourceHistory?: "unrated" | "positive" | "mixed" | "negative";
  /** 信息是否多源交叉验证（来自现有 foldLineage） */
  crossVerifiedByIndependentSources?: number;
  /** 是否最新（来自现有 freshness 评分） */
  isRecent?: boolean;
  /** 是否一手（官方发布 / 原始研究 / 同行评审） */
  isPrimary?: boolean;
  /** 是否匿名 / 营销号 */
  isAnonymousOrMarketing?: boolean;
}

/**
 * 给定输入信号，自动判定 Admiralty 双轴评级。
 *
 * 启发式规则：
 *   - 来源信誉映射 (NATO A-F)：
 *     - positive history + primary → A 或 B
 *     - positive history + secondary → B
 *     - mixed history → C
 *     - negative history → D 或 E
 *     - unrated → F（默认保守）
 *     - anonymous/marketing 强制降级到 E
 *   - 信息准确性映射 (NATO 1-6)：
 *     - ≥3 独立来源交叉验证 + recent → 1 或 2
 *     - 1-2 独立来源 → 3
 *     - 0 独立来源 → 4 或 5
 *     - 完全无证据 → 6
 */
export function rateAdmiralty(inputs: AdmiraltyInputs): AdmiraltyRating {
  // 来源可靠性
  let src: SourceReliability;
  let srcReason: string;
  if (inputs.isAnonymousOrMarketing) {
    src = "E";
    srcReason = "匿名或营销号来源，强制降级到 E";
  } else if (inputs.sourceHistory === "positive" && inputs.isPrimary) {
    src = "A";
    srcReason = "历史表现良好 + 一手来源（官方/同行评审）";
  } else if (inputs.sourceHistory === "positive") {
    src = "B";
    srcReason = "历史表现良好（非一手来源）";
  } else if (inputs.sourceHistory === "mixed") {
    src = "C";
    srcReason = "历史表现尚可靠但有争议";
  } else if (inputs.sourceHistory === "negative") {
    src = inputs.isPrimary ? "D" : "E";
    srcReason = `历史表现不佳（${src}）`;
  } else {
    // unrated 或未提供
    src = "F";
    srcReason = "来源历史未评级，按保守默认 F";
  }

  // 信息准确性
  let info: InformationCredibility;
  let infoReason: string;
  const indep = inputs.crossVerifiedByIndependentSources ?? 0;
  if (indep >= 3 && inputs.isRecent) {
    info = "1";
    infoReason = `≥3 独立来源交叉验证（${indep}）+ 信息较新`;
  } else if (indep >= 3) {
    info = "2";
    infoReason = `≥3 独立来源交叉验证（${indep}）`;
  } else if (indep >= 1) {
    info = "3";
    infoReason = `1-2 个独立来源（${indep}）`;
  } else if (indep === 0 && inputs.sourceHistory) {
    info = "4";
    infoReason = "无独立来源验证，存疑";
  } else {
    info = "6";
    infoReason = "无独立来源 + 来源历史未评级，无法判断";
  }

  return {
    sourceReliability: src,
    informationCredibility: info,
    rationale: `${srcReason}；${infoReason}`,
    assessed: true,
  };
}

/**
 * 未知 / 缺信号时的兜底评级（F/6）。
 */
export function unratedAdmiralty(reason = "无足够信号"): AdmiraltyRating {
  return {
    sourceReliability: "F",
    informationCredibility: "6",
    rationale: reason,
    assessed: false,
  };
}

/**
 * UI 渲染用：把评级组合成一句话。
 */
export function formatAdmiraltyRating(rating: AdmiraltyRating): string {
  if (!rating.assessed) {
    return "无法评级";
  }
  return `${rating.sourceReliability}${rating.informationCredibility}（${SOURCE_RELIABILITY_LABELS[rating.sourceReliability]} × ${INFORMATION_CREDIBILITY_LABELS[rating.informationCredibility]}）`;
}