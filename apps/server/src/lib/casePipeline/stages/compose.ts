/**
 * 阶段 8 报告写作：ReportComposer（+ adapter 兜底）。
 * 分条已齐且剩余时间不够写一次完整报告（窗口约 90s，MiniMax 单次默认 180s）时跳过 LLM，走确定性报告再收尾。
 */
import { claimAtomKey } from "../../claimAtom/index.js";
import { REPORT_WRITE_MS } from "../budget.js";
import type { CaseState, PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";

function allVerifiableHaveJudgment(rumorStep: PipelineStep, factStep: PipelineStep): boolean {
  const atoms = Array.isArray(rumorStep.output?.claimAtoms)
    ? rumorStep.output.claimAtoms.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  const types = Array.isArray(rumorStep.output?.claimAtomTypes) ? rumorStep.output.claimAtomTypes : [];
  const verdicts = Array.isArray(factStep.output?.subclaimVerdicts) ? factStep.output.subclaimVerdicts : [];
  const verifiable = atoms.filter((atom) => {
    const info = types.find(
      (row) =>
        row &&
        typeof row === "object" &&
        claimAtomKey(String((row as { text?: unknown }).text ?? "")) === claimAtomKey(atom)
    ) as { verifiable?: boolean } | undefined;
    return info?.verifiable !== false;
  });
  if (verifiable.length === 0) return false;
  const judged = new Set(
    verdicts
      .filter((row) => row && typeof row === "object" && typeof (row as { verdict?: unknown }).verdict === "string")
      .map((row) => claimAtomKey(String((row as { claimAtom?: unknown }).claimAtom ?? "")))
  );
  return verifiable.every((atom) => judged.has(claimAtomKey(atom)));
}

function shouldWriteDeterministicReport(args: {
  rumorStep: PipelineStep;
  factStep: PipelineStep;
  timeLeftMs: number;
  reportWriteMs: number;
}): boolean {
  return args.timeLeftMs < args.reportWriteMs && allVerifiableHaveJudgment(args.rumorStep, args.factStep);
}

function deterministicReportStep(
  claim: string,
  judgment: Record<string, unknown>,
  reason: string
): PipelineStep {
  const startedAt = Date.now();
  return {
    agent: "report_composer",
    agentName: "ReportComposer",
    systemPrompt: "deterministic fallback report",
    input: { claim, fallbackReason: reason },
    output: { ...judgment, whyHardToVerify: [reason], _source: "deterministic-report" },
    model: "fallback:deterministic-report",
    latencyMs: Date.now() - startedAt,
    timestamp: Date.now(),
    status: "completed",
  };
}

/** Only settled claims and their directional sources enter the writer context. */
function writingJudgment(judgment: Record<string, unknown>): Record<string, unknown> {
  const verdicts = Array.isArray(judgment.subclaimVerdicts) ? judgment.subclaimVerdicts : [];
  return {
    verdictType: judgment.verdictType,
    directAnswer: judgment.conclusion,
    nonVerifiableAtoms: judgment.nonVerifiableAtoms,
    subclaimVerdicts: verdicts.map((raw) => {
      const verdict = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const sourcesRelatedOnly = verdict.sourcesRelatedOnly === true;
      return {
        claimAtom: verdict.claimAtom,
        verdict: verdict.verdict,
        boundary: verdict.boundary,
        evidenceGaps: verdict.evidenceGaps,
        supportingSources: sourcesRelatedOnly ? [] : verdict.supportingSources,
        contradictingSources: sourcesRelatedOnly ? [] : verdict.contradictingSources,
      };
    }),
  };
}

export async function compose(
  ctx: PipelineContext,
  state: CaseState,
  judgment: Record<string, unknown>,
  verifiedQuotes: Array<Record<string, unknown>>,
): Promise<PipelineStep> {
  const { input, claim, steps, budget, throwIfAborted } = ctx;
  const { rumorStep, search360Result, atomSearchBundle } = state;
  throwIfAborted();
  const reportStep = shouldWriteDeterministicReport({
    rumorStep,
    factStep: state.factStep,
    timeLeftMs: budget.timeLeftMs(),
    reportWriteMs: REPORT_WRITE_MS,
  })
    ? deterministicReportStep(
        claim,
        judgment,
        "剩余时间不够写完整报告，按已有分条判断收束。"
      )
    : await input.runReport({
        claim,
        steps,
        search360Result,
        atomSearchBundle,
        judgment: writingJudgment(judgment),
        verifiedQuotes,
        signal: input.signal,
        deadlineMs: input.deadline,
      });
  throwIfAborted();
  steps.push(reportStep);
  return reportStep;
}
