/**
 * reportReviewer.ts — deterministic proposer-reviewer (server copy)
 *
 * ReportComposer is the proposer; this module is a non-LLM reviewer:
 * contract fields, evidence chain, boundary language, minimal repair.
 */

import { boundTinyRumorVerdict } from "./atomSearchQuery.js";
import { applyPublicCopy, directAnswer, findFuzzyQuantifiers } from "./publicCopy.js";

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

function collectReportSources(report: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of asArray(report.subclaimVerdicts)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    out.push(...listSourceRecords(rec.supportingSources), ...listSourceRecords(rec.contradictingSources));
  }
  out.push(...listSourceRecords(report.citationSources));
  return out;
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
        finding: i === 0 ? asString(opts?.claim) || "待核查命题" : "这一层还没有查到可点开的出处",
        evidence: "没有新的外部出处",
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

  // 7b) 整句 true/false 必须有非 related-only 绑定 URL；短谣 related-only 对题辟谣除外。
  const hardType = asString(repaired.verdictType);
  const keepBoundTinyFalse =
    hardType === "false" && boundTinyRumorVerdict(asString(opts?.claim), collectReportSources(repaired)) === "false";
  const unsourcedHard =
    (hardType === "true" || hardType === "false") && !reportHasBoundHttpUrl(repaired) && !keepBoundTinyFalse;
  checks.noUnsourcedHardVerdict = !unsourcedHard;
  if (unsourcedHard) {
    issues.push({
      code: "unsourced_hard_verdict",
      severity: "error",
      message: "整句 true/false 没有非 related-only 绑定 URL，已降为 unverified",
    });
    repaired.verdictType = "unverified";
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

  // 8b) 有绑定来源时，结论必须带 [n] — 判断有出处，不留无主断言句
  const conclusionText = asString(repaired.conclusion);
  const hasCitationMark = /\[\d+\]/.test(conclusionText);
  checks.conclusionCited = !reportHasBoundHttpUrl(repaired) || hasCitationMark;
  if (!checks.conclusionCited) {
    issues.push({
      code: "uncited_conclusion",
      severity: "warn",
      message: "存在绑定来源但结论未带 [n] 引用",
    });
  }

  // 8c) 模糊量词 — 来源里的具体数字不得改写成「很多 / 大量」等
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

  if (!asString(repaired.summaryForPublic)) {
    repaired.summaryForPublic = asString(repaired.conclusion).slice(0, 120) || "核查结果待补充。";
  }

  if (!asString(repaired.recommendation)) {
    repaired.recommendation = directAnswer(repaired.verdictType);
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

  applyPublicCopy(repaired);

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
