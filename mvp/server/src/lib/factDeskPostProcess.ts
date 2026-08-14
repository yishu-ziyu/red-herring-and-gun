/**
 * factDeskPostProcess.ts — Prompt A+F post-process for live handoff JSON
 *
 * Runs after ReportComposer (LLM or deterministic fallback) returns finalReport.
 * Goals:
 * 1. Strip drama / AI self-talk / infrastructure leaks from public prose
 * 2. Keep canSay / cannotSay honest and non-empty
 * 3. Ensure conclusion has claim framing + uncertainty when evidence is thin
 * 4. Never invent sources or facts not already in the report
 *
 * Keep public copy plain and sourced.
 */

import {
  sanitizePublicReportArray,
  sanitizePublicReportText,
  PUBLIC_REPORT_FALLBACK_REASON,
} from "./reportSanitizer.js";
import { faceVerdictFor } from "./reportAssembly/index.js";

const BANNED_DRAMA =
  /纯属捏造|纯属子虚乌有|令人啼笑皆非|令人啼笑|可笑至极|震惊全网|铁证如山|毋庸置疑|智慧的网友|作为AI|作为人工智能|速来围观|当帮凶|广大网友务必/g;

const META_LABELS = /【可说】|【不可说】|（可说）|（不可说）/g;

