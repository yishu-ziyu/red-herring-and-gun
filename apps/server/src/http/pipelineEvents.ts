/**
 * 管线事件 → SSE 帧：agent 四帧、检索、复核。
 * 事件名与载荷字节级不变。
 */
import type { CasePipelineHooks } from "../lib/casePipeline/index.js";
import type { InvestigationSnapshotV1 } from "../lib/investigation/index.js";
import type { createInvestigationEmitter } from "../lib/investigationEmitter.js";
import { getSearchToolName } from "../lib/searchProviders.js";
import { toFriendlyError } from "./publicStream.js";

/**
 * Agent 事件回调工厂：把 agent_start / agent_thought / agent_complete / agent_error 四帧
 * 的 sendEvent 调用聚在一起，入口主体只传给 adapter.makeRunAgent。
 */
export function makeRunAgentCallbacks(sendEvent: (data: object) => void) {
  return {
    onStart: (agentId: string, agentConfig: { name: string; icon?: string; model?: string }) => {
      sendEvent({
        type: "agent_start",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        model: agentConfig.model || "",
        timestamp: Date.now(),
      });
    },
    onThought: (agentId: string, agentConfig: { name: string; icon?: string }, content: string, seq: number, done: boolean) => {
      sendEvent({
        type: "agent_thought",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        content,
        seq,
        done,
        timestamp: Date.now(),
      });
    },
    onComplete: (step: { agent: string; agentName: string; agentIcon?: string; output: unknown; model: string; latencyMs: number }) => {
      sendEvent({
        type: "agent_complete",
        agent: step.agent,
        agentName: step.agentName,
        agentIcon: step.agentIcon,
        output: step.output,
        model: step.model,
        latencyMs: step.latencyMs,
        timestamp: Date.now(),
      });
    },
    onError: (agentId: string, agentConfig: { name: string; icon?: string }, error: unknown) => {
      const { message } = toFriendlyError(error, "核查服务暂时不可用，请稍后重试");
      sendEvent({
        type: "agent_error",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        error: message,
        timestamp: Date.now(),
      });
    },
  };
}

/**
 * 管线观测钩子工厂：把 SSE 帧发送、活动账本、检索计数封装成 CasePipelineHooks。
 * 闭包变量显式传入，入口主体只写 hooks: makePipelineHooks(…)。
 * 事件名与载荷字节级不变——这里只改形状，不改语义。
 */
export function makePipelineHooks(ctx: {
  sendEvent: (data: object) => void;
  emitInvestigation: (snapshot: InvestigationSnapshotV1) => void;
  emitter: ReturnType<typeof createInvestigationEmitter>;
  searchesCounter: { current: number };
}): CasePipelineHooks {
  const { sendEvent, emitInvestigation, emitter, searchesCounter } = ctx;
  return {
    searchMode: "sequential",
    onInvestigationSnapshot: (snapshot) => {
      emitInvestigation(snapshot);
    },
    onAtomSearchStart: (atom) => {
      searchesCounter.current += 1;
      sendEvent({ type: "tool_start", toolName: "Atom Search", query: atom, timestamp: Date.now() });
      emitter.emitSearchStarted(atom);
    },
    onPriorRoundReuse: (hit) => {
      emitter.emitPriorRoundReuse(hit.originDate);
    },
    onAtomSearchResult: (atom, result) => {
      const searchToolName = getSearchToolName(result as any);
      if ((result as any)?._source === "tool-error") {
        sendEvent({
          type: "tool_error",
          toolName: searchToolName,
          query: atom,
          error: (result as any).traceText,
          result,
          timestamp: Date.now(),
        });
      } else {
        sendEvent({
          type: "tool_result",
          toolName: searchToolName,
          query: atom,
          model: (result as any)?.model,
          result,
          timestamp: Date.now(),
        });
      }
    },
    onReportReviewStart: (info) => {
      sendEvent({ type: "tool_start", toolName: info.toolName, query: info.query, timestamp: Date.now() });
    },
    onReportReviewResult: (info) => {
      sendEvent({
        type: "tool_result",
        toolName: info.toolName,
        query: info.query,
        result: { passed: info.passed, score: info.score, issues: info.issues, checks: info.checks },
        timestamp: Date.now(),
      });
    },
  };
}
