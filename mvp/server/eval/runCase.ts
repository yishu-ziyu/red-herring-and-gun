/**
 * eval/runCase.ts — 用生产依赖组装 casePipeline，跑单个 golden case。
 *
 * 复用生产模块（callAgentWithFallback / AGENT_CONFIGS / buildAgentInput /
 * runClaimAtomSelfProof / reviewAndRepairReport / retrieveAtomSources），
 * 不复制生产逻辑，保证评测跑的就是生产路径。
 *
 * 运行方式见 eval/run.ts（tsx 脚本，不参与 tsc build）。
 */

import { AGENT_CONFIGS, buildAgentInput } from "../src/lib/agentConfigs.js";
import { callAgentWithFallback, ProviderFallbackError } from "../src/lib/providerRouter.js";
import { runCasePipeline, type PipelineStep } from "../src/lib/casePipeline/index.js";
import { retrieveAtomSources, buildDeterministicFinalReport } from "../src/handlers.js";
import { applyFormulaScoreToReport, computeFormulaScore } from "../src/handlers.js";
import { applyFactDeskPostProcessToReport } from "../src/lib/factDeskPostProcess.js";
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
      options: { logger: { info: () => {}, error: console.error.bind(console) } },
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
      options: { logger: { info: () => {}, error: console.error.bind(console) } },
    }).then((r) => ({ output: r.output, model: r.model }));
}

/** 生产搜索：与 Case Pipeline HTTP 同一 retrieveAtomSources（双路查询 + 并行源）。 */
function makeSearchOne(env: Record<string, string>) {
  return async (atom: string) => {
    try {
      return await retrieveAtomSources(env, atom);
    } catch {
      return { sources: [], answer: "", model: "", traceText: "", _source: "error" };
    }
  };
}

export interface EvalCaseResult {
  claims?: PipelineStep[] | never[];
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle?: unknown;
  error?: string;
}

export async function runCase(
  golden: ScoreCaseGolden,
  evalEnv: EvalEnv
): Promise<{
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle?: unknown;
  error?: string;
}> {
  const runAgent = makeRunAgent(evalEnv, golden.claim);
  const claim = golden.claim;
  try {
    const result = await runCasePipeline({
      claim,
      runAgent,
      searchOne: makeSearchOne(evalEnv.env),
      callSelfProofModel: makeSelfProof(evalEnv),
      runReport: async ({ claim: reportClaim, steps, search360Result, atomSearchBundle }) => {
        try {
          return await runAgent("report_composer", steps, search360Result, atomSearchBundle);
        } catch (error) {
          const message = error instanceof Error ? error.message : "report_composer failed";
          return {
            agent: "report_composer",
            output: buildDeterministicFinalReport(reportClaim, steps, search360Result, message),
            model: "fallback:deterministic-report",
            status: "completed",
            error: message,
            timestamp: Date.now(),
          };
        }
      },
      // 复用生产评分公式，保证评测分数 = 生产分数（eval 不绕过公式）
      finalizeReport: ({ finalReport, claim: reportClaim, rumorStep, factStep, sourceStep, search360Result }) => {
        applyFormulaScoreToReport(
          finalReport,
          computeFormulaScore(
            rumorStep.output,
            factStep.output,
            sourceStep.output,
            search360Result
          )
        );
        applyFactDeskPostProcessToReport(finalReport, reportClaim);
      },
    });
    return {
      steps: result.steps,
      finalReport: result.finalReport,
      atomSearchBundle: result.atomSearchBundle,
    };
  } catch (error) {
    return {
      steps: [],
      finalReport: {},
      error:
        error instanceof ProviderFallbackError
          ? `${error.message}${error.providerErrors?.length ? ` | ${error.providerErrors.slice(0, 4).join("；")}` : ""}`
          : error instanceof Error
            ? error.message
            : "unknown error",
    };
  }
}