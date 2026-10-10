/**
 * eval/runCase.ts — 用生产依赖组装 casePipeline，跑单个 golden case。
 *
 * 复用生产模块（callAgentWithFallback / AGENT_CONFIGS / buildAgentInput /
 * reviewAndRepairReport / retrieveAtomSources），
 * 不复制生产逻辑，保证评测跑的就是生产路径。
 *
 * 运行方式见 eval/run.ts（tsx 脚本，不参与 tsc build）。
 */

import { AGENT_CONFIGS, buildAgentInput } from "../src/lib/agentConfigs.js";
import { callAgentWithFallback, ProviderFallbackError } from "../src/lib/providerRouter.js";
import { runCasePipeline, type CasePipelineHooks, type PipelineStep } from "../src/lib/casePipeline/index.js";
import { retrieveAtomSources } from "../src/lib/searchProviders.js";
import { applyFactDeskPostProcessToReport } from "../src/lib/factDeskPostProcess.js";
import type { ScoreCaseGolden } from "./golden.js";

export interface EvalEnv {
  env: Record<string, string>;
}

/** 单个 agent 的真实模型调用（production path 同款）。 */
function makeRunAgent({ env }: EvalEnv, claim: string) {
  return async function runAgent(
    agentId: string,
    steps: PipelineStep[],
    search360Result?: unknown,
    atomSearchBundle?: unknown
  ): Promise<PipelineStep> {
    const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);

    const agentInput = buildAgentInput(agentId, claim, steps as never) as Record<string, unknown>;
    if (search360Result && ["fact_checker", "source_validator"].includes(agentId)) {
      agentInput.search360 = search360Result;
      if (atomSearchBundle) {
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
  evidenceLoop?: unknown;
  error?: string;
}

export async function runCase(
  golden: ScoreCaseGolden,
  evalEnv: EvalEnv,
  /** 可选：订阅管线钩子。只有订阅了 onInvestigationSnapshot，管线才会构建 finalReport.investigation（生产 HTTP 路径始终订阅）。 */
  hooks?: CasePipelineHooks
): Promise<{
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle?: unknown;
  evidenceLoop?: unknown;
  error?: string;
}> {
  const runAgent = makeRunAgent(evalEnv, golden.claim);
  const claim = golden.claim;
  try {
    const result = await runCasePipeline({
      claim,
      ...(hooks ? { hooks } : {}),
      runAgent,
      searchOne: makeSearchOne(evalEnv.env),
      finalizeReport: ({ finalReport, claim: reportClaim }) => {
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
