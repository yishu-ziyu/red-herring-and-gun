/**
 * orchestrate.ts — 多 Agent Orchestrate 编排适配层（从 handlers 抽出）。
 *
 * 职责：把 claim + 检索结果 组装成单个 Agent 调用（状态栏 / 按需 Skills / 模型 fallback /
 * 思考句流式）。纯编排，不含 HTTP。
 * handlers 只做接线：注入 env / 模型路由 / 工具函数，拿到工厂产物回调。
 */
import { createHash } from "node:crypto";
import { RunRecordingError, type RunRecorder } from "./runRecorder.js";
import { AGENT_JOBS, buildJobCall, runJob, type AgentJob } from "./agents/index.js";
import type { RunAgentFn } from "./casePipeline/runCasePipeline.js";


/** 把模型的思考文本切成显示用的句子（中英文标点与换行）；只用模型原文，不编句子。 */
function splitReasoningSentences(reasoning: string): string[] {
  const trimmed = (reasoning ?? "").trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

interface OrchestrateAdapterDeps {
  signal?: AbortSignal;
  deadlineMs?: number;
  env: Record<string, string>;
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
    priorRoundContext?: unknown;
    recorder?: RunRecorder;
    onStart?: (agentId: string, job: AgentJob) => void;
    onThought?: (
      agentId: string,
      job: AgentJob,
      content: string,
      seq: number,
      done: boolean
    ) => void;
    onComplete?: (step: any) => void;
    onError?: (agentId: string, job: AgentJob, error: unknown) => void;
  }): RunAgentFn {
    return async function runAgent(agentId, steps, searchResult?, atomSearchBundle?, execution = {}) {
      const signal = execution.signal && deps.signal
        ? AbortSignal.any([execution.signal, deps.signal]) : execution.signal ?? deps.signal;
      signal?.throwIfAborted();
      const job = AGENT_JOBS.find((a) => a.id === agentId);
      if (!job) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      opts.onStart?.(agentId, job);
      const stepStart = Date.now();
      const call = buildJobCall(job, {
        claim: opts.claim,
        steps,
        intakeMetadata: opts.intakeMetadata,
        visualExtraction: opts.visualExtraction,
        memoryRecall: opts.clientMemoryRecall,
        priorRoundContext: opts.priorRoundContext,
        searchResult,
        atomSearchBundle,
      });
      const { input: agentInput, systemPrompt, userContent } = call;

      // This records one stage attempt; provider retries and JSON repair may occur inside it.
      const attemptId = opts.recorder?.startAttempt({
        stage: agentId, input: { systemPrompt, userContent, responseSchema: job.schema },
        metadata: { granularity: "stage", systemPromptHash: createHash("sha256").update(systemPrompt).digest("hex") },
      });
      let attemptFinished = false;
      let output: Record<string, unknown>;
      let modelUsed: string;
      let reasoning: string | undefined;
      try {
        const result = await runJob(job, call, {
          env,
          signal,
          deadlineMs: deadlineFor(execution.deadlineMs),
        });
        if (attemptId) {
          opts.recorder!.finishAttempt(attemptId, { status: "succeeded", output: result.raw, model: result.model });
          attemptFinished = true;
        }
        output = result.output;
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
              job.id,
              job,
              sentences[index],
              index,
              index === sentences.length - 1
            );
          }
        }
        const step = {
          agent: job.id,
          agentName: job.name,
          agentIcon: job.icon,
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
        if (error instanceof RunRecordingError) throw error;
        if (attemptId && !attemptFinished) opts.recorder!.finishAttempt(attemptId, {
          status: signal?.aborted ? "cancelled" : "failed",
          error: error instanceof Error ? error.message : "Agent 调用失败",
        });
        signal?.throwIfAborted();
        opts.onError?.(agentId, job, error);
        const message = error instanceof Error ? error.message : "Agent 调用失败";
        throw new Error(`${job.name} 真实模型调用失败：${message}`);
      }
    };
  }

  return { makeRunAgent };
}
