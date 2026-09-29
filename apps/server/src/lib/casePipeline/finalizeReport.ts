/** Report writing ends here. Judgment and cited sources were settled before the model ran. */
import { normalizeReportCitations } from "../citationBinding.js";
import type { CrossExamOutcome } from "../crossExam/index.js";
import type { EvidenceLoopOutcome } from "../evidenceLoop/index.js";
import { compactPursuitHops } from "../evidencePursuit/index.js";
import { applyFollowUpAnswerLead } from "../followUpReuse.js";
import { applyImageOriginToReport, type ImageOriginResult } from "../imageOrigin/index.js";
import { applyUnopenedLinkConclusion, directAnswer } from "../publicCopy.js";
import { faceVerdictFor } from "../reportAssembly/index.js";
import { reviewAndRepairReport, type ReportReviewResult } from "../reportReviewer.js";
import type { CasePipelineInput, PipelineStep } from "./runCasePipeline.js";

export type FinalizeReportInput = {
  claim: string;
  reportStep: PipelineStep;
  rumorStep: PipelineStep;
  factStep: PipelineStep;
  sourceStep: PipelineStep;
  judgment: Record<string, unknown>;
  search360Result: unknown;
  imageOrigin?: ImageOriginResult;
  crossExam?: CrossExamOutcome;
  evidenceLoop?: EvidenceLoopOutcome;
  finalizeHook?: CasePipelineInput["finalizeReport"];
  onReviewStart?: () => void;
  signal?: AbortSignal;
};

export type FinalizeReportResult = {
  finalReport: Record<string, unknown>;
  review: ReportReviewResult;
};

const FACT_CHECK_RESULT: Record<string, string> = {
  true: "true",
  false: "false",
  partial: "partial",
  mixed_misleading: "partial",
  disputed: "partial",
  unverified: "unverified",
};

function modelText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function allowedCitationUrls(judgment: Record<string, unknown>): Set<string> {
  const urls = new Set<string>();
  for (const verdict of Array.isArray(judgment.subclaimVerdicts) ? judgment.subclaimVerdicts : []) {
    if (!verdict || typeof verdict !== "object") continue;
    if ((verdict as Record<string, unknown>).sourcesRelatedOnly === true) continue;
    for (const bucket of ["supportingSources", "contradictingSources"] as const) {
      const sources = (verdict as Record<string, unknown>)[bucket];
      for (const source of Array.isArray(sources) ? sources : []) {
        const url = source && typeof source === "object" ? (source as { url?: unknown }).url : undefined;
        if (typeof url === "string") urls.add(url);
      }
    }
  }
  return urls;
}

export async function finalizeReport(input: FinalizeReportInput): Promise<FinalizeReportResult> {
  input.signal?.throwIfAborted();
  const { claim, reportStep, rumorStep, factStep, sourceStep, judgment, imageOrigin } = input;
  const draft = reportStep.output ?? {};
  const finalReport: Record<string, unknown> = { ...judgment };
  if (typeof draft._source === "string") finalReport._source = draft._source;
  const explanation = modelText(draft.explanation);
  const summaryExplanation = modelText(draft.summaryExplanation);
  // Even a refuted conjunction may contain unresolved parts. Keep their scoped
  // answer intact instead of letting unrestricted prose silently judge them.
  const hasUnresolvedPart = Array.isArray(judgment.subclaimVerdicts) && judgment.subclaimVerdicts.some(
    (row) => row && typeof row === "object" && (row as { verdict?: unknown }).verdict === "unverified",
  );
  if (explanation && judgment.verdictType !== "unverified" && !hasUnresolvedPart) {
    finalReport.conclusion = `${directAnswer(judgment.verdictType)}${explanation}`;
    finalReport.summaryForPublic = `${directAnswer(judgment.verdictType)}${summaryExplanation || explanation}`;
    for (const key of ["whyHardToVerify", "causalBoundary"] as const) {
      if (draft[key] !== undefined) finalReport[key] = draft[key];
    }
    const allowedUrls = allowedCitationUrls(judgment);
    if (Array.isArray(draft.evidenceChain)) {
      finalReport.evidenceChain = draft.evidenceChain.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const layer = raw as Record<string, unknown>;
        return {
          ...layer,
          sourceRefs: Array.isArray(layer.sourceRefs)
            ? layer.sourceRefs.filter((url): url is string => typeof url === "string" && allowedUrls.has(url))
            : [],
        };
      });
    }
  }

  // Formula and copy hooks read the same settled whole-claim verdict. They cannot change it.
  const formalFactResult = FACT_CHECK_RESULT[String(judgment.verdictType)] ?? "unverified";
  const originalFactResult = factStep.output.factCheckResult;
  factStep.output.factCheckResult = formalFactResult;
  try {
    input.finalizeHook?.({ finalReport, claim, rumorStep, factStep, sourceStep, search360Result: input.search360Result });
  } finally {
    factStep.output.factCheckResult = originalFactResult;
  }

  if (input.crossExam) {
    finalReport.crossExam = {
      ran: input.crossExam.ran,
      skippedReason: input.crossExam.skippedReason,
      model: input.crossExam.model,
      adjustment: 0,
      atoms: input.crossExam.atoms.map((atom) => ({
        ...atom,
        reason: atom.secondReason,
      })),
    };
  }
  if (input.evidenceLoop?.pursuitHops?.length) {
    finalReport.evidencePursuit = { hops: compactPursuitHops(input.evidenceLoop.pursuitHops) };
  }

  input.onReviewStart?.();
  const review = reviewAndRepairReport(finalReport);
  Object.assign(finalReport, review.repaired);
  // The reviewer checks presentation only; restore formal fields even if a legacy repair touched them.
  for (const key of ["verdictType", "subclaimVerdicts", "nonVerifiableAtoms", "claimItems", "_verdictDecision"] as const) {
    finalReport[key] = judgment[key];
  }
  normalizeReportCitations(finalReport);
  if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);
  applyFollowUpAnswerLead(finalReport, claim);
  const keptAtomCount = Array.isArray(rumorStep.output.claimAtoms) ? rumorStep.output.claimAtoms.length : 0;
  applyUnopenedLinkConclusion(finalReport, claim, keptAtomCount);
  finalReport.faceVerdict = faceVerdictFor(judgment.verdictType);
  finalReport.checkedAt = new Date().toISOString();
  return { finalReport, review };
}
