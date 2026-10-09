/**
 * orchestrate.ts — 多 Agent Orchestrate 编排适配层（从 handlers 抽出）。
 *
 * 职责：把 claim + 检索结果 组装成单个 Agent 调用（状态栏 / 按需 Skills / 模型 fallback /
 * 思考句流式），以及自证 / 改写 / 交叉二审三个子调用器。纯编排，不含 HTTP。
 * handlers 只做接线：注入 env / 模型路由 / 工具函数，拿到工厂产物回调。
 */
import {
  AGENT_CONFIGS,
  buildAgentInput,
} from "./agentConfigs.js";
import { buildAgentStatusBar } from "./contextStatusBar.js";
import { isLabelKey, verdictForLabel } from "../domain/labels.js";
import { formatSkillsForPrompt, selectAgentSkills } from "./agentSkills.js";
import {
  callAgentWithFallback,
  providerOrderForAgent,
  AgentTextProviderId,
} from "./providerRouter.js";
import { compactSearchResultForAgent, buildReportEvidenceInputs } from "./searchProviders.js";
import { attachKnowledgeDrafts } from "./atomSearch.js";
import { splitReasoningSentences } from "./reasoningThoughts.js";
import { getTimeoutMs } from "./httpUtils.js";
import type { RunAgentFn } from "./casePipeline/index.js";


/**
 * 模型给每一截的 verdict 现在是 9 个标签之一（domain/labels）。流水线里读 verdict 的地方
 * （补查、质询、引用绑定、规则表）仍按旧判词工作：这里把标签挪到 label，verdict 换成旧判词。
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
  const requestOptions = () => ({ logger: console, signal: deps.signal, deadlineMs: deps.deadlineMs });

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
      if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        agentInput.search360 = compactSearchResultForAgent(search360Result);
        if (atomSearchBundle && (agentId === "fact_checker" || agentId === "source_validator" || agentId === "report_composer")) {
          agentInput.atomSearches = atomSearchBundle.forAgent;
        }
      }
      if (atomSearchBundle && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        attachKnowledgeDrafts(agentInput, atomSearchBundle);
      }
      if (agentId === "report_composer") {
        agentInput.evidenceInputs = buildReportEvidenceInputs(steps as any, search360Result);
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

  /**
   * 自证阶段硬预算（主路 P1 Change H）
   * 真实走查实证：没有阶段预算时，minimax 自证单次烧 84.9 秒才报错降级，stepfun 再跟两次，
   * 合计 111 秒（加上前面 rumor 的 29.3 秒 = 画面 141.4 秒没有任何新内容）。
   * 阶段总账由 deadlineMs 管，单次尝试由 attemptTimeoutCapMs 管（卡住的那家尽早让位给下一家）。
   */
  const SELF_PROOF_STAGE_BUDGET_MS_DEFAULT = 45_000;
  const SELF_PROOF_ATTEMPT_TIMEOUT_CAP_MS_DEFAULT = 25_000;

  /** 自证子调用（原句自证，claimAtom 用）。 */
  function makeSelfProofCaller() {
    let stageDeadline: number | undefined;
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) => {
      stageDeadline ??= deadlineFor(Date.now() + getTimeoutMs(env, "ORCHESTRATE_SELFPROOF_STAGE_BUDGET_MS", SELF_PROOF_STAGE_BUDGET_MS_DEFAULT));
      return callAgentWithFallback({
        agentId: "rumor_detector_selfproof",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        reasoningEffort: "low",
        options: {
          logger: console,
          signal: deps.signal,
          deadlineMs: stageDeadline,
          attemptTimeoutCapMs: getTimeoutMs(
            env,
            "ORCHESTRATE_SELFPROOF_ATTEMPT_TIMEOUT_CAP_MS",
            SELF_PROOF_ATTEMPT_TIMEOUT_CAP_MS_DEFAULT
          ),
        },
      }).then((r) => ({ output: r.output, model: r.model }));
    };
  }

  /** Evidence loop 语义改写（ADR-004）：裸模型调用 → makeRewriteQueryCall 绑定 prompt/解析。 */
  function makeRewriteCaller() {
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) => {
      return callAgentWithFallback({
        agentId: "evidence_loop_rewriter",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        reasoningEffort: "low",
        options: requestOptions(),
      }).then((r) => ({ output: r.output, model: r.model }));
    };
  }

  // Cross exam 第二意见（G3/P1）：国产优先、与主判 provider 不同源（真双模型交叉）。
  function pickCrossExamModel(): { provider: AgentTextProviderId; model: string } | undefined {
    const candidates: Array<{ provider: AgentTextProviderId; model: string; hasKey: boolean }> = [
      { provider: "stepfun", model: "step-3.7-flash", hasKey: Boolean(env.STEPFUN_API_KEY) },
      { provider: "minimax", model: "MiniMax-M3", hasKey: Boolean(env.MINIMAX_API_KEY) },
    ].filter(
      (c): c is { provider: AgentTextProviderId; model: string; hasKey: boolean } => c.hasKey
    );
    if (candidates.length === 0) return undefined;
    const primary = providerOrderForAgent(env)[0];
    return candidates.find((c) => c.provider !== primary) ?? candidates[0];
  }

  function makeCrossExamCaller(sendAgentEvent?: (data: object) => void) {
    const modelOverride = pickCrossExamModel();
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
        reasoningEffort: "high",
        modelOverride,
        options: requestOptions(),
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
            error: "独立复核未完成",
            timestamp: Date.now(),
          });
          throw error;
        });
    };
  }

  /** Whole-Claim Audit（Issue #78）：整句审计规划/评估的裸模型调用。实现层静默，不进 SSE Agent 日志。 */
  function makeWholeClaimAuditCaller() {
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) => {
      return callAgentWithFallback({
        agentId: "whole_claim_auditor",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        reasoningEffort: "low",
        options: requestOptions(),
      }).then((r) => ({ output: r.output, model: r.model }));
    };
  }

  return { makeRunAgent, makeSelfProofCaller, makeRewriteCaller, makeCrossExamCaller, makeWholeClaimAuditCaller };
}
