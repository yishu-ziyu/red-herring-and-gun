/**
 * Code-owned verdict gates for loop submit_verdict.
 * Reuses claimAtom / assemble / publicCopy / reviewer. The model cannot skip these.
 */

import {
  claimAtomKey,
  forceCheckableAtomTypes,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../claimAtom/index.js";
import { buildAtomSearchBundle, type AtomSearchItem } from "../atomSearch.js";
import { boundTinyRumorVerdict } from "../atomSearchQuery.js";
import { assembleFinalReport, deriveOverallVerdict, faceVerdictFor } from "../reportAssembly/index.js";
import { applyPublicCopy, looksLikeResearchMemo } from "../publicCopy.js";
import { reviewAndRepairReport } from "../reportReviewer.js";
import { applyFactDeskPostProcessToReport } from "../factDeskPostProcess.js";
import { computeCredibilityScore } from "../credibilityScore.js";
import type { AgentLoopResult } from "./types.js";

const VERDICT_TYPES = new Set(["true", "false", "mixed_misleading", "unverified"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVerdictType(value: unknown): "true" | "false" | "mixed_misleading" | "unverified" {
  const key = asString(value);
  if (key === "partial" || key === "mixed") return "mixed_misleading";
  if (VERDICT_TYPES.has(key)) return key as "true" | "false" | "mixed_misleading" | "unverified";
  return "unverified";
}

function urlsFromTrace(result: AgentLoopResult): Set<string> {
  const urls = new Set<string>();
  for (const row of result.toolTrace) {
    if (row.name !== "web_search" && row.name !== "web_fetch") continue;
    const rec = asRecord(row.result);
    if (typeof rec.url === "string" && /^https?:\/\//i.test(rec.url)) urls.add(rec.url.trim());
    if (Array.isArray(rec.sources)) {
      for (const src of rec.sources) {
        const url = asRecord(src).url;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) urls.add(url.trim());
      }
    }
  }
  return urls;
}

function unionSourcesFromTrace(result: AgentLoopResult): Array<{ url: string; title: string; snippet: string }> {
  const sources: Array<{ url: string; title: string; snippet: string }> = [];
  const seen = new Set<string>();
  for (const row of result.toolTrace) {
    if (row.name !== "web_search" && row.name !== "web_fetch") continue;
    const rec = asRecord(row.result);
    const list = Array.isArray(rec.sources) ? rec.sources : rec.url ? [rec] : [];
    for (const item of list) {
      const src = asRecord(item);
      const url = asString(src.url);
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      sources.push({
        url,
        title: asString(src.title) || url,
        snippet: asString(src.snippet) || asString(src.text).slice(0, 320),
      });
    }
  }
  return sources;
}

function searchItemsForAtoms(atoms: string[], sources: Array<{ url: string; title: string; snippet: string }>): AtomSearchItem[] {
  if (sources.length === 0) return [];
  return atoms.map((atom) => ({ atom, result: { sources } }));
}

function stripToolXml(text: string): string {
  return text.replace(/<tool_call>[\s\S]*$/g, "").trim();
}

function pickSubmittedMemo(draft: Record<string, unknown>, loop: AgentLoopResult): string {
  const fromArgs = asString(draft.conclusion);
  const fromText = stripToolXml(loop.lastText || "");
  if (looksLikeResearchMemo(fromArgs) && fromArgs.length >= (looksLikeResearchMemo(fromText) ? fromText.length : 0)) {
    return fromArgs;
  }
  if (looksLikeResearchMemo(fromText)) return fromText;
  return fromArgs;
}

function incompleteReport(claim: string, reason: string, urls: Set<string>): Record<string, unknown> {
  const sources = [...urls].slice(0, 5).map((url) => ({ url, title: url, snippet: "" }));
  const report: Record<string, unknown> = {
    verdictType: "unverified",
    conclusion: "这一轮没有收成判断。",
    recommendation: "这一轮没有收成判断。",
    keyFindings: reason ? [reason] : [],
    subclaimVerdicts: [
      {
        claimAtom: claim,
        verdict: "unverified",
        evidence: reason || "未完成核查",
        sourcesRelatedOnly: sources.length === 0,
      },
    ],
    citationSources: sources,
    _incomplete: true,
  };
  applyPublicCopy(report);
  report.faceVerdict = faceVerdictFor(report.verdictType);
  report._execution = "agent_loop";
  return report;
}

export async function finalizeLoopReport(input: {
  claim: string;
  loop: AgentLoopResult;
  callSelfProofModel?: SelfProofModelCall;
}): Promise<Record<string, unknown>> {
  const urls = urlsFromTrace(input.loop);
  if (input.loop.stopReason !== "submit_verdict" || !input.loop.terminalArgs) {
    const reason =
      input.loop.stopReason === "llm_error"
        ? "这一轮中途中断，判断没收完。"
        : input.loop.stopReason === "max_turns"
          ? "这一轮轮次用尽，判断没收完。"
          : "这一轮没有把判断写完。";
    return incompleteReport(input.claim, reason, urls);
  }

  const draft = { ...input.loop.terminalArgs };
  const submittedMemo = pickSubmittedMemo(draft, input.loop);
  const submittedTypes = forceCheckableAtomTypes(draft.claimAtomTypes);
  let atoms = Array.isArray(draft.claimAtoms)
    ? draft.claimAtoms.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (atoms.length === 0 && Array.isArray(submittedTypes)) {
    atoms = submittedTypes
      .map((item) => (item && typeof item === "object" ? asString((item as { text?: unknown }).text) : ""))
      .filter(Boolean);
  }
  if (atoms.length === 0) atoms = [input.claim];

  let kept = atoms.map((a) => claimAtomKey(a)).filter(Boolean);
  if (input.callSelfProofModel) {
    const proof = await runClaimAtomSelfProof(input.claim, kept, input.callSelfProofModel);
    if (proof.kept.length > 0) kept = proof.kept;
  }

  const rumorStep = {
    output: {
      claimAtoms: kept,
      claimAtomTypes: submittedTypes,
    },
  };

  const verdicts = Array.isArray(draft.subclaimVerdicts) ? draft.subclaimVerdicts : [];
  const unionSources = unionSourcesFromTrace(input.loop);
  const searchItems = searchItemsForAtoms(kept, unionSources);
  const atomSearchBundle = searchItems.length > 0 ? buildAtomSearchBundle(searchItems, claimAtomKey) : null;
  const searchSources = unionSources.length > 0 ? unionSources : [...urls].map((url) => ({ url }));

  const finalReport: Record<string, unknown> = {
    verdictType: normalizeVerdictType(draft.verdictType),
    conclusion: asString(draft.conclusion) || "公开材料还撑不住判断。",
    recommendation: asString(draft.recommendation),
    keyFindings: Array.isArray(draft.keyFindings) ? draft.keyFindings : [],
    subclaimVerdicts: verdicts,
    citationSources: searchSources,
  };

  assembleFinalReport({
    finalReport,
    rumorStep,
    verdicts,
    searchSources,
    atomSearchBundle,
  });

  const atomVerdicts = Array.isArray(finalReport.subclaimVerdicts)
    ? (finalReport.subclaimVerdicts as Array<Record<string, unknown>>)
    : [];
  if (deriveOverallVerdict(atomVerdicts) === "partial" && finalReport.verdictType === "false") {
    finalReport.verdictType = "mixed_misleading";
    finalReport._mixedGuard = "有据之真 + 假原子 → mixed";
  }

  const boundTiny = boundTinyRumorVerdict(input.claim, searchSources);
  if (
    boundTiny === "false" &&
    (finalReport.verdictType === "mixed_misleading" || finalReport.verdictType === "unverified")
  ) {
    finalReport.verdictType = "false";
  }

  const score = computeCredibilityScore(
    { severity: "medium", rumorIndicators: [], detectedPatterns: [] },
    {
      factCheckResult:
        finalReport.verdictType === "mixed_misleading"
          ? "partial"
          : (finalReport.verdictType as "true" | "false" | "partial" | "unverified"),
      confidence: urls.size > 0 ? "medium" : "low",
      keyFindings: Array.isArray(finalReport.keyFindings)
        ? finalReport.keyFindings.filter((item): item is string => typeof item === "string")
        : [],
      counterEvidence: [],
      sources: [...urls],
    },
    {
      sourceReliability: urls.size > 0 ? "medium" : "unverified",
      verifiedSources: [...urls],
      questionableSources: [],
      missingSources: urls.size === 0 ? ["无出处"] : [],
      verificationNotes: "",
    },
    {
      sources: [...urls].map(() => ({ direction: "neutral" as const, credibility: "中" as const })),
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: urls.size === 0 ? ["无出处"] : [],
    }
  );
  finalReport.credibilityScore = score.score;

  const review = reviewAndRepairReport(finalReport, { claim: input.claim, previousOutputs: [] });
  Object.assign(finalReport, review.repaired);
  applyFactDeskPostProcessToReport(finalReport, input.claim);
  if (looksLikeResearchMemo(submittedMemo)) {
    finalReport.conclusion = submittedMemo;
  }
  applyPublicCopy(finalReport);
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);
  finalReport._execution = "agent_loop";
  return finalReport;
}
