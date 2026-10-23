/**
 * 阶段 3 核查：FactChecker → SourceValidator → 来源关系审计。
 * SourceValidator 必须看见 FactChecker 真正准备发布的方向性 URL，才能对 claimAtom + URL 做独立关系审计；
 * 并行各跑各的无法完成这条门禁。首份 judging 快照在审计之后才发。
 */
import type { CaseState, PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";
import { createSourceAudit } from "../sourceAudit.js";
import type { Retrieval } from "./retrieve.js";
import { enrichSearchSources, pickUrlsToRead } from "../../sourceContent.js";

// Caps what one page adds to the FactChecker prompt; 8 pages stay well inside the model's context.
const JUDGE_EXCERPT_CHARS = 8_000;

function fallbackAgentStep(agentId: string, error: unknown, search360Result?: unknown): PipelineStep {
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
  const { steps, snapshots, throwIfAborted } = ctx;
  const { runAgent } = ctx.input;
  const { atomSearchBundle, search360Result } = retrieval;
  // 判定前先读原文：FactChecker 要对着正文下判断，而不是对着搜索摘要。
  await enrichSearchSources(atomSearchBundle, ctx.input.signal, ctx.input.deadline, pickUrlsToRead(atomSearchBundle), () => {
    snapshots.investigating({ atomSearchBundle });
  }, JUDGE_EXCERPT_CHARS);
  throwIfAborted();
  let factStep: PipelineStep;
  try {
    factStep = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
  } catch (error) {
    factStep = fallbackAgentStep("fact_checker", error, search360Result);
  }
  steps.push(factStep);
  throwIfAborted();
  // FactChecker 采用了判定前没读到的来源时，补读一次，供 SourceValidator 核对方向。
  const verdicts = Array.isArray(factStep.output.subclaimVerdicts) ? factStep.output.subclaimVerdicts : [];
  const selectedUrls = verdicts.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const verdict = raw as Record<string, unknown>;
    return [verdict.supportingSources, verdict.contradictingSources].flatMap((sources) =>
      Array.isArray(sources) ? sources.map((source) => String(source?.url ?? "").trim()).filter(Boolean) : []);
  });
  await enrichSearchSources(atomSearchBundle, ctx.input.signal, ctx.input.deadline, selectedUrls, () => {
    // 只发布已取得、尚未核对的材料；不能提前发布 FactChecker 的未审计判词。
    snapshots.investigating({ atomSearchBundle });
  }, JUDGE_EXCERPT_CHARS);
  throwIfAborted();
  let sourceStep: PipelineStep;
  try {
    sourceStep = await runAgent("source_validator", steps, search360Result, atomSearchBundle);
  } catch (error) {
    sourceStep = fallbackAgentStep("source_validator", error, search360Result);
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
