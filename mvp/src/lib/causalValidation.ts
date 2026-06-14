import type { CandidateMaterial, GradedEvidence, LogicLinkAudit, Subclaim } from "./schemas";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function includesCausalClaim(text: string) {
  return /导致|造成|引发|使得|因为|由于|所以|相关|因果/.test(text);
}

function hasSubstantiveMechanism(candidate: CandidateMaterial) {
  return candidate.summary.trim().length >= 18 && candidate.matchedNeed.trim().length >= 8;
}

export function validateEvidenceInference(candidate: CandidateMaterial, subclaim: Subclaim): LogicLinkAudit {
  const penalties: string[] = [];
  const blockedInference: string[] = [];
  let score = 100;

  if (subclaim.type === "因果" || includesCausalClaim(subclaim.text)) {
    if (!hasSubstantiveMechanism(candidate)) {
      score -= 28;
      penalties.push("因果机制描述不足");
      blockedInference.push("不能把相关材料直接写成因果结论");
    }

    if (candidate.sourceType === "评论文章" || candidate.sourceType === "企业案例") {
      score -= 24;
      penalties.push("材料类型不足以单独支持因果判断");
      blockedInference.push("不能从评论或个案推出总体因果关系");
    }

    if (!candidate.matchedNeed.includes("时间") && !candidate.matchedNeed.includes("反事实")) {
      score -= 18;
      penalties.push("缺少时间顺序或反事实证据");
      blockedInference.push("不能排除替代解释前使用“导致”表述");
    }
  }

  if (candidate.traceability === "低") {
    score -= 20;
    penalties.push("来源可追溯性低");
    blockedInference.push("不能把不可追溯来源作为主证据");
  }

  if (candidate.independence === "低") {
    score -= 14;
    penalties.push("来源独立性不足");
    blockedInference.push("不能把同源转述视为交叉验证");
  }

  return {
    passed: penalties.length === 0 || score >= 62,
    adjustedScore: clampScore(score),
    penalties,
    blockedInference,
  };
}

export function applyLogicAuditToGrade(grade: GradedEvidence, audit: LogicLinkAudit): GradedEvidence {
  const blocked = Array.from(new Set([...grade.inferenceBlocked, ...audit.blockedInference]));
  return {
    ...grade,
    logicAudit: audit,
    inferenceBlocked: blocked,
    graderDecision: audit.passed ? grade.graderDecision : "usable_with_strict_limits",
  };
}
