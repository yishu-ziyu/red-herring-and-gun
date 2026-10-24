/**
 * reportReviewer.ts — deterministic report checker (non-LLM)
 *
 * Runs on the finished report: contract fields, evidence chain, boundary language.
 * It only reports problems. The verdict and every public text field are decided by
 * sentenceVerdict and are never edited here.
 */

import { VERDICT_OUTCOME } from "../../../shared/domain/verdict.js";
import { findFuzzyQuantifiers } from "./publicCopy.js";

export interface ReportReviewIssue {
  code: string;
  severity: "error" | "warn";
  message: string;
}

export interface ReportReviewResult {
  passed: boolean;
  score: number;
  issues: ReportReviewIssue[];
  checks: Record<string, boolean>;
}

const VERDICT_TYPES = new Set(Object.values(VERDICT_OUTCOME).map((outcome) => outcome.verdictType));

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasMinStrings(value: unknown, min: number): boolean {
  return asArray(value).filter((item) => typeof item === "string" && item.trim().length > 0).length >= min;
}

function sourceHasHttpUrl(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return /^https?:\/\//i.test(String((value as { url?: unknown }).url || "").trim());
}

function listSourceRecords(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of asArray(value)) {
    if (item && typeof item === "object") out.push(item as Record<string, unknown>);
  }
  return out;
}

/** 非 related-only 的可点开 URL 才算有据。 */
function reportHasBoundHttpUrl(report: Record<string, unknown>): boolean {
  for (const item of asArray(report.subclaimVerdicts)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.sourcesRelatedOnly === true) continue;
    if (listSourceRecords(rec.supportingSources).some(sourceHasHttpUrl)) return true;
    if (listSourceRecords(rec.contradictingSources).some(sourceHasHttpUrl)) return true;
  }
  return false;
}

export function reviewReport(report: Record<string, unknown>): ReportReviewResult {
  const issues: ReportReviewIssue[] = [];
  const checks: Record<string, boolean> = {};

  // Interrupted output is not a finished dossier.
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
      checks: { interrupted: true },
    };
  }

  const verdict = asString(report.verdictType);
  checks.hasVerdictType = VERDICT_TYPES.has(verdict);
  if (!checks.hasVerdictType) {
    issues.push({ code: "missing_verdict", severity: "error", message: "缺少合法 verdictType" });
  }

  checks.hasConclusion = asString(report.conclusion).length >= 8;
  if (!checks.hasConclusion) {
    issues.push({ code: "thin_conclusion", severity: "error", message: "结论过短或缺失" });
  }

  const chain = asArray(report.evidenceChain);
  checks.evidenceChainDepth = chain.length >= 3;
  if (!checks.evidenceChainDepth) {
    issues.push({
      code: "short_evidence_chain",
      severity: "error",
      message: `evidenceChain 仅 ${chain.length} 层，要求 ≥ 3`,
    });
  }

  checks.hasCanSay = hasMinStrings(report.canSay, 1);
  checks.hasCannotSay = hasMinStrings(report.cannotSay, 1);
  if (!checks.hasCanSay) {
    issues.push({ code: "missing_can_say", severity: "warn", message: "缺少 canSay" });
  }
  if (!checks.hasCannotSay) {
    issues.push({ code: "missing_cannot_say", severity: "warn", message: "缺少 cannotSay" });
  }

  const dimIds = new Set(
    asArray(report.confidenceDimensions)
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
    issues.push({ code: "incomplete_dimensions", severity: "warn", message: "confidenceDimensions 未覆盖五维" });
  }

  // 整句 true/false 必须有非 related-only 绑定 URL。
  const unsourcedHard = (verdict === "true" || verdict === "false") && !reportHasBoundHttpUrl(report);
  checks.noUnsourcedHardVerdict = !unsourcedHard;
  if (unsourcedHard) {
    issues.push({
      code: "unsourced_hard_verdict",
      severity: "error",
      message: "整句 true/false 没有非 related-only 绑定 URL",
    });
  }

  // summaryForPublic must not be more absolute than conclusion (coarse)
  const publicSummary = asString(report.summaryForPublic);
  const absoluteWords = ["铁定", "百分百", "绝对是", "毫无疑问是谣言", "完全真实"];
  checks.publicNotAbsolute = !absoluteWords.some((w) => publicSummary.includes(w));
  if (!checks.publicNotAbsolute) {
    issues.push({ code: "absolute_public_summary", severity: "warn", message: "公众摘要用了过绝对措辞" });
  }

  // 有绑定来源时，结论必须带 [n] — 判断有出处，不留无主断言句
  const conclusionText = asString(report.conclusion);
  checks.conclusionCited = !reportHasBoundHttpUrl(report) || /\[\d+\]/.test(conclusionText);
  if (!checks.conclusionCited) {
    issues.push({ code: "uncited_conclusion", severity: "warn", message: "存在绑定来源但结论未带 [n] 引用" });
  }

  // 模糊量词 — 来源里的具体数字不得改写成「很多 / 大量」等
  const fuzzyHits = Array.from(
    new Set([...findFuzzyQuantifiers(conclusionText), ...findFuzzyQuantifiers(publicSummary)])
  );
  checks.noFuzzyQuantifiers = fuzzyHits.length === 0;
  if (!checks.noFuzzyQuantifiers) {
    issues.push({
      code: "fuzzy_quantifier",
      severity: "warn",
      message: `结论用了模糊量词「${fuzzyHits.join("、")}」，应保留来源中的具体数字`,
    });
  }

  if (asArray(report.closureActions).length === 0) {
    issues.push({ code: "missing_closure", severity: "warn", message: "缺少 closureActions" });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.length - errorCount;
  return {
    passed: errorCount === 0,
    score: Math.max(0, Math.min(100, 100 - errorCount * 25 - warnCount * 8)),
    issues,
    checks,
  };
}
