/**
 * orchestrate.ts — 多 Agent Orchestrate 编排适配层（从 handlers 抽出）。
 *
 * 职责：把 claim + 检索结果 组装成单个 Agent 调用（状态栏 / 按需 Skills / 模型 fallback /
 * 思考句流式）。纯编排，不含 HTTP。
 * handlers 只做接线：注入 env / 模型路由 / 工具函数，拿到工厂产物回调。
 */
import {
  AGENT_CONFIGS,
  buildAgentInput,
} from "./agentConfigs.js";
import { buildAgentStatusBar } from "./contextStatusBar.js";
import { isLabelKey, verdictForLabel } from "../domain/labels.js";
import { formatSkillsForPrompt, selectAgentSkills } from "./agentSkills.js";
import { callAgentWithFallback } from "./providerRouter.js";
import { compactSearchResultForAgent } from "./searchProviders.js";
import { attachKnowledgeDrafts } from "./atomSearch.js";
import { splitReasoningSentences } from "./reasoningThoughts.js";
import type { RunAgentFn } from "./casePipeline/index.js";


/**
 * 模型给每一截的 verdict 现在是 9 个标签之一（domain/labels）。流水线里读 verdict 的地方
 * （引用绑定、规则表）仍按旧判词工作：这里把标签挪到 label，verdict 换成旧判词。
 */
function withLegacyVerdicts(output: Record<string, unknown>): Record<string, unknown> {
  if (!output || !Array.isArray(output.subclaimVerdicts)) return output;
  output.subclaimVerdicts = output.subclaimVerdicts.map((item: unknown) => {
    if (!item || typeof item !== "object") return item;
    const rec = item as Record<string, unknown>;
    if (!isLabelKey(rec.verdict)) return rec;
    return { ...rec, label: rec.verdict, verdict: verdictForLabel(rec.verdict) };
  });
  return output;
}

export interface OrchestrateAdapterDeps {
  signal?: AbortSignal;
  deadlineMs?: number;
  env: Record<string, string>;
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
  const { env } = deps;
  const deadlineFor = (deadline?: number) => Math.min(deadline ?? Infinity, deps.deadlineMs ?? Infinity);

  /** 单个 Agent 调用：组装输入 → LLM fallback → 结果 step。 */
  function makeRunAgent(opts: {
    claim: string;
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
    return async function runAgent(agentId, steps, search360Result?, atomSearchBundle?, execution = {}) {
      const signal = execution.signal && deps.signal
        ? AbortSignal.any([execution.signal, deps.signal]) : execution.signal ?? deps.signal;
      signal?.throwIfAborted();
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
      if (search360Result && ["fact_checker", "source_validator"].includes(agentId)) {
        agentInput.search360 = compactSearchResultForAgent(search360Result);
        if (atomSearchBundle) {
          agentInput.atomSearches = atomSearchBundle.forAgent;
        }
      }
      if (atomSearchBundle && ["fact_checker", "source_validator"].includes(agentId)) {
        attachKnowledgeDrafts(agentInput, atomSearchBundle);
      }

      // Book Ch.2：状态栏 + 按需 Skills
      const claimType = inferClaimTypeForSkills(steps as any) ?? "mixed";
      const memoryRecall = opts.clientMemoryRecall as
        | { hitCount?: number }
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
      let reasoning: string | undefined;
      try {
        const result = await callAgentWithFallback({
          agentId: agentConfig.id,
          systemPrompt,
          userContent,
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          reasoningEffort: "high",
          options: { logger: console, signal, deadlineMs: deadlineFor(execution.deadlineMs) },
        });
        output = withLegacyVerdicts(result.output);
        signal?.throwIfAborted();
        modelUsed = result.model;
        reasoning = result.reasoning;
        // Capture model wall-clock before SSE thought pacing (UI must show real think time).
        const modelLatencyMs = Date.now() - stepStart;
        // Report actual reasoning without delaying evidence publication for display pacing.
        if (opts.onThought && typeof reasoning === "string" && reasoning.trim()) {
          const sentences = splitReasoningSentences(reasoning);
          for (let index = 0; index < sentences.length; index++) {
            opts.onThought!(
              agentConfig.id,
              agentConfig,
              sentences[index],
              index,
              index === sentences.length - 1
            );
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
        signal?.throwIfAborted();
        opts.onError?.(agentId, agentConfig, error);
        const message = error instanceof Error ? error.message : "Agent 调用失败";
        throw new Error(`${agentConfig.name} 真实模型调用失败：${message}`);
      }
    };
  }

  return { makeRunAgent };
}
