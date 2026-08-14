/**
 * reportReviewer.ts — deterministic proposer-reviewer (server copy)
 *
 * ReportComposer is the proposer; this module is a non-LLM reviewer:
 * contract fields, evidence chain, boundary language, minimal repair.
 * Keep in sync with src/lib/agentRuntime/reportReviewer.ts (client/AgentRuntime).
 * Server cannot import client src (tsconfig rootDir); copy is intentional (ADR-004).
 */

export interface ReportReviewIssue {
  code: string;
  severity: "error" | "warn";
  message: string;
}

export interface ReportReviewResult {
  passed: boolean;
  score: number;
  issues: ReportReviewIssue[];
  repaired: Record<string, unknown>;
  checks: Record<string, boolean>;
}

const VERDICT_TYPES = new Set(["true", "false", "mixed_misleading", "unverified"]);

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasMinStrings(value: unknown, min: number): boolean {
  return asArray(value).filter((item) => typeof item === "string" && item.trim().length > 0).length >= min;
}

/**
 * Review and minimally repair report_composer output.
 * previousOutputs: prior step outputs for coarse fidelity checks.
 */
export function reviewAndRepairReport(
  report: Record<string, unknown>,
  opts?: {
    previousOutputs?: Record<string, unknown>[];
    claim?: string;
  }
): ReportReviewResult {
  const issues: ReportReviewIssue[] = [];
  const repaired: Record<string, unknown> = { ...report };
  const checks: Record<string, boolean> = {};

  // Interrupted composer output is not a finished dossier — do not pad it into one.
  if (asString(report._source) === "error-boundary") {
    return {
      passed: false,
      score: 0,
      issues: [
        {
          code: "error_boundary",
          severity: "error",
          message: "收束未完成，保持中断态，不补证据链",
        },
      ],
      repaired: { ...report, _source: "error-boundary" },
      checks: { interrupted: true },
    };
  }

  // 1) verdictType
  const verdict = asString(repaired.verdictType);
  checks.hasVerdictType = VERDICT_TYPES.has(verdict);
  if (!checks.hasVerdictType) {
    issues.push({
      code: "missing_verdict",
      severity: "error",
      message: "缺少合法 verdictType，已降级为 unverified",
    });
    repaired.verdictType = "unverified";
  }

  // 2) conclusion
  checks.hasConclusion = asString(repaired.conclusion).length >= 8;
  if (!checks.hasConclusion) {
    issues.push({
      code: "thin_conclusion",
      severity: "error",
      message: "结论过短或缺失",
    });
    if (!asString(repaired.conclusion)) {
      repaired.conclusion = "证据不足，暂无法给出可发布结论。";
    }
  }

  // 3) evidenceChain ≥ 3
  const chain = asArray(repaired.evidenceChain);
  checks.evidenceChainDepth = chain.length >= 3;
  if (!checks.evidenceChainDepth) {
    issues.push({
      code: "short_evidence_chain",
      severity: "error",
      message: `evidenceChain 仅 ${chain.length} 层，要求 ≥ 3`,
    });
    // Ensure a mutable array: asArray(undefined) returns a fresh [] each call.
    if (!Array.isArray(repaired.evidenceChain)) {
      repaired.evidenceChain = [];
    }
    const evidenceChain = repaired.evidenceChain as unknown[];
    while (evidenceChain.length < 3) {
      const i = evidenceChain.length;
      evidenceChain.push({
        layer: ["命题", "证据", "边界"][i] ?? `层${i + 1}`,
        finding: i === 0 ? asString(opts?.claim) || "待核查命题" : "审核器补全：前序输出未提供完整证据链",
        evidence: "（审稿补全，非新增外部事实）",
        boundary: "不得据此推出比材料更强的结论",
        sourceRefs: [],
      });
    }
  }

  // 4) canSay / cannotSay
  checks.hasCanSay = hasMinStrings(repaired.canSay, 1);
  checks.hasCannotSay = hasMinStrings(repaired.cannotSay, 1);
  if (!checks.hasCanSay) {
    issues.push({ code: "missing_can_say", severity: "warn", message: "缺少 canSay" });
    repaired.canSay = ["仅可陈述已列出的证据与边界，不得超出证据链。"];
  }
  if (!checks.hasCannotSay) {
    issues.push({ code: "missing_cannot_say", severity: "warn", message: "缺少 cannotSay" });
    repaired.cannotSay = ["不能把未验证材料当作已证实事实。"];
  }

  // 5) confidenceDimensions 五项
  const dims = asArray(repaired.confidenceDimensions);
  const dimIds = new Set(
    dims
      .map((d) => (d && typeof d === "object" ? (d as { dimension?: string }).dimension : undefined))
      .filter(Boolean)
  );
  const requiredDims = [
    "source_reliability",
    "evidence_completeness",
    "consistency",
    "recency",
    "authority",
  ];
  checks.hasAllDimensions = requiredDims.every((id) => dimIds.has(id));
  if (!checks.hasAllDimensions) {
    issues.push({
      code: "incomplete_dimensions",
      severity: "warn",
      message: "confidenceDimensions 未覆盖五维",
    });
  }

  // 6) credibilityScore 范围
  const score = repaired.credibilityScore;
  checks.scoreInRange =
    typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
  if (!checks.scoreInRange) {
    issues.push({
      code: "bad_score",
      severity: "error",
      message: "credibilityScore 非法，重置为 50",
    });
    repaired.credibilityScore = 50;
  }

  // 7) empty / conflicting prior factCheck vs hard true
  const prevText = JSON.stringify(opts?.previousOutputs ?? []).toLowerCase();
  const hardTrue =
    repaired.verdictType === "true" &&
    (prevText.includes('"factcheckresult":"unverified"') ||
      prevText.includes('"factcheckresult":"false"'));
  checks.noOverclaim = !hardTrue;
  if (hardTrue) {
    issues.push({
      code: "overclaim",
      severity: "error",
      message: "前序 factCheck 未支持 true，却给出 true；降级为 unverified",
    });
    repaired.verdictType = "unverified";
    if (typeof repaired.credibilityScore === "number") {
      repaired.credibilityScore = Math.min(repaired.credibilityScore as number, 45);
    }
  }

  // 8) summaryForPublic must not be more absolute than conclusion (coarse)
  const publicSummary = asString(repaired.summaryForPublic);
  const absoluteWords = ["铁定", "百分百", "绝对是", "毫无疑问是谣言", "完全真实"];
  checks.publicNotAbsolute = !absoluteWords.some((w) => publicSummary.includes(w));
  if (!checks.publicNotAbsolute) {
    issues.push({
      code: "absolute_public_summary",
      severity: "warn",
      message: "公众摘要用了过绝对措辞",
    });
  }

  if (!asString(repaired.summaryForPublic)) {
    repaired.summaryForPublic = asString(repaired.conclusion).slice(0, 120) || "核查结果待补充。";
  }

  if (!asString(repaired.recommendation)) {
    repaired.recommendation = "请结合证据链与 canSay/cannotSay 边界再传播。";
  }

  if (!Array.isArray(repaired.closureActions) || asArray(repaired.closureActions).length === 0) {
    repaired.closureActions = [
      {
        type: "archive_doubt",
        label: "存疑归档",
        content: "本案证据仍有缺口，建议归档待补证。",
        status: "ready",
      },
    ];
    issues.push({
      code: "missing_closure",
      severity: "warn",
      message: "缺少 closureActions，已补默认存疑归档",
    });
  }

  repaired._review = {
    reviewer: "deterministic-report-reviewer",
    issueCount: issues.length,
    errorCount: issues.filter((i) => i.severity === "error").length,
    passed: issues.filter((i) => i.severity === "error").length === 0,
  };

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  const scoreOut = Math.max(0, Math.min(100, 100 - errorCount * 25 - warnCount * 8));

  return {
    passed: errorCount === 0,
    score: scoreOut,
    issues,
    repaired,
    checks,
  };
}
