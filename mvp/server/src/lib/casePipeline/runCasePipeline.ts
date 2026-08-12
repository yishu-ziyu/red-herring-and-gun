/**
 * Case Pipeline — production orchestration for one claim case.
 * Depth: rumor → self-proof → per-atom search → fact//source → report → assemble → review.
 * HTTP / SSE are thin adapters; inject runAgent + searchOne + selfProof model.
 */

import { randomUUID } from "node:crypto";
import {
  claimAtomKey,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../claimAtom/index.js";
import {
  retrieveForAtoms,
  type AtomSearchBundle,
  type SearchOneAtom,
} from "../atomSearch.js";
import { assembleFinalReport } from "../reportAssembly/index.js";
import { normalizeReportCitations } from "../citationBinding.js";
import {
  reviewAndRepairReport,
  type ReportReviewIssue,
} from "../reportReviewer.js";
import { buildMemoryCandidatesFromRun } from "../memoryCandidateGenerator.js";
import type { MemoryCandidate } from "../memoryCandidateTypes.js";
import type { MemoryCandidateStore } from "../memoryCandidateStore.js";

export type PipelineStep = {
  agent: string;
  agentName?: string;
  agentIcon?: string;
  systemPrompt?: string;
  input?: Record<string, unknown>;
  output: Record<string, unknown>;
  model?: string;
  latencyMs?: number;
  timestamp?: number;
  status?: string;
  error?: string;
};

export type RunAgentFn = (
  agentId: string,
  steps: PipelineStep[],
  search360Result?: unknown,
  atomSearchBundle?: AtomSearchBundle | null
) => Promise<PipelineStep>;

export type CasePipelineHooks = {
  /** after self-proof written on rumor step */
  onSelfProof?: (info: { kept: string[]; dropped: unknown[]; model: string }) => void;
  /** atom search lifecycle (SSE) */
  onAtomSearchStart?: (atom: string) => void;
  onAtomSearchResult?: (atom: string, result: unknown) => void;
  /** between fact//source and report (e.g. consensus debate SSE) */
  afterFactSource?: (ctx: {
    steps: PipelineStep[];
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
  }) => Promise<void>;
  searchMode?: "parallel" | "sequential";
  /** deterministic report reviewer — tool_start style (SSE) */
  onReportReviewStart?: (info: { toolName: string; query: string }) => void;
  /** deterministic report reviewer — tool_result style (SSE) */
  onReportReviewResult?: (info: {
    toolName: string;
    query: string;
    passed: boolean;
    score: number;
    issues: ReportReviewIssue[];
    checks: Record<string, boolean>;
  }) => void;
  /** memory candidate propose — tool_start style (SSE) */
  onMemoryWriteStart?: (info: { toolName: string; query: string }) => void;
  /** memory candidate propose — tool_result style (SSE) */
  onMemoryWriteResult?: (info: {
    toolName: string;
    query: string;
    proposedCandidateCount: number;
  }) => void;
};

export type CasePipelineInput = {
  claim: string;
  runAgent: RunAgentFn;
  searchOne: SearchOneAtom;
  callSelfProofModel: SelfProofModelCall;
  /** report_composer with deterministic fallback */
  runReport: (args: {
    claim: string;
    steps: PipelineStep[];
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
  }) => Promise<PipelineStep>;
  hooks?: CasePipelineHooks;
  /** optional post-assembly mutators (formula score, fact-desk voice) */
  finalizeReport?: (ctx: {
    finalReport: Record<string, unknown>;
    claim: string;
    rumorStep: PipelineStep;
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
  }) => void;
  /** stable id for memory provenance; default randomUUID */
  runId?: string;
  /**
   * When set, proposed candidates are persisted after the run.
   * Handlers should pass the shared JsonlMemoryCandidateStore.
   * When omitted, candidates are still built and returned (no I/O).
   */
  memoryCandidateStore?: MemoryCandidateStore;
};

export type CasePipelineResult = {
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
  rumorStep: PipelineStep;
  factStep: PipelineStep;
  sourceStep: PipelineStep;
  reportStep: PipelineStep;
  /** proposed memory candidates (same shape as AgentRuntime) */
  memoryCandidates: MemoryCandidate[];
  runId: string;
};

const REPORT_REVIEWER_TOOL = "Report Reviewer (proposer-reviewer)";
const MEMORY_WRITE_TOOL = "Agent Memory Write";

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  const { claim, runAgent, searchOne, callSelfProofModel, runReport, hooks, finalizeReport } = input;
  const steps: PipelineStep[] = [];

  // Phase 1: RumorDetector
  const rumorStep = await runAgent("rumor_detector", steps);
  steps.push(rumorStep);

  // Phase 1a: self-proof (must precede per-atom search)
  const selfProof = await runClaimAtomSelfProof(
    claim,
    rumorStep?.output?.claimAtoms ?? [],
    callSelfProofModel
  );
  if (!rumorStep.output || typeof rumorStep.output !== "object") {
    rumorStep.output = {};
  }
  rumorStep.output.claimAtoms = selfProof.kept;
  rumorStep.output.claimAtomSelfProof = {
    kept: selfProof.kept,
    dropped: selfProof.dropped,
    model: selfProof.model,
  };
  hooks?.onSelfProof?.(selfProof);

  // Phase 1b: per-atom retrieval
  const { atomSearchBundle, search360Result } = await retrieveForAtoms({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    searchOne,
    claimAtomKeyFn: claimAtomKey,
    hooks: {
      mode: hooks?.searchMode ?? "parallel",
      onAtomStart: hooks?.onAtomSearchStart,
      onAtomResult: hooks?.onAtomSearchResult,
    },
  });

  // Phase 2: FactChecker // SourceValidator
  const [factStep, sourceStep] = await Promise.all([
    runAgent("fact_checker", steps, search360Result, atomSearchBundle),
    runAgent("source_validator", steps, search360Result, atomSearchBundle),
  ]);
  steps.push(factStep, sourceStep);

  if (hooks?.afterFactSource) {
    await hooks.afterFactSource({
      steps,
      factStep,
      sourceStep,
      search360Result,
      atomSearchBundle,
    });
  }

  // Phase 2a: Causal enrichment — 仅当 RumorDetector 拆出的原子含因果断言时，
  // 并行运行替代解释搜索 + 反证评分，失败可继续（不阻断收束）。
  const hasCausalAtom = Array.isArray(rumorStep?.output?.claimAtomTypes)
    && rumorStep.output.claimAtomTypes.some((t) => (t as { type?: string })?.type === "causal");
  if (hasCausalAtom) {
    const causalSteps = await Promise.allSettled([
      runAgent("alternative_explanation_searcher", steps, search360Result, atomSearchBundle),
      runAgent("counter_evidence_grader", steps, search360Result, atomSearchBundle),
    ]);
    for (const settled of causalSteps) {
      if (settled.status === "fulfilled") steps.push(settled.value);
    }
  }

  // Phase 3: ReportComposer (+ fallback owned by adapter)
  const reportStep = await runReport({
    claim,
    steps,
    search360Result,
    atomSearchBundle,
  });
  steps.push(reportStep);

  const finalReport =
    reportStep.output && typeof reportStep.output === "object"
      ? reportStep.output
      : ({} as Record<string, unknown>);

  const reportVerdicts = reportStep?.output?.subclaimVerdicts;
  const verdictSource =
    Array.isArray(reportVerdicts) && reportVerdicts.length > 0
      ? reportVerdicts
      : factStep?.output?.subclaimVerdicts;

  assembleFinalReport({
    finalReport,
    rumorStep,
    verdicts: verdictSource,
    searchSources: (search360Result as { sources?: Array<{ url?: unknown }> })?.sources,
    atomSearchBundle,
  });

  finalizeReport?.({
    finalReport,
    claim,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
  });

  // Phase 3b: deterministic report reviewer (same as AgentRuntime; non-LLM)
  hooks?.onReportReviewStart?.({
    toolName: REPORT_REVIEWER_TOOL,
    query: claim,
  });
  const review = reviewAndRepairReport(finalReport, {
    claim,
    previousOutputs: steps.map((s) => s.output),
  });
  Object.assign(finalReport, review.repaired);
  // Reviewer may pad evidenceChain / rewrite conclusion — re-bind [n] to sources.
  normalizeReportCitations(finalReport);
  reportStep.output = finalReport;
  hooks?.onReportReviewResult?.({
    toolName: REPORT_REVIEWER_TOOL,
    query: claim,
    passed: review.passed,
    score: review.score,
    issues: review.issues,
    checks: review.checks,
  });

  // Phase 3c: propose memory candidates (same as AgentRuntime memory write)
  const runId = input.runId ?? randomUUID();
  hooks?.onMemoryWriteStart?.({
    toolName: MEMORY_WRITE_TOOL,
    query: claim,
  });
  const memoryCandidates = buildMemoryCandidatesFromRun({
    runId,
    claim,
    steps,
    finalReport,
    searchResult: search360Result as Parameters<typeof buildMemoryCandidatesFromRun>[0]["searchResult"],
  });
  if (input.memoryCandidateStore && memoryCandidates.length > 0) {
    await input.memoryCandidateStore.propose(memoryCandidates);
  }
  hooks?.onMemoryWriteResult?.({
    toolName: MEMORY_WRITE_TOOL,
    query: claim,
    proposedCandidateCount: memoryCandidates.length,
  });

  return {
    steps,
    finalReport,
    atomSearchBundle,
    search360Result,
    rumorStep,
    factStep,
    sourceStep,
    reportStep,
    memoryCandidates,
    runId,
  };
}
