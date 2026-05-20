import type { DemoCase, FinalReport, GradedEvidence, Subclaim, SubclaimReportStatus } from "./schemas";

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

  return {
    originalClaim: caseData.originalClaim,
    overallStatus: "原句过强",
    allowedConclusion:
      "生成式 AI 可能正在影响初级内容岗位的任务结构，也可能与部分岗位需求变化有关；但当前证据不足以确认它导致初级内容岗位减少。",
    claimDiagnosis: caseData.diagnosis,
    subclaimStatuses,
    evidenceChain: [
      `数量层面：${mainEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "尚缺少可作为主证据的岗位数据"}。`,
      `机制层面：${auxiliaryEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "尚缺少机制材料"}。`,
      `反证层面：${counterEvidence.map((grade) => candidateTitle(caseData, grade.candidateId)).join("；") || "仍需主动查找反证"}。`,
      "因果层面：当前材料仍缺少替代解释处理和反事实证据，因此不能使用“导致”作为最终结论。",
    ],
    doNotInfer: [
      "不能从任务暴露度推出岗位已经减少。",
      "不能从个别企业案例推出行业总体变化。",
      "不能从同期变化推出 AI 导致岗位减少。",
      "不能从初级内容岗位受影响推出文科生整体竞争力下降。",
      "不能把任务被重组直接写成岗位消失。",
    ],
    rewrittenClaim: {
      cautious:
        "生成式 AI 可能正在改变初级内容岗位的任务结构，但现有材料不足以确认其导致岗位减少。",
      publicFacing:
        "AI 可能正在改变内容岗位的工作方式，但“AI 让这些岗位减少”这个说法还需要更多证据。",
      researchMemo:
        "在缺少同一统计定义下的岗位数据、AI 采用时间证据和替代解释检验前，应将 AI 视为潜在影响因素，而非已确认原因。",
    },
    nextEvidenceNeeded: [
      "同一统计定义下的初级内容岗位招聘时间序列。",
      "企业或行业采用生成式 AI 的时间和范围。",
      "宏观经济、广告市场收缩、平台变化、企业降本等替代解释。",
      "内容岗位任务结构变化的机制证据。",
      "反向证据：AI 是否创造新岗位或提高相关岗位需求。",
    ],
  };
}
