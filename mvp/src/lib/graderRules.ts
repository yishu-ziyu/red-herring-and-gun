import type { CandidateMaterial, EvidenceRole, GradedEvidence, ScoreLevel, Subclaim, UsageLevel } from "./schemas";
import { auditGradeBiases } from "./biasAudit";
import { applyLogicAuditToGrade, validateEvidenceInference } from "./causalValidation";
import { assessCandidateEvidenceQuality } from "./evidenceQuality";

function scoreRelevance(candidate: CandidateMaterial, subclaim: Subclaim): ScoreLevel {
  if (!candidate.targetSubclaimIds.includes(subclaim.id)) return "低";
  if (candidate.matchedNeed.includes("时间序列") && subclaim.type === "数量事实") return "高";
  if (candidate.matchedNeed.includes("反证") && subclaim.type === "反证") return "高";
  if (candidate.matchedNeed.includes("职业暴露度") && subclaim.type === "机制/事实") return "高";
  if (subclaim.type === "因果") return candidate.sourceType === "评论文章" ? "低" : "中";
  return "中";
}

function scoreMethodFit(candidate: CandidateMaterial, subclaim: Subclaim): ScoreLevel {
  if (subclaim.type === "数量事实") return candidate.sourceType === "招聘数据" ? "高" : "低";
  if (subclaim.type === "机制/事实") {
    return candidate.sourceType === "学术论文" || candidate.sourceType === "企业案例" ? "中" : "低";
  }
  if (subclaim.type === "因果") {
    if (candidate.sourceType === "评论文章" || candidate.sourceType === "企业案例") return "低";
    if (candidate.sourceType === "招聘数据" || candidate.sourceType === "学术论文") return "中";
  }
  if (subclaim.type === "反证") return candidate.matchedNeed.includes("反证") ? "高" : "低";
  return "中";
}

function roleFor(candidate: CandidateMaterial, subclaim: Subclaim, relevance: ScoreLevel, methodFit: ScoreLevel): EvidenceRole {
  if (relevance === "低" || methodFit === "低") {
    return candidate.sourceType === "评论文章" ? "背景" : "线索";
  }
  if (subclaim.type === "反证") return "反驳";
  if (subclaim.type === "因果") return "限定";
  return "支持";
}

function usageFor(candidate: CandidateMaterial, subclaim: Subclaim, role: EvidenceRole, methodFit: ScoreLevel): UsageLevel {
  if (candidate.sourceType === "评论文章") return "背景材料";
  if (role === "反驳") return "反证";
  if (role === "背景") return "背景材料";
  if (role === "线索") return "仅作线索";
  if (subclaim.type === "数量事实" && methodFit === "高") return "主证据";
  if (subclaim.type === "因果") return "辅助证据";
  return "辅助证据";
}

function allowed(candidate: CandidateMaterial, subclaim: Subclaim): string[] {
  if (subclaim.type === "数量事实" && candidate.sourceType === "招聘数据") {
    return ["可以支持某一数据口径下初级内容岗位招聘需求下降"];
  }
  if (subclaim.type === "机制/事实" && candidate.sourceType === "学术论文") {
    return ["可以说明写作和内容类任务可能受到生成式 AI 影响", "可以作为任务替代机制的背景"];
  }
  if (subclaim.type === "机制/事实" && candidate.sourceType === "企业案例") {
    return ["可以说明存在个别企业用 AI 改变内容生产流程的案例"];
  }
  if (subclaim.type === "反证") {
    return ["可以提醒报告纳入 AI 创造新岗位或技能需求变化的可能性"];
  }
  if (subclaim.type === "因果") {
    return ["可以作为讨论因果链的部分材料", "最多支持 AI 可能是影响因素之一"];
  }
  return ["可以作为相关背景材料"];
}

function blocked(candidate: CandidateMaterial, subclaim: Subclaim): string[] {
  const base = ["不能外推到所有文科岗位", "不能替代对使用场景和讨论范围的限定"];

  if (subclaim.type === "因果") {
    return [
      "不能单独推出 AI 导致岗位减少",
      "不能排除宏观经济、行业周期、平台变化、企业降本等替代解释",
      ...base,
    ];
  }

  if (subclaim.type === "数量事实") {
    return ["不能推出岗位变化由 AI 导致", "不能代表所有地区、平台和岗位分类", ...base];
  }

  if (subclaim.type === "机制/事实") {
    return ["不能从任务暴露度推出岗位已经减少", "不能把任务替代直接写成岗位消失", ...base];
  }

  if (subclaim.type === "反证") {
    return ["不能证明 AI 没有替代效应", "不能证明新增岗位规模足以抵消减少岗位", ...base];
  }

  return base;
}

export function gradeCandidate(candidate: CandidateMaterial, subclaim: Subclaim): GradedEvidence {
  const relevance = scoreRelevance(candidate, subclaim);
  const methodFit = scoreMethodFit(candidate, subclaim);
  const evidenceRole = roleFor(candidate, subclaim, relevance, methodFit);
  const usageLevel = usageFor(candidate, subclaim, evidenceRole, methodFit);
  const sourceQuality = assessCandidateEvidenceQuality(candidate);

  const baseGrade: GradedEvidence = {
    candidateId: candidate.id,
    subclaimId: subclaim.id,
    matchedEvidenceNeed: candidate.matchedNeed,
    evidenceRole,
    usageLevel,
    scores: {
      relevance,
      traceability: candidate.traceability,
      methodFit,
      contextFit: candidate.contextFit,
      independence: candidate.independence,
    },
    inferenceAllowed: allowed(candidate, subclaim),
    inferenceBlocked: blocked(candidate, subclaim),
    limitations: candidate.limitations,
    evidenceGap:
      subclaim.type === "因果"
        ? ["仍需处理替代解释", "仍需 AI 采用时间与岗位变化时间的对应证据", "仍需反事实或过程证据"]
        : candidate.limitations,
    graderDecision:
      usageLevel === "主证据"
        ? "usable_as_main_evidence_for_subpart"
        : usageLevel === "不可用"
          ? "excluded"
          : "usable_with_limits",
    sourceQuality,
  };

  const logicAudit = validateEvidenceInference(candidate, subclaim);
  const auditedGrade = applyLogicAuditToGrade(baseGrade, logicAudit);

  return {
    ...auditedGrade,
    biasFindings: auditGradeBiases(auditedGrade, subclaim),
  };
}

export function gradeAll(candidates: CandidateMaterial[], subclaims: Subclaim[]): GradedEvidence[] {
  return candidates.flatMap((candidate) =>
    candidate.targetSubclaimIds
      .map((subclaimId) => subclaims.find((subclaim) => subclaim.id === subclaimId))
      .filter((subclaim): subclaim is Subclaim => Boolean(subclaim))
      .map((subclaim) => gradeCandidate(candidate, subclaim)),
  );
}
