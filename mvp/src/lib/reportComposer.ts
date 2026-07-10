import type { DemoCase, FinalReport, GradedEvidence, Subclaim, SubclaimReportStatus } from "./schemas";
import { summarizeBiasFindings } from "./biasAudit";
import { summarizeEvidenceQuality } from "./evidenceQuality";
import { aggregateInferences } from "./inferenceLicense";
import { buildAttentionGuidance } from "./attentionGuidance";
import { writeFactDeskFromCase } from "./factDeskWriter";

function candidateTitle(caseData: DemoCase, candidateId: string): string {
  return caseData.candidates.find((candidate) => candidate.id === candidateId)?.title ?? candidateId;
}

function statusFor(subclaim: Subclaim, grades: GradedEvidence[]): SubclaimReportStatus {
  const related = grades.filter((grade) => grade.subclaimId === subclaim.id);
  const usableEvidence = related
    .filter((grade) => grade.usageLevel === "主证据" || grade.usageLevel === "辅助证据" || grade.usageLevel === "反证")
    .map((grade) => `${grade.usageLevel}：${grade.matchedEvidenceNeed}`);

  const cannotInfer = Array.from(new Set(related.flatMap((grade) => grade.inferenceBlocked))).slice(0, 4);

  if (subclaim.type === "因果") {
    return {
      subclaimId: subclaim.id,
      subclaim: subclaim.text,
      status: "证据不足",
      usableEvidence,
      cannotInfer,
    };
  }

  if (subclaim.type === "数量事实") {
    return {
      subclaimId: subclaim.id,
      subclaim: subclaim.text,
      status: related.some((grade) => grade.usageLevel === "主证据") ? "限定支持" : "证据不足",
      usableEvidence,
      cannotInfer,
    };
  }

  if (subclaim.type === "机制/事实") {
    return {
      subclaimId: subclaim.id,
      subclaim: subclaim.text,
      status: "部分支持",
      usableEvidence,
      cannotInfer,
    };
  }

  if (subclaim.type === "反证") {
    return {
      subclaimId: subclaim.id,
      subclaim: subclaim.text,
      status: "部分支持",
      usableEvidence,
      cannotInfer,
    };
  }

  return {
    subclaimId: subclaim.id,
    subclaim: subclaim.text,
    status: "部分支持",
    usableEvidence,
    cannotInfer,
  };
}

export function composeReport(caseData: DemoCase, grades: GradedEvidence[]): FinalReport {
  const subclaimStatuses = caseData.subclaims.map((subclaim) => statusFor(subclaim, grades));
  const mainEvidence = grades.filter((grade) => grade.usageLevel === "主证据");
  const auxiliaryEvidence = grades.filter((grade) => grade.usageLevel === "辅助证据");
  const counterEvidence = grades.filter((grade) => grade.usageLevel === "反证");
  const evidenceQualitySummary = summarizeEvidenceQuality(grades);
  const logicRiskItems = summarizeBiasFindings(grades);
  const strictBlocks = Array.from(
    new Set(
      grades.flatMap((grade) => [
        ...grade.inferenceBlocked,
        ...(grade.logicAudit?.blockedInference ?? []),
      ])
    )
  ).slice(0, 8);

  const routeBlocks = caseData.routes
    .map((r) => r.minimumOutputRule)
    .filter(Boolean);

  const planBlocks = caseData.searchPlans.flatMap((s) => s.mustNotInfer ?? []);

  const aiJobBlocks = [
    "不能从任务暴露度推出岗位已经减少。",
    "不能从个别企业案例推出行业总体变化。",
    "不能从同期变化推出 AI 导致岗位减少。",
    "不能从初级内容岗位受影响推出文科生整体竞争力下降。",
    "不能把任务被重组直接写成岗位消失。",
  ];

  const claimLooksAiJobs =
    /AI|人工智能|内容岗位|初级内容|招聘/.test(caseData.originalClaim);

  const doNotInfer = uniqueStrings(
    [
      ...routeBlocks,
      ...planBlocks,
      ...(claimLooksAiJobs ? aiJobBlocks : []),
      ...strictBlocks,
    ],
    12,
  );

  const nextEvidenceNeeded = uniqueStrings(
    [
      ...caseData.routes.flatMap((r) => r.neededEvidence).slice(0, 6),
      ...caseData.searchPlans.flatMap((s) => s.evidenceGaps ?? []).slice(0, 4),
    ],
    6,
  );

  const fallbackNext =
    nextEvidenceNeeded.length > 0
      ? nextEvidenceNeeded
      : claimLooksAiJobs
        ? [
            "同一统计定义下的初级内容岗位招聘时间序列。",
            "企业或行业采用生成式 AI 的时间和范围。",
            "宏观经济、广告市场收缩、平台变化、企业降本等替代解释。",
          ]
        : ["可验证的原始文件或官方原文", "权威机构书面回应", "同口径独立复现证据"];

  const inferenceLicense = aggregateInferences(grades, caseData.subclaims);

  // Prompt A + F: fact-desk voice conclusion (case-native boundaries first)
  const desk = writeFactDeskFromCase(caseData, grades, inferenceLicense, {
    doNotInfer,
    nextEvidenceNeeded: fallbackNext,
  });

  const cautiousConclusion = desk.lede;
  const cannotSayMerged = uniqueStrings([...desk.cannotSay, ...doNotInfer], 12);
  const canSayMerged = uniqueStrings([...desk.canSay], 8);

  const attentionGuidance = buildAttentionGuidance({
    conclusion: cautiousConclusion,
    canSay: canSayMerged,
    cannotSay: cannotSayMerged,
    doNotInfer,
    nextEvidenceNeeded: fallbackNext,
    licenseAllowed: inferenceLicense.allowed.map((item) => item.text),
    licenseBlocked: inferenceLicense.blocked.map((item) => item.text),
    candidates: caseData.candidates,
  });

  return {
    originalClaim: caseData.originalClaim,
    overallStatus: "原句过强",
    allowedConclusion: cautiousConclusion,
    claimDiagnosis: caseData.diagnosis,
    subclaimStatuses,
    evidenceChain: [
      `数量层面：${mainEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "尚缺少可作为主证据的岗位数据"}。`,
      `机制层面：${auxiliaryEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "尚缺少机制材料"}。`,
      `反证层面：${counterEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "仍需主动查找反证"}。`,
      "因果层面：当前材料仍缺少替代解释处理和反事实证据，因此不能使用“导致”作为最终结论。",
      `证据质量：平均可信度 ${evidenceQualitySummary.averageCredibility}/100，来源多样性 ${evidenceQualitySummary.diversityScore}/100，反证 ${evidenceQualitySummary.contradictCount} 条。`,
      logicRiskItems.length > 0
        ? `逻辑风险：${logicRiskItems.map((item) => item.label).join("；")}。`
        : "逻辑风险：未发现高优先级偏差，但仍需保持证据边界。",
    ],
    doNotInfer: cannotSayMerged,
    rewrittenClaim: {
      cautious: cautiousConclusion,
      publicFacing: desk.publicFacing,
      researchMemo: desk.researchMemo,
    },
    nextEvidenceNeeded: desk.openQuestions.length > 0 ? desk.openQuestions : fallbackNext,
    evidenceQualitySummary,
    logicRiskItems,
    contradictionSummary:
      counterEvidence.length > 0
        ? `已纳入 ${counterEvidence.length} 条反证或限制性材料，最终结论需要保守表达。`
        : "当前证据链仍缺少反证检索结果，需要继续主动查找相反材料。",
    inferenceLicense,
    attentionGuidance,
  };
}

function uniqueStrings(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
