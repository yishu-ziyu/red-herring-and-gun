/**
 * deterministicReport.ts — 由核查进行态确定性地写出报告骨架（不调用写作模型）：证据链、置信维度、
 * 补证动作、难查原因。整句的 verdictType、结论、徽章不在这里写，由 sentenceVerdict 决定。
 */

import { assembleFinalReport } from "./assembleFinalReport.js";
import { searchResultOf } from "./atomSearch.js";
import type { CaseState } from "./casePipeline/caseState.js";
import { applyFactDeskPostProcessToReport } from "./factDeskPostProcess.js";
import { decideAndWriteVerdict } from "./sentenceVerdict.js";
import { stringItems } from "./valueCoerce.js";

type SkeletonInput = Partial<Pick<CaseState, "rumorStep" | "factStep" | "sourceStep" | "atomSearchBundle">>;

export function buildReportSkeleton(claim: string, state: SkeletonInput): Record<string, unknown> {
  const { rumorStep, factStep, sourceStep } = state;
  const searchResult = state.atomSearchBundle ? searchResultOf(state.atomSearchBundle) : undefined;
  const sourceReliability = String(sourceStep?.output?.sourceReliability || "unverified");
  const keyFindings = stringItems(factStep?.output?.keyFindings);
  const counterEvidence = stringItems(factStep?.output?.counterEvidence);
  const verifiedSources = stringItems(sourceStep?.output?.verifiedSources);
  const questionableSources = stringItems(sourceStep?.output?.questionableSources);
  const missingSources = stringItems(sourceStep?.output?.missingSources);
  const searchSources = Array.isArray(searchResult?.sources) ? searchResult.sources.slice(0, 5) : [];
  const searchGaps = stringItems(searchResult?.unresolvedEvidenceGaps);
  const hasCounterEvidence = counterEvidence.length > 0 || stringItems(searchResult?.contradictingEvidence).length > 0;
  const hasMissingSources = missingSources.length > 0 || searchGaps.length > 0;
  const firstFinding = keyFindings[0] || String(searchResult?.answer || "").slice(0, 160) || "当前证据不足以直接确认原始说法。";
  const missingText = [...missingSources, ...searchGaps].slice(0, 2).join("；") || "仍需要更权威或原始来源复核。";

  const report: Record<string, unknown> = {
    whyHardToVerify: [
      missingText,
      "搜索结果和 Agent 输出只能作为核查线索，不能替代原始材料或权威发布。",
    ],
    evidenceChain: [
      {
        layer: "原始命题",
        finding: claim.slice(0, 220),
        evidence: stringItems(rumorStep?.output?.rumorIndicators).slice(0, 3).join("；") || "未检测到足够明确的结构化谣言特征。",
        boundary: "这一步只识别表达风险，不直接判定真假。",
        sourceRefs: ["RumorDetector"],
      },
      {
        layer: "事实核查",
        finding: firstFinding,
        evidence: keyFindings.slice(0, 3).join("；") || "FactChecker 未返回足够关键发现。",
        boundary: "事实核查结果需要结合来源可靠性一起解释。",
        sourceRefs: ["FactChecker"],
      },
      {
        layer: "信源审计",
        finding: verifiedSources[0] || questionableSources[0] || missingText,
        evidence: [...verifiedSources, ...questionableSources].slice(0, 3).join("；") || "缺少可直接采信的信源列表。",
        boundary: "有来源线索不等于来源已被确认为权威。",
        sourceRefs: ["SourceValidator"],
      },
      {
        layer: "搜索来源",
        finding: searchSources[0]?.title || "搜索服务返回的来源有限。",
        evidence: searchSources.map((source: any, index: number) => `${index + 1}. ${source?.title || source?.url || "未命名来源"}`).join("；"),
        boundary: "搜索摘要只能提供交叉验证线索，不能单独推出最终事实。",
        sourceRefs: searchSources.map((source: any) => String(source?.url || source?.title || "")).filter(Boolean),
      },
      {
        layer: "结论边界",
        finding: missingText,
        evidence: [...counterEvidence, ...searchGaps].slice(0, 3).join("；") || missingText,
        boundary: "结论只写到分条判断撑得住的程度。",
        sourceRefs: [],
      },
    ],
    // 不写每次都一样的通用免责话；每一截自己的「不能推出」在 subclaimVerdicts.boundary 里。
    causalBoundary: "",
    closureActions: [
      {
        type: "archive_doubt",
        label: "保存证据边界",
        content: missingText,
        status: "ready",
      },
      {
        type: "follow_up",
        label: "补查原始来源",
        content: "优先寻找官方发布、原始研究、专业机构说明或当事方一手材料。",
        status: hasMissingSources ? "needs_review" : "ready",
      },
      {
        type: "share_public",
        label: "能信的部分",
        content: "只说证据已经撑住的部分，查不清的不要说成已经核实。",
        status: "needs_review",
      },
    ],
    confidenceDimensions: [
      buildConfidenceDimension("source_reliability", "来源可靠性", sourceReliability === "high" ? 78 : sourceReliability === "medium" ? 62 : 42, 70, sourceReliability === "high", sourceReliability),
      buildConfidenceDimension("evidence_completeness", "证据完整度", hasMissingSources ? 45 : 66, 60, !hasMissingSources, missingText),
      buildConfidenceDimension("consistency", "逻辑一致性", hasCounterEvidence ? 55 : 72, 75, !hasCounterEvidence, hasCounterEvidence ? "存在反证或冲突线索" : "未发现明显冲突"),
      buildConfidenceDimension("recency", "信息时效性", searchSources.length > 0 ? 58 : 35, 50, searchSources.length > 0, "以当前搜索返回为准"),
      buildConfidenceDimension("authority", "权威匹配度", verifiedSources.length > 0 ? 62 : 38, 65, verifiedSources.length > 0, verifiedSources[0] || "缺少明确权威来源"),
    ],
  };

  // 可说 / 不可说 / 难查原因要诚实且不空。
  applyFactDeskPostProcessToReport(report);
  return report;
}

/** 整体核查超时兜底：没有任何判词，按未完成收尾。只在宽限期也过了、管线确定回不来时用。 */
export function buildInterruptedReport(claim: string): Record<string, unknown> {
  const report = buildReportSkeleton(claim, {});
  assembleFinalReport({ finalReport: report, rumorStep: undefined, verdicts: [] });
  decideAndWriteVerdict(report, { claim, claimAtoms: [], claimAtomTypes: [], incomplete: [] });
  return report;
}

function buildConfidenceDimension(
  dimension: string,
  label: string,
  score: number,
  threshold: number,
  passed: boolean,
  reason: string
) {
  return { dimension, label, score, threshold, passed, reason };
}
