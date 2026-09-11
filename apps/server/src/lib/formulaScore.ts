/**
 * formulaScore.ts — 公式可信度评分（computeFormulaScore + 报告回写）
 */

import { computeCredibilityScore, labelForScore, type CredibilityScoreResult } from "./credibilityScore.js";

// ───────────────────────────────────────────────────────────────
// 审查 P3-1 + P2-1 修复：抽取 computeFormulaScore 共享 helper
// 两个 handler（orchestrate / orchestrateStream）原本各自复制一份
// 公式覆盖块；同时把硬编码 direction:"support" 改为基于 search360Result
// 的 contradictingEvidence URL 交叉匹配做方向分类。
// 失败时返回 null，调用方回退到 LLM 分数。
// ───────────────────────────────────────────────────────────────
function normalizeSearchCredibility(src: any): "高" | "中" | "低" {
  const raw = src?.credibility;
  if (raw === "高" || raw === "中" || raw === "低") return raw;
  // credibilityScore 数字兜底：>=75 高，>=50 中，否则低
  const num = typeof src?.credibilityScore === "number" ? src.credibilityScore : undefined;
  if (typeof num === "number") return num >= 75 ? "高" : num >= 50 ? "中" : "低";
  return "低";
}

function classifySearchDirection(
  src: any,
  contradictUrls: Set<string>
): "support" | "contradict" | "neutral" {
  // 1. URL 命中 contradictingEvidence → contradict
  const srcUrl = typeof src?.url === "string" ? src.url : "";
  if (srcUrl && contradictUrls.has(srcUrl)) return "contradict";
  // 2. evidenceRole / direction 字段优先
  const role = src?.evidenceRole ?? src?.direction;
  if (role === "反驳" || role === "contradict") return "contradict";
  if (role === "支持" || role === "support") return "support";
  // 3. 标题/摘要文本启发式：含辟谣/不实等关键词 → contradict
  const text = `${src?.title ?? ""} ${src?.snippet ?? ""}`.toLowerCase();
  if (/(辟谣|不实|虚假|假的|误读|反驳|谣言|无法证实|未证实|不准确|夸大)/.test(text)) return "contradict";
  if (/(官方回应|证实|确认|证明|依据|来源|公告|通报)/.test(text)) return "support";
  return "neutral";
}

export function computeFormulaScore(
  rumorOut: any,
  factOut: any,
  sourceOut: any,
  search360Result: any
): CredibilityScoreResult | null {
  try {
    // 收集 contradictingEvidence 的 URL 集合用于交叉匹配方向
    const contradictList: any[] = Array.isArray(search360Result?.contradictingEvidence)
      ? search360Result.contradictingEvidence
      : [];
    const contradictUrls = new Set<string>(
      contradictList
        .map((item: any) => (typeof item?.url === "string" ? item.url : ""))
        .filter(Boolean)
    );

    const searchSources = (search360Result?.sources ?? []).slice(0, 8).map((src: any) => ({
      direction: classifySearchDirection(src, contradictUrls),
      credibility: normalizeSearchCredibility(src),
    }));

    return computeCredibilityScore(
      {
        severity: rumorOut?.severity ?? "medium",
        rumorIndicators: Array.isArray(rumorOut?.rumorIndicators) ? rumorOut.rumorIndicators : [],
        detectedPatterns: Array.isArray(rumorOut?.detectedPatterns) ? rumorOut.detectedPatterns : [],
      },
      {
        factCheckResult: factOut?.factCheckResult ?? "unverified",
        confidence: factOut?.confidence ?? "low",
        keyFindings: Array.isArray(factOut?.keyFindings) ? factOut.keyFindings : [],
        counterEvidence: Array.isArray(factOut?.counterEvidence) ? factOut.counterEvidence : [],
        sources: Array.isArray(factOut?.sources) ? factOut.sources : [],
      },
      {
        sourceReliability: sourceOut?.sourceReliability ?? "unverified",
        verifiedSources: Array.isArray(sourceOut?.verifiedSources) ? sourceOut.verifiedSources : [],
        questionableSources: Array.isArray(sourceOut?.questionableSources) ? sourceOut.questionableSources : [],
        missingSources: Array.isArray(sourceOut?.missingSources) ? sourceOut.missingSources : [],
        verificationNotes: typeof sourceOut?.verificationNotes === "string" ? sourceOut.verificationNotes : "",
      },
      {
        sources: searchSources,
        supportingEvidence: [],
        contradictingEvidence: contradictList.map((item: any) => typeof item?.title === "string" ? item.title : "").filter(Boolean),
        unresolvedEvidenceGaps: Array.isArray(search360Result?.unresolvedEvidenceGaps) ? search360Result.unresolvedEvidenceGaps : [],
      }
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[credibilityScore] 公式计算失败，回退到 LLM 分数: ${reason}`);
    return null;
  }
}

/**
 * 把公式结果写回 finalReport，并打上 _scoreSource=formula 标记。
 *
 * 产品一致性：最终展示的 verdictType 与 credibilityScore 不得互相矛盾。
 * 公式输入来自 fact_checker 等上游步骤；report_composer 可能给出更强的最终裁决。
 * 若最终裁决为 false，分数必须落在低可信带（≤15），避免「判假但 23 分」的展示分裂。
 */
export function applyFormulaScoreToReport(finalReport: any, formulaResult: CredibilityScoreResult | null): void {
  if (!formulaResult || !finalReport || typeof finalReport !== "object") return;
  let score = formulaResult.score;
  const displayedVerdict =
    typeof finalReport.verdictType === "string" ? finalReport.verdictType : formulaResult.verdict;
  if (displayedVerdict === "false" && score > 15) {
    finalReport._scoreUncapped = score;
    finalReport._scoreVerdictCap = 15;
    score = 15;
  }
  finalReport.credibilityScore = score;
  finalReport.credibilityLabel = labelForScore(score);
  finalReport._scoreSource = "formula";
  finalReport._scoreBreakdown = formulaResult.breakdown;
}
