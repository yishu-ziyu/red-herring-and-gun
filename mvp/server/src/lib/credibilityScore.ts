/**
 * credibilityScore.ts — 多源证据合成可信度评分
 *
 * 输入：三个 Agent 的分类输出 + 360 Search 结果
 * 输出：0-100 连续分数 + 各维度贡献明细
 *
 * 方法论参考：MAFC (Scientific Reports 2026)
 * 核心设计：加权聚合 + log₂ 收敛 + 谣言严重度惩罚 + 缺失证据门控
 */

// ─── 类型 ───────────────────────────────────────────────────

export interface RumorInput {
  severity: "low" | "medium" | "high";
  rumorIndicators: string[];
  detectedPatterns: string[];
}

export interface FactCheckInput {
  factCheckResult: "true" | "false" | "partial" | "unverified";
  confidence: "low" | "medium" | "high";
  keyFindings: string[];
  counterEvidence: string[];
  sources: string[];
}

export interface SourceValidationInput {
  sourceReliability: "high" | "medium" | "low" | "unverified";
  verifiedSources: string[];
  questionableSources: string[];
  missingSources: string[];
  verificationNotes: string;
}

export interface SearchEvidence {
  direction: "support" | "contradict" | "neutral";
  credibility: "高" | "中" | "低";
}

export interface SearchInput {
  sources: SearchEvidence[];
  supportingEvidence: string[];
  contradictingEvidence: string[];
  unresolvedEvidenceGaps: string[];
}

export interface CredibilityScoreResult {
  score: number;
  label: string;
  breakdown: {
    factCheckSignal: number;
    searchSignal: number;
    sourceSignal: number;
    rumorPenalty: number;
    missingPenalty: number;
    supportForce: number;
    refuteForce: number;
  };
  verdict: "true" | "false" | "partial" | "unverified";
}

// ─── 映射表 ─────────────────────────────────────────────────

const FACT_CHECK_MAP: Record<string, number> = {
  true: 0.9,
  partial: 0.2,
  false: -0.9,
  unverified: 0,
};

const CONFIDENCE_MULTIPLIER: Record<string, number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.4,
};

const SOURCE_RELIABILITY_MAP: Record<string, number> = {
  high: 0.9,
  medium: 0.5,
  low: -0.4,
  unverified: 0,
};

const SEVERITY_PENALTY: Record<string, number> = {
  low: 0.2,
  medium: 0.4,
  high: 0.7,
};

const SEARCH_CREDIBILITY_MAP: Record<string, number> = {
  高: 0.8,
  中: 0.3,
  低: -0.3,
};

const SCORE_LABELS: { min: number; label: string }[] = [
  { min: 80, label: "高度可信" },
  { min: 60, label: "基本可信" },
  { min: 40, label: "存疑" },
  { min: 20, label: "低可信" },
  { min: 0, label: "高度可疑" },
];

// ─── 主函数 ─────────────────────────────────────────────────

export function computeCredibilityScore(
  rumor: RumorInput,
  factCheck: FactCheckInput,
  source: SourceValidationInput,
  search: SearchInput
): CredibilityScoreResult {
  // 分量 A：事实核查信号（核心判断）
  const factDir = FACT_CHECK_MAP[factCheck.factCheckResult] ?? 0;
  const factConf = CONFIDENCE_MULTIPLIER[factCheck.confidence] ?? 0.7;
  const factCheckSignal = factDir * factConf;

  // 分量 B：搜索引擎证据聚合
  const searchSignals = search.sources.map((s) => {
    const cred = SEARCH_CREDIBILITY_MAP[s.credibility] ?? 0;
    const dir = s.direction === "support" ? 1 : s.direction === "contradict" ? -1 : 0;
    return cred * dir;
  });
  const searchMean =
    searchSignals.length > 0 ? searchSignals.reduce((a, b) => a + b, 0) / searchSignals.length : 0;
  const searchSignal = Math.tanh(searchMean);

  // 分量 C：信源可靠性
  const sourceSignal = SOURCE_RELIABILITY_MAP[source.sourceReliability] ?? 0;

  // 分量 D：谣言严重度惩罚
  const rumorPenalty = SEVERITY_PENALTY[rumor.severity] ?? 0.2;
  const indicatorPenalty = Math.min(rumor.rumorIndicators.length * 0.15, 0.3);
  const totalRumorPenalty = rumorPenalty + indicatorPenalty;

  // 分量 E：缺失来源惩罚
  const missingPenalty = Math.min(source.missingSources.length * 0.05, 0.15);

  // ─── 聚合：log₂ 收敛 ──────────────────────────────────────

  const allSignals = [factCheckSignal, searchSignal, sourceSignal];
  const supportSignals = allSignals.filter((s) => s > 0);
  const refuteSignals = allSignals.filter((s) => s < 0);

  const supportForce =
    supportSignals.length > 0
      ? Math.log2(supportSignals.length + 1) * (supportSignals.reduce((a, b) => a + b, 0) / supportSignals.length)
      : 0;

  const refuteForce =
    refuteSignals.length > 0
      ? Math.log2(refuteSignals.length + 1) * (refuteSignals.reduce((a, b) => a + b, 0) / refuteSignals.length)
      : 0;

  const baseScore = supportForce + refuteForce;

  // ─── 归一化 + 惩罚 + 门控 ────────────────────────────────

  // baseScore 理论范围约 [-1.5, 1.5]，归一化到 [0, 100]
  let normalized = ((baseScore + 1.5) / 3.0) * 100;

  // 谣言严重度惩罚（乘法：高严重度大幅拉低分）
  normalized = normalized * (1 - 0.5 * totalRumorPenalty);

  // 缺失来源惩罚（加法：-5 到 -15 分）
  normalized = normalized + missingPenalty * 100;

  // 门控：unverified 且无可靠来源 → 封顶 50 分
  if (factCheck.factCheckResult === "unverified" && source.verifiedSources.length === 0) {
    normalized = Math.min(normalized, 50);
  }

  // 边界裁剪
  const score = Math.round(Math.max(0, Math.min(100, normalized)));
  const label = SCORE_LABELS.find((l) => score >= l.min)?.label ?? "高度可疑";

  return {
    score,
    label,
    breakdown: {
      factCheckSignal: round2(factCheckSignal),
      searchSignal: round2(searchSignal),
      sourceSignal: round2(sourceSignal),
      rumorPenalty: round2(totalRumorPenalty),
      missingPenalty: round2(missingPenalty),
      supportForce: round2(supportForce),
      refuteForce: round2(refuteForce),
    },
    verdict: factCheck.factCheckResult,
  };
}

// ─── 旧方法（LLM 直接打分）的接口 ───────────────────────────

export interface LlmScoreInput {
  credibilityScore: number;
  credibilityLabel: string;
  confidenceDimensions: Array<{
    dimension: string;
    score: number;
    threshold: number;
    passed: boolean;
    reason: string;
  }>;
}

export function extractLlmScore(input: LlmScoreInput): { score: number; label: string } {
  return {
    score: input.credibilityScore,
    label: input.credibilityLabel,
  };
}

// ─── 工具函数 ───────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
