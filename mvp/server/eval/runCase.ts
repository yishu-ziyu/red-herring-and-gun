/**
 * eval/runCase.ts — 用生产依赖组装 casePipeline，跑单个 golden case。
 *
 * 复用生产模块（callAgentWithFallback / AGENT_CONFIGS / buildAgentInput /
 * runClaimAtomSelfProof / reviewAndRepairReport / searchClaimAcrossSources），
 * 不复制生产逻辑，保证评测跑的就是生产路径。
 *
 * 运行方式见 eval/run.ts（tsx 脚本，不参与 tsc build）。
 */

import { AGENT_CONFIGS, buildAgentInput } from "../src/lib/agentConfigs.js";
import { callAgentWithFallback } from "../src/lib/providerRouter.js";
import { runCasePipeline, type PipelineStep } from "../src/lib/casePipeline/index.js";
import { searchClaimAcrossSources } from "../src/lib/sherlockStyleSearch.js";
import { applyFormulaScoreToReport, computeFormulaScore } from "../src/handlers.js";
import type { ScoreCaseGolden } from "./golden.js";

export interface EvalEnv {
  env: Record<string, string>;
  codexBin: string;
}

/** 单个 agent 的真实模型调用（production path 同款）。 */
function makeRunAgent({ env, codexBin }: EvalEnv, claim: string) {
  return async function runAgent(
    agentId: string,
    steps: PipelineStep[],
    search360Result?: unknown,
    atomSearchBundle?: unknown
  ): Promise<PipelineStep> {
    const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);

    const agentInput = buildAgentInput(agentId, claim, steps as never) as Record<string, unknown>;
    if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
      agentInput.search360 = search360Result;
      if (atomSearchBundle && (agentId === "fact_checker" || agentId === "report_composer")) {
        agentInput.atomSearches = (atomSearchBundle as { forAgent?: unknown }).forAgent;
      }
    }

    const userContent = JSON.stringify(agentInput, null, 2);
    const result = await callAgentWithFallback({
      agentId,
      systemPrompt: agentConfig.systemPrompt,
      userContent,
      responseSchema: agentConfig.responseSchema,
      maxTokens: agentConfig.maxTokens,
      env,
      codexBin,
      reasoningEffort: "high",
      options: { logger: { info: () => {}, error: () => {} } },
    });

    return {
      agent: agentConfig.id,
      agentName: agentConfig.name,
      agentIcon: agentConfig.icon,
      systemPrompt: agentConfig.systemPrompt,
      input: agentInput,
      output: (result.output ?? {}) as Record<string, unknown>,
      model: result.model,
      latencyMs: result.latencyMs,
      timestamp: Date.now(),
      status: "completed",
    };
  };
}

function makeSelfProof({ env, codexBin }: EvalEnv) {
  return (input: {
    systemPrompt: string;
    userContent: string;
    responseSchema: object;
    maxTokens: number;
  }) =>
    callAgentWithFallback({
      agentId: "rumor_detector_selfproof",
      systemPrompt: input.systemPrompt,
      userContent: input.userContent,
      responseSchema: input.responseSchema,
      maxTokens: input.maxTokens,
      env,
      codexBin,
      reasoningEffort: "low",
      options: { logger: { info: () => {}, error: () => {} } },
    }).then((r) => ({ output: r.output, model: r.model }));
}

/** 生产搜索：searchClaimAcrossSources 已导出，返回结构含 sources 供 atomSearch 消费。 */
function makeSearchOne() {
  return async (atom: string) => {
    try {
      return await searchClaimAcrossSources(atom);
    } catch {
      return { sources: [], answer: "", model: "", traceText: "", _source: "error" };
    }
  };
}

export interface EvalCaseResult {
  claims?: PipelineStep[] | never[];
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  error?: string;
}

export async function runCase(
  golden: ScoreCaseGolden,
  evalEnv: EvalEnv
): Promise<{ steps: PipelineStep[]; finalReport: Record<string, unknown>; error?: string }> {
  const runAgent = makeRunAgent(evalEnv, golden.claim);
  const claim = golden.claim;
  try {
    const result = await runCasePipeline({
      claim,
      runAgent,
      searchOne: makeSearchOne(),
      callSelfProofModel: makeSelfProof(evalEnv),
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        runAgent("report_composer", steps, search360Result, atomSearchBundle),
      // 复用生产评分公式，保证评测分数 = 生产分数（eval 不绕过公式）
      finalizeReport: ({ finalReport, rumorStep, factStep, sourceStep, search360Result }) => {
        applyFormulaScoreToReport(
          finalReport,
          computeFormulaScore(
            rumorStep.output,
            factStep.output,
            sourceStep.output,
            search360Result
          )
        );
      },
    });
    return { steps: result.steps, finalReport: result.finalReport };
  } catch (error) {
    return {
      steps: [],
      finalReport: {},
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}