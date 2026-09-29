/**
 * 阶段 3 核查：FactChecker → SourceValidator → 来源关系审计。
 * SourceValidator 必须看见 FactChecker 真正准备发布的方向性 URL，才能对 claimAtom + URL 做独立关系审计；
 * 并行各跑各的无法完成这条 P0 门禁。首份 judging 快照在审计之后才发。
 */
import type { CaseState, PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";
import { createSourceAudit } from "../sourceAudit.js";
import type { Retrieval } from "./retrieve.js";

function fallbackAgentStep(agentId: string, error: unknown, search360Result?: unknown, _claim = ""): PipelineStep {
  const message = error instanceof Error ? error.message : `${agentId} failed`;
  const sources = Array.isArray((search360Result as { sources?: unknown[] } | undefined)?.sources)
    ? ((search360Result as { sources: Array<{ title?: unknown; snippet?: unknown; url?: unknown }> }).sources)
    : [];
  const urls = sources
    .map((s) => String(s.url || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 4);
  if (agentId === "fact_checker") {
    return {
      agent: "fact_checker",
      output: {
        factCheckResult: "unverified",
        confidence: "low",
        sources: urls,
        keyFindings: ["核查模型未完成，结论只能依据检索到的公开材料。"],
        counterEvidence: [],
        subclaimVerdicts: [],
      },
      status: "completed",
      error: message,
      timestamp: Date.now(),
    };
  }
  return {
    agent: "source_validator",
    output: {
      sourceReliability: "unverified",
      verifiedSources: [],
      questionableSources: [],
      missingSources: ["信源审计模型未完成"],
      verificationNotes: "信源审计未完成，请直接看来源链接。",
      claimSourceRelations: [],
    },
    status: "completed",
    error: message,
    timestamp: Date.now(),
  };
}

export async function judge(ctx: PipelineContext, rumorStep: PipelineStep, retrieval: Retrieval): Promise<CaseState> {
  const { claim, steps, snapshots, throwIfAborted } = ctx;
  const { runAgent } = ctx.input;
  const { atomSearchBundle, search360Result } = retrieval;
  let factStep: PipelineStep;
  try {
    factStep = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
  } catch (error) {
    factStep = fallbackAgentStep("fact_checker", error, search360Result, claim);
  }
  steps.push(factStep);
  let sourceStep: PipelineStep;
  try {
    sourceStep = await runAgent("source_validator", steps, search360Result, atomSearchBundle);
  } catch (error) {
    sourceStep = fallbackAgentStep("source_validator", error, search360Result, claim);
  }
  steps.push(sourceStep);

  const partial: Omit<CaseState, "sourceAudit"> = { rumorStep, ...retrieval, factStep, sourceStep };
  const state = partial as CaseState;
  state.sourceAudit = createSourceAudit(ctx, state);
  state.sourceAudit.apply();

  throwIfAborted();
  // 里程碑：核查绑定开始（判词与证据关系出现；来源不再是 unassessed）。
  snapshots.judging({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
    subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
    sourceRelationAudits: state.sourceStep?.output?.claimSourceRelations,
  });
  return state;
}
