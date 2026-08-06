/**
 * evaluation/evaluationMetrics.ts
 *
 * Pure functions that compute evaluation metrics from benchmark results.
 * No side effects, no I/O — testable in isolation.
 *
 * Includes Book Ch.6 report review / contract fidelity scoring via
 * deterministic `reviewAndRepairReport` (proposer-reviewer).
 */

import type { GoldenCase } from "./goldenDataset";
import type { RuntimeStep } from "../AgentRuntime";
import { reviewAndRepairReport } from "../reportReviewer";

export interface CaseResult {
  case: GoldenCase;
  result: {
    claimType?: string;
    claim?: string;
    sessionId?: string;
    steps: RuntimeStep[];
    finalReport: Record<string, unknown>;
    followUpQueue?: unknown[];
    memoryCandidates?: unknown[];
    totalLatencyMs: number;
    /** Present when run through AgentRuntime; scoreCase re-runs reviewer for fidelity. */
    reportReview?: {
      passed: boolean;
      score: number;
      issues: Array<{ code: string; severity: string; message: string }>;
    };
  };
  error?: string;
}

export interface MetricScores {
  caseId: string;
  claim: string;
  category: string;
  difficulty: string;

  // Per-case scores (0 or 1 for boolean, partial for others)
  routingCorrect: boolean;
  sequenceCorrect: boolean;
  verdictCorrect: boolean;
  credibilityInRange: boolean;
  hallucinationDetected: boolean;

  /** Deterministic report contract: no error-severity issues after review. */
  reportContractPass: boolean;
  /** 0-100 from reviewAndRepairReport (100 - 25*errors - 8*warns). */
  reportReviewScore: number;

  // Aggregate
  overallPass: boolean;
}

export interface AggregateMetrics {
  totalCases: number;
  passed: number;
  failed: number;
  routingAccuracy: number;
  sequenceAccuracy: number;
  verdictAccuracy: number;
  verdictCorrectCount: number;
  credibilityAccuracy: number;
  hallucinationRate: number;
  /** Fraction of cases with reportContractPass === true */
  reportContractPassRate: number;
  /** Mean reportReviewScore across cases (0-100) */
  avgReportReviewScore: number;
  byCategory: Record<string, { total: number; passed: number; verdictCorrectCount: number }>;
  byDifficulty: Record<string, { total: number; passed: number }>;
  failures: Array<{ caseId: string; claim: string; reason: string }>;
}

function extractVerdict(report: Record<string, unknown>): string {
  return typeof report.verdictType === "string" ? report.verdictType : "unknown";
}

function extractCredibility(report: Record<string, unknown>): number {
  const score = report.credibilityScore;
  if (typeof score === "number" && Number.isFinite(score)) return score;
  return 50;
}

function isHallucination(case_: GoldenCase, verdict: string): boolean {
  // A hallucination is when the system gives a definitive verdict (true/false)
  // but the golden case says it should be unverified or mixed_misleading
  const goldenVerdict = case_.expectedVerdictType;
  if (goldenVerdict === "unverified" && (verdict === "true" || verdict === "false")) return true;
  if (goldenVerdict === "mixed_misleading" && verdict === "true") return true;
  if (goldenVerdict === "true" && verdict === "false") return true;
  if (goldenVerdict === "false" && verdict === "true") return true;
  return false;
}

/**
 * Score report contract fidelity using the same deterministic reviewer
 * as AgentRuntime (Book Ch.6 proposer-reviewer).
 */
export function scoreReportContract(
  finalReport: Record<string, unknown>,
  opts?: {
    previousOutputs?: Record<string, unknown>[];
    claim?: string;
  }
): { reportContractPass: boolean; reportReviewScore: number } {
  const review = reviewAndRepairReport(finalReport, opts);
  return {
    reportContractPass: review.passed,
    reportReviewScore: review.score,
  };
}

