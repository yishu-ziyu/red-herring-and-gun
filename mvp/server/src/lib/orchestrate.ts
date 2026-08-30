/**
 * orchestrate.ts — 多 Agent Orchestrate 编排适配层（从 handlers 抽出）。
 *
 * 职责：把 claim + 检索结果 组装成单个 Agent 调用（状态栏 / 按需 Skills / 模型 fallback /
 * 思考句流式），以及自证 / 改写 / 交叉二审三个子调用器。纯编排，不含 HTTP。
 * handlers 只做接线：注入 env / codexBin / 模型路由 / 工具函数，拿到工厂产物回调。
 */
import {
  AGENT_CONFIGS,
  buildAgentInput,
} from "./agentConfigs.js";
import { buildAgentStatusBar } from "./contextStatusBar.js";
import { formatSkillsForPrompt, selectAgentSkills } from "./agentSkills.js";
import {
  callAgentWithFallback,
  providerOrderForAgent,
  AgentTextProviderId,
} from "./providerRouter.js";
import { compactSearchResultForAgent, buildReportEvidenceInputs } from "./searchProviders.js";
import { splitReasoningSentences, thoughtInterSentenceDelayMs } from "../../../src/lib/reasoningThoughts.js";
import { sleepMs } from "./httpUtils.js";
import type { RunAgentFn } from "./casePipeline/index.js";

export interface OrchestrateAdapterDeps {
  env: Record<string, string>;
  codexBin: string;
}

/** Prefer rumor_detector stanceClaimType; default mixed for skill routing. */
function inferClaimTypeForSkills(steps: Array<{ agent?: string; output?: Record<string, unknown> }>): string | undefined {
  const rumor = steps.find((s) => s.agent === "rumor_detector");
  const stance = rumor?.output?.stanceClaimType as { type?: string } | undefined;
  if (stance && typeof stance.type === "string" && stance.type.length > 0) {
    return stance.type;
  }
  return undefined;
}

