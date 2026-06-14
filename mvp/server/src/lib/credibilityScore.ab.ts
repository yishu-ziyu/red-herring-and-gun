/**
 * A/B 对比：公式评分 vs 模拟 LLM 评分
 */

import { computeCredibilityScore, type SearchInput } from "./credibilityScore";

const cases = [
  {
    name: "A. 典型谣言",
    rumor: { severity: "high" as const, rumorIndicators: ["匿名信源", "恐惧诉求", "情绪煽动", "虚假紧迫性", "阴谋论暗示"], detectedPatterns: ["经典谣言模板"] },
    factCheck: { factCheckResult: "false" as const, confidence: "high" as const, keyFindings: ["官方已辟谣", "无科学依据"], counterEvidence: ["多个权威来源证伪"], sources: ["卫健委官网", "WHO", "科普中国"] },
    source: { sourceReliability: "low" as const, verifiedSources: [], questionableSources: ["匿名爆料群", "营销号"], missingSources: ["原始出处", "研究机构"], verificationNotes: "无法追溯" },
    search: { sources: [{ direction: "contradict" as const, credibility: "高" }, { direction: "contradict" as const, credibility: "高" }, { direction: "support" as const, credibility: "低" }], supportingEvidence: ["营销号传播"], contradictingEvidence: ["卫健委辟谣", "WHO 声明"], unresolvedEvidenceGaps: ["缺少原始研究"] },
    llmScore: 25,
  },
  {
    name: "B. 基本可信",
    rumor: { severity: "low" as const, rumorIndicators: [] as string[], detectedPatterns: [] as string[] },
    factCheck: { factCheckResult: "true" as const, confidence: "high" as const, keyFindings: ["多源证实", "数据一致"], counterEvidence: [] as string[], sources: ["官方发布", "权威媒体"] },
    source: { sourceReliability: "high" as const, verifiedSources: ["政府官网", "权威媒体"], questionableSources: [] as string[], missingSources: [] as string[], verificationNotes: "来源可追溯且权威" },
    search: { sources: [{ direction: "support" as const, credibility: "高" }, { direction: "support" as const, credibility: "高" }, { direction: "support" as const, credibility: "中" }], supportingEvidence: ["官方数据", "独立报道"], contradictingEvidence: [] as string[], unresolvedEvidenceGaps: [] as string[] },
    llmScore: 78,
  },
  {
    name: "C. 存疑（最难）",
    rumor: { severity: "medium" as const, rumorIndicators: ["模糊引用", "断章取义"], detectedPatterns: ["选择性引用"] },
    factCheck: { factCheckResult: "partial" as const, confidence: "medium" as const, keyFindings: ["部分数据真实", "结论被夸大"], counterEvidence: ["上下文缺失导致误解"], sources: ["原始研究", "二手报道"] },
    source: { sourceReliability: "medium" as const, verifiedSources: ["原始研究存在"], questionableSources: ["二手报道有选择性"], missingSources: ["完整研究原文"], verificationNotes: "研究存在但结论被曲解" },
    search: { sources: [{ direction: "support" as const, credibility: "中" }, { direction: "neutral" as const, credibility: "低" }, { direction: "contradict" as const, credibility: "中" }], supportingEvidence: ["原始数据部分吻合"], contradictingEvidence: ["结论超出数据范围"], unresolvedEvidenceGaps: ["缺少完整上下文"] },
    llmScore: 48,
  },
  {
    name: "D. 证据不足",
    rumor: { severity: "medium" as const, rumorIndicators: ["匿名信源", "模糊引用"], detectedPatterns: [] as string[] },
    factCheck: { factCheckResult: "unverified" as const, confidence: "low" as const, keyFindings: [] as string[], counterEvidence: [] as string[], sources: [] as string[] },
    source: { sourceReliability: "unverified" as const, verifiedSources: [] as string[], questionableSources: [] as string[], missingSources: [] as string[], verificationNotes: "无法找到原始来源" },
    search: { sources: [] as any[], supportingEvidence: [] as string[], contradictingEvidence: [] as string[], unresolvedEvidenceGaps: ["无可用搜索结果"] },
    llmScore: 35,
  },
];

for (const c of cases) {
  const r = computeCredibilityScore(c.rumor, c.factCheck, c.source, c.search as SearchInput);
  const diff = Math.abs(r.score - c.llmScore);
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${c.name}`);
  console.log(`  公式：${r.score}分 (${r.label})  |  LLM：${c.llmScore}分  |  差：${diff}分`);
  console.log(`  fc=${r.breakdown.factCheckSignal} search=${r.breakdown.searchSignal} src=${r.breakdown.sourceSignal} rumor=${r.breakdown.rumorPenalty} miss=${r.breakdown.missingPenalty}`);
}