export function scoreCase(result: CaseResult): MetricScores {
  const { case: golden, result: runResult, error } = result;

  if (error) {
    return {
      caseId: golden.id,
      claim: golden.claim,
      category: golden.category,
      difficulty: golden.difficulty,
      routingCorrect: false,
      sequenceCorrect: false,
      verdictCorrect: false,
      credibilityInRange: false,
      hallucinationDetected: false,
      reportContractPass: false,
      reportReviewScore: 0,
      overallPass: false,
    };
  }

  const actualVerdict = extractVerdict(runResult.finalReport);
  const actualCredibility = extractCredibility(runResult.finalReport);
  const actualSequence = runResult.steps.map((s) => s.agent);

  let routingCorrect = runResult.steps.some((s) => s.agent !== "report_composer")
    ? golden.expectedAgentSequence.some((a) => a !== "report_composer")
    : golden.expectedAgentSequence.every((a) => a === "report_composer");

  // For concept claims, check that ONLY report_composer ran
  if (golden.category === "concept") {
    const nonReportAgents = actualSequence.filter((a) => a !== "report_composer");
    routingCorrect = nonReportAgents.length === 0;
  } else {
    routingCorrect = actualSequence.includes("rumor_detector")
      && actualSequence.includes("fact_checker")
      && actualSequence.includes("source_validator")
      && actualSequence.includes("report_composer");
  }

  // Sequence: check that all expected agents appear in the right relative order
  let sequenceCorrect = true;
  for (let i = 0; i < golden.expectedAgentSequence.length; i++) {
    const expectedAgent = golden.expectedAgentSequence[i];
    const idx = actualSequence.indexOf(expectedAgent);
    if (idx === -1) {
      sequenceCorrect = false;
      break;
    }
    // Check relative ordering: each agent must appear after the previous expected agent
    if (i > 0) {
      const prevIdx = actualSequence.indexOf(golden.expectedAgentSequence[i - 1]);
      if (prevIdx === -1 || idx <= prevIdx) {
        sequenceCorrect = false;
        break;
      }
    }
  }

  const verdictCorrect = actualVerdict === golden.expectedVerdictType;
  const credibilityInRange =
    actualCredibility >= golden.expectedCredibilityRange[0]
    && actualCredibility <= golden.expectedCredibilityRange[1];
  const hallucinationDetected = isHallucination(golden, actualVerdict);

  const previousOutputs = runResult.steps
    .map((s) => s.output)
    .filter((o): o is Record<string, unknown> => o != null && typeof o === "object");
  const { reportContractPass, reportReviewScore } = scoreReportContract(
    runResult.finalReport,
    { previousOutputs, claim: golden.claim }
  );

  const overallPass =
    routingCorrect
    && sequenceCorrect
    && verdictCorrect
    && credibilityInRange
    && !hallucinationDetected
    && reportContractPass;

  return {
    caseId: golden.id,
    claim: golden.claim,
    category: golden.category,
    difficulty: golden.difficulty,
    routingCorrect,
    sequenceCorrect,
    verdictCorrect,
    credibilityInRange,
    hallucinationDetected,
    reportContractPass,
    reportReviewScore,
    overallPass,
  };
}

export function aggregateMetrics(scores: MetricScores[]): AggregateMetrics {
  const total = scores.length;
  const passed = scores.filter((s) => s.overallPass).length;
  const failed = total - passed;

  const routingCorrect = scores.filter((s) => s.routingCorrect).length;
  const sequenceCorrect = scores.filter((s) => s.sequenceCorrect).length;
  const verdictCorrect = scores.filter((s) => s.verdictCorrect).length;
  const credibilityCorrect = scores.filter((s) => s.credibilityInRange).length;
  const hallucinations = scores.filter((s) => s.hallucinationDetected).length;
  const contractPass = scores.filter((s) => s.reportContractPass).length;
  const reviewScoreSum = scores.reduce((acc, s) => acc + s.reportReviewScore, 0);

  const byCategory: Record<string, { total: number; passed: number; verdictCorrectCount: number }> = {};
  const byDifficulty: Record<string, { total: number; passed: number }> = {};

  for (const s of scores) {
    if (!byCategory[s.category]) byCategory[s.category] = { total: 0, passed: 0, verdictCorrectCount: 0 };
    byCategory[s.category].total++;
    if (s.overallPass) byCategory[s.category].passed++;
    if (s.verdictCorrect) byCategory[s.category].verdictCorrectCount++;

    if (!byDifficulty[s.difficulty]) byDifficulty[s.difficulty] = { total: 0, passed: 0 };
    byDifficulty[s.difficulty].total++;
    if (s.overallPass) byDifficulty[s.difficulty].passed++;
  }

  const failures = scores
    .filter((s) => !s.overallPass)
    .map((s) => ({
      caseId: s.caseId,
      claim: s.claim,
      reason: [
        !s.routingCorrect && "routing wrong",
        !s.sequenceCorrect && "sequence wrong",
        !s.verdictCorrect && "verdict mismatch",
        !s.credibilityInRange && "credibility out of range",
        s.hallucinationDetected && "hallucination detected",
        !s.reportContractPass && `report contract fail (score ${s.reportReviewScore})`,
      ].filter(Boolean).join("; "),
    }));

  return {
    totalCases: total,
    passed,
    failed,
    routingAccuracy: total > 0 ? routingCorrect / total : 0,
    sequenceAccuracy: total > 0 ? sequenceCorrect / total : 0,
    verdictAccuracy: total > 0 ? verdictCorrect / total : 0,
    verdictCorrectCount: verdictCorrect,
    credibilityAccuracy: total > 0 ? credibilityCorrect / total : 0,
    hallucinationRate: total > 0 ? hallucinations / total : 0,
    reportContractPassRate: total > 0 ? contractPass / total : 0,
    avgReportReviewScore: total > 0 ? reviewScoreSum / total : 0,
    byCategory,
    byDifficulty,
    failures,
  };
}
