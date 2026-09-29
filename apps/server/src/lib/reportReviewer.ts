/** Presentation checks after the formal judgment. This module never revises evidence or verdicts. */
import { applyPublicCopy, findFuzzyQuantifiers } from "./publicCopy.js";

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

const VERDICT_TYPES = new Set(["true", "false", "partial", "mixed_misleading", "disputed", "unverified"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

function hasDirectionalSource(report: Record<string, unknown>): boolean {
  for (const raw of Array.isArray(report.subclaimVerdicts) ? report.subclaimVerdicts : []) {
    if (!raw || typeof raw !== "object") continue;
    const verdict = raw as Record<string, unknown>;
    if (verdict.sourcesRelatedOnly === true) continue;
    for (const bucket of ["supportingSources", "contradictingSources"] as const) {
      for (const source of Array.isArray(verdict[bucket]) ? verdict[bucket] : []) {
        if (source && typeof source === "object" && /^https?:\/\//i.test(text((source as { url?: unknown }).url))) return true;
      }
    }
  }
  return false;
}

export function reviewAndRepairReport(report: Record<string, unknown>): ReportReviewResult {
  if (text(report._source) === "error-boundary") {
    return { passed: false, score: 0, issues: [{ code: "error_boundary", severity: "error", message: "收束未完成，保持中断态" }],
      repaired: { ...report }, checks: { interrupted: true } };
  }
  const repaired = { ...report };
  applyPublicCopy(repaired);
  const issues: ReportReviewIssue[] = [];
  const checks: Record<string, boolean> = {
    hasVerdictType: VERDICT_TYPES.has(text(repaired.verdictType)),
    hasConclusion: text(repaired.conclusion).length >= 8,
    noUnsourcedHardVerdict: !(["true", "false"].includes(text(repaired.verdictType)) && !hasDirectionalSource(repaired)),
    conclusionCited: !hasDirectionalSource(repaired) || /\[\d+\]/.test(text(repaired.conclusion)),
    scoreInRange: repaired.credibilityScore == null ||
      (typeof repaired.credibilityScore === "number" && Number.isFinite(repaired.credibilityScore) && repaired.credibilityScore >= 0 && repaired.credibilityScore <= 100),
    noFuzzyQuantifiers: findFuzzyQuantifiers(`${text(repaired.conclusion)} ${text(repaired.summaryForPublic)}`).length === 0,
  };
  const issue = (check: keyof typeof checks, code: string, severity: ReportReviewIssue["severity"], message: string) => {
    if (!checks[check]) issues.push({ code, severity, message });
  };
  issue("hasVerdictType", "missing_verdict", "error", "缺少合法判词");
  issue("hasConclusion", "thin_conclusion", "error", "结论过短或缺失");
  issue("noUnsourcedHardVerdict", "unsourced_hard_verdict", "error", "确定判断缺少已绑定来源");
  issue("conclusionCited", "uncited_conclusion", "warn", "结论缺少对应引用");
  issue("scoreInRange", "bad_score", "warn", "可信度分数不在有效范围");
  issue("noFuzzyQuantifiers", "fuzzy_quantifier", "warn", "结论使用了模糊量词");

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warnCount = issues.length - errorCount;
  const passed = errorCount === 0;
  repaired._review = { reviewer: "deterministic-report-reviewer", issueCount: issues.length, errorCount, passed };
  return { passed, score: Math.max(0, 100 - errorCount * 25 - warnCount * 8), issues, repaired, checks };
}