export function createOrchestrateAdapter(deps: OrchestrateAdapterDeps) {
  const { env, codexBin } = deps;

  /** 单个 Agent 调用：组装输入 → LLM fallback → 结果 step。 */
  function makeRunAgent(opts: {
    claim: string;
    modelChoice: any;
    intakeMetadata: any;
    visualExtraction: Record<string, unknown> | undefined;
    clientMemoryRecall: any;
    onStart?: (agentId: string, agentConfig: (typeof AGENT_CONFIGS)[number]) => void;
    onThought?: (
      agentId: string,
      agentConfig: (typeof AGENT_CONFIGS)[number],
      content: string,
      seq: number,
      done: boolean
    ) => void;
    onComplete?: (step: any) => void;
    onError?: (agentId: string, agentConfig: (typeof AGENT_CONFIGS)[number], error: unknown) => void;
  }): RunAgentFn {
    return async function runAgent(agentId, steps, search360Result?, atomSearchBundle?) {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      opts.onStart?.(agentId, agentConfig);
      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, opts.claim, steps as any);
      if (opts.intakeMetadata) agentInput.intake = opts.intakeMetadata;
      if (opts.visualExtraction) agentInput.visualExtraction = opts.visualExtraction;
      if (opts.clientMemoryRecall) agentInput.memoryRecall = opts.clientMemoryRecall;
      if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        agentInput.search360 = compactSearchResultForAgent(search360Result);
        if (atomSearchBundle && (agentId === "fact_checker" || agentId === "report_composer")) {
          agentInput.atomSearches = atomSearchBundle.forAgent;
        }
      }
      if (agentId === "report_composer") {
        agentInput.evidenceInputs = buildReportEvidenceInputs(steps as any, search360Result);
      }

      // Book Ch.2：状态栏 + 按需 Skills
      const claimType = inferClaimTypeForSkills(steps as any) ?? "mixed";
      const memoryRecall = opts.clientMemoryRecall as
        | { hitCount?: number; acceptedCandidateCount?: number }
        | undefined;
      const statusBar = buildAgentStatusBar({
        agentId,
        agentName: agentConfig.name,
        claim: opts.claim,
        claimType,
        stepIndex: steps.length + 1,
        totalStepsHint: 4,
        tools: [],
        memoryHitCount: memoryRecall?.hitCount ?? 0,
        acceptedCandidateCount: memoryRecall?.acceptedCandidateCount ?? 0,
        searchReady: Boolean(search360Result),
      });
      agentInput.agentStatusBar = statusBar.text;
      agentInput.agentStatusFields = statusBar.fields;
      const skills = selectAgentSkills({ agentId, claimType, maxSkills: 3 });
      const systemPrompt = `${agentConfig.systemPrompt}${formatSkillsForPrompt(skills)}`;
      agentInput.loadedSkills = skills.map((s) => s.id);
      const userContent = `${statusBar.text}\n\n${JSON.stringify(agentInput, null, 2)}`;

      let output: Record<string, unknown>;
      let modelUsed: string;
      try {
        const modelOverride =
          opts.modelChoice && typeof opts.modelChoice === "object"
            ? (opts.modelChoice as Record<string, { provider: string; model: string }>)[agentConfig.id]
            : undefined;
        const result = await callAgentWithFallback({
          agentId: agentConfig.id,
          systemPrompt,
          userContent,
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
          modelOverride: modelOverride as { provider: AgentTextProviderId; model: string } | undefined,
          options: { logger: console },
        });
        output = result.output;
        modelUsed = result.model;
        // Capture model wall-clock before SSE thought pacing (UI must show real think time).
        const modelLatencyMs = Date.now() - stepStart;
        // Real reasoning only: split + pace SSE so ThinkingReasoning can reveal sentence-by-sentence.
        if (opts.onThought && typeof result.reasoning === "string" && result.reasoning.trim()) {
          const sentences = splitReasoningSentences(result.reasoning);
          const gap = thoughtInterSentenceDelayMs(sentences.length);
          for (let index = 0; index < sentences.length; index++) {
            opts.onThought!(
              agentConfig.id,
              agentConfig,
              sentences[index],
              index,
              index === sentences.length - 1
            );
            if (index < sentences.length - 1) await sleepMs(gap);
          }
        }
        const step = {
          agent: agentConfig.id,
          agentName: agentConfig.name,
          agentIcon: agentConfig.icon,
          systemPrompt,
          input: agentInput,
          output,
          model: modelUsed,
          latencyMs: modelLatencyMs,
          timestamp: Date.now(),
          status: "completed" as const,
        };
        opts.onComplete?.(step);
        return step;
      } catch (error) {
        opts.onError?.(agentId, agentConfig, error);
        const message = error instanceof Error ? error.message : "Agent 调用失败";
        throw new Error(`${agentConfig.name} 真实模型调用失败：${message}`);
      }
    };
  }

  /** 自证子调用（原句自证，claimAtom 用）。 */
  function makeSelfProofCaller(claim: string, modelChoice: any) {
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
        modelOverride: modelChoice && modelChoice["fact_checker"] ? modelChoice["fact_checker"] : undefined,
        options: { logger: console },
      }).then((r) => ({ output: r.output, model: r.model }));
  }

  /** Evidence loop 语义改写（ADR-004）：裸模型调用 → makeRewriteQueryCall 绑定 prompt/解析。 */
  function makeRewriteCaller(modelChoice: any) {
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) =>
      callAgentWithFallback({
        agentId: "evidence_loop_rewriter",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        codexBin,
        reasoningEffort: "low",
        modelOverride:
          modelChoice && modelChoice["fact_checker"] ? modelChoice["fact_checker"] : undefined,
        options: { logger: console },
      }).then((r) => ({ output: r.output, model: r.model }));
  }

  // Cross exam 第二意见（G3/P1）：国产优先、与主判 provider 不同源（真双模型交叉）。
  function pickCrossExamModel(
    modelChoice: any
  ): { provider: AgentTextProviderId; model: string } | undefined {
    if (modelChoice && modelChoice["cross_examiner"]) return modelChoice["cross_examiner"];
    const candidates: Array<{ provider: AgentTextProviderId; model: string; hasKey: boolean }> = [
      { provider: "stepfun", model: "step-3.7-flash", hasKey: Boolean(env.STEPFUN_API_KEY) },
      { provider: "minimax", model: "MiniMax-M3", hasKey: Boolean(env.MINIMAX_API_KEY || env.MINIMAX_TOKEN_PLAN_KEY) },
      { provider: "mimo", model: "mimo-v2.5-pro", hasKey: Boolean(env.MIMO_API_KEY) },
    ].filter(
      (c): c is { provider: AgentTextProviderId; model: string; hasKey: boolean } => c.hasKey
    );
    if (candidates.length === 0) return undefined;
    const primary = providerOrderForAgent(env).find((p) => p !== "codex");
    return candidates.find((c) => c.provider !== primary) ?? candidates[0];
  }

  function makeCrossExamCaller(modelChoice: any, sendAgentEvent?: (data: object) => void) {
    const modelOverride = pickCrossExamModel(modelChoice);
    if (!modelOverride) return undefined;
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) => {
      sendAgentEvent?.({
        type: "agent_start",
        agent: "cross_examiner",
        agentName: "CrossExaminer",
        query: "第二模型独立复核冲突证据",
        timestamp: Date.now(),
      });
      return callAgentWithFallback({
        agentId: "cross_examiner",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        codexBin,
        reasoningEffort: "high",
        modelOverride,
        options: { logger: console },
      })
        .then((r) => {
          sendAgentEvent?.({
            type: "agent_complete",
            agent: "cross_examiner",
            agentName: "CrossExaminer",
            output: r.output,
            model: r.model,
            timestamp: Date.now(),
          });
          return { output: r.output, model: r.model };
        })
        .catch((error) => {
          sendAgentEvent?.({
            type: "agent_error",
            agent: "cross_examiner",
            agentName: "CrossExaminer",
            error: error instanceof Error ? error.message : "cross examiner failed",
            timestamp: Date.now(),
          });
          throw error;
        });
    };
  }

  return { makeRunAgent, makeSelfProofCaller, makeRewriteCaller, makeCrossExamCaller };
}