export interface FactDeskPostProcessResult {
  report: Record<string, unknown>;
  notes: string[];
  changed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function unique(items: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function stripDrama(text: string, notes: string[], label: string): string {
  if (!text) return text;
  BANNED_DRAMA.lastIndex = 0;
  if (!BANNED_DRAMA.test(text) && !META_LABELS.test(text)) return text;
  notes.push(`${label}: stripped drama/meta labels`);
  BANNED_DRAMA.lastIndex = 0;
  return text
    .replace(BANNED_DRAMA, "")
    .replace(META_LABELS, "")
    .replace(/纯属[^。]{0,12}/g, "现有证据不支持")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFaceVerdict(text: string): boolean {
  return /能信|不能信|只能信一部分|还查不清/.test(text);
}

function hasUncertainty(text: string): boolean {
  return /不足|无法|未见|不能支持|尚未|缺口|不能|有限|待核|未证实|不宜|不能信|还查不清/.test(text);
}

function ensureFaceLead(text: string, verdictType: unknown, notes: string[], label: string): string {
  if (
    verdictType !== "true" &&
    verdictType !== "false" &&
    verdictType !== "mixed_misleading" &&
    verdictType !== "unverified"
  ) {
    return text;
  }
  const face = faceVerdictFor(verdictType);
  if (!text) return `${face}。`;
  if (hasFaceVerdict(text)) return text;
  notes.push(`${label}: prepended face verdict`);
  return `${face}。${text}`;
}

function hasClaimFraming(text: string, claim: string): boolean {
  if (/流传说法|原表述|网传|原说法|该说法|这条说法/.test(text)) return true;
  if (claim && claim.length >= 6 && text.includes(claim.slice(0, 6))) return true;
  return false;
}

function ensureClaimAndUncertainty(
  conclusion: string,
  claim: string,
  notes: string[],
  verdictType?: unknown,
): string {
  let out = conclusion.trim();
  if (!out) {
    notes.push("conclusion: empty → conservative default");
    return claim
      ? `还查不清。流传说法是：「${claim.slice(0, 42)}」。现有证据仍不足以确认。`
      : "还查不清。现有证据仍不足以确认该说法。";
  }

  if (claim && !hasClaimFraming(out, claim)) {
    notes.push("conclusion: prepended claim framing");
    out = `流传说法是：「${claim.slice(0, 42)}」。${out}`;
  }

  const decisive = verdictType === "true" || verdictType === "false";
  if (!decisive && !hasFaceVerdict(out) && !hasUncertainty(out)) {
    notes.push("conclusion: injected uncertainty boundary");
    out = `${out.replace(/[。．.]+$/g, "")}。现有证据仍不足以按原强度确认。`;
  }

  return out;
}

function softCausalWithoutEvidence(text: string, notes: string[], label: string): string {
  // Only soften hard drama-causals when text has no hedging at all
  if (hasUncertainty(text)) return text;
  if (!/导致|已经证明|等于毒药|必定/.test(text)) return text;
  notes.push(`${label}: softened causal leap without uncertainty`);
  return text
    .replace(/导致/g, "关联到")
    .replace(/已经证明/g, "尚不足以证明")
    .replace(/等于毒药/g, "被类比为「毒药」（修辞过强）");
}

/**
 * Post-process live handoff finalReport (Prompt A structure + Prompt F critique).
 * Idempotent-ish: safe to run twice; second pass usually no-ops.
 */
export function postProcessHandoffFinalReport(
  finalReport: unknown,
  claim: string,
): FactDeskPostProcessResult | null {
  const report = asRecord(finalReport);
  if (!report) return null;

  const notes: string[] = [];
  const originalSnapshot = JSON.stringify(report);

  // 1) Infrastructure sanitizer on public prose fields
  const textFields = [
    "conclusion",
    "summaryForPublic",
    "recommendation",
    "causalBoundary",
  ] as const;

  for (const key of textFields) {
    const raw = asString(report[key]);
    if (!raw) continue;
    const sanitized = sanitizePublicReportText(raw, PUBLIC_REPORT_FALLBACK_REASON);
    if (sanitized !== raw) notes.push(`${key}: infra sanitized`);
    report[key] = sanitized;
  }

  for (const key of ["whyHardToVerify", "canSay", "cannotSay"] as const) {
    const arr = asStringArray(report[key]);
    if (arr.length === 0) continue;
    const sanitized = sanitizePublicReportArray(arr, PUBLIC_REPORT_FALLBACK_REASON);
    if (JSON.stringify(sanitized) !== JSON.stringify(arr)) notes.push(`${key}: infra array sanitized`);
    report[key] = sanitized;
  }

  // Internal-ish but still may leak to clients in handoff payload
  if (typeof report._fallbackReason === "string") {
    const raw = report._fallbackReason;
    const cleaned = sanitizePublicReportText(raw, PUBLIC_REPORT_FALLBACK_REASON);
    if (cleaned !== raw) notes.push("_fallbackReason: infra sanitized");
    report._fallbackReason = cleaned;
  }

  // 2) Prompt F: strip drama / meta labels
  let conclusion = stripDrama(asString(report.conclusion), notes, "conclusion");
  let summaryForPublic = stripDrama(asString(report.summaryForPublic), notes, "summaryForPublic");
  let recommendation = stripDrama(asString(report.recommendation), notes, "recommendation");

  conclusion = softCausalWithoutEvidence(conclusion, notes, "conclusion");
  summaryForPublic = softCausalWithoutEvidence(summaryForPublic, notes, "summaryForPublic");

  // 3) Prompt A structure: claim framing + uncertainty when missing
  const safeClaim = (claim || asString(report.originalClaim) || "").trim();
  const verdictType = report.verdictType;
  conclusion = ensureClaimAndUncertainty(conclusion, safeClaim, notes, verdictType);
  conclusion = ensureFaceLead(conclusion, verdictType, notes, "conclusion");

  if (!summaryForPublic) {
    summaryForPublic = conclusion.length > 120 ? `${conclusion.slice(0, 100)}…` : conclusion;
    notes.push("summaryForPublic: filled from conclusion");
  } else if (verdictType !== "true" && verdictType !== "false" && !hasUncertainty(summaryForPublic) && !hasFaceVerdict(summaryForPublic)) {
    summaryForPublic = `${summaryForPublic.replace(/[。．.]+$/g, "")}。现有证据仍不足以按原强度确认。`;
    notes.push("summaryForPublic: injected uncertainty");
  }
  summaryForPublic = ensureFaceLead(summaryForPublic, verdictType, notes, "summaryForPublic");
  report.faceVerdict = faceVerdictFor(verdictType);

  if (!recommendation) {
    recommendation = "先看来源再判断能不能信，并保留证据边界。";
    notes.push("recommendation: default action without lecture");
  } else if (/广大网友|当帮凶|速来/.test(recommendation)) {
    recommendation = "先看来源再判断能不能信，并保留证据边界。";
    notes.push("recommendation: replaced lecture tone");
  }

  // 4) Boundaries: keep honest, non-empty cannotSay
  let canSay = unique(asStringArray(report.canSay), 8).map((s) =>
    stripDrama(s, notes, "canSay"),
  );
  let cannotSay = unique(asStringArray(report.cannotSay), 10).map((s) =>
    stripDrama(s, notes, "cannotSay"),
  );

  // Drop canSay items that duplicate cannotSay
  const cannotSet = new Set(cannotSay.map((s) => s.replace(/\s+/g, "")));
  canSay = canSay.filter((s) => !cannotSet.has(s.replace(/\s+/g, "")));

  if (cannotSay.length === 0) {
    cannotSay = ["不能在证据不足时把原说法写成已证实事实。"];
    notes.push("cannotSay: filled default boundary");
  }

  if (canSay.length === 0) {
    canSay = ["仅能复述已核对到的公开材料，不能扩展原说法强度。"];
    notes.push("canSay: filled default cautious allow");
  }

  // 5) whyHardToVerify: strip drama, keep 2–4
  let whyHard = unique(asStringArray(report.whyHardToVerify), 4).map((s) =>
    stripDrama(s, notes, "whyHardToVerify"),
  );
  if (whyHard.length === 0) {
    whyHard = ["原说法可能压缩了多个可核查判断", "公开材料与原强度之间仍有缺口"];
    notes.push("whyHardToVerify: filled defaults");
  }

  report.conclusion = conclusion;
  report.summaryForPublic = summaryForPublic;
  report.recommendation = recommendation;
  report.canSay = canSay;
  report.cannotSay = cannotSay;
  report.whyHardToVerify = whyHard;
  report._factDeskPostProcess = {
    applied: true,
    notes,
    version: "A+F-2026-07-10",
  };

  const changed = JSON.stringify(report) !== originalSnapshot || notes.length > 0;
  return { report, notes, changed };
}

/** Mutate finalReport in place (handlers convenience). */
export function applyFactDeskPostProcessToReport(
  finalReport: any,
  claim: string,
): string[] {
  const result = postProcessHandoffFinalReport(finalReport, claim);
  if (!result) return [];
  if (finalReport && typeof finalReport === "object") {
    Object.assign(finalReport, result.report);
  }
  return result.notes;
}
