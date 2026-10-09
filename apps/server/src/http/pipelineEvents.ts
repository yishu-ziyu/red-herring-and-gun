/**
 * 管线事件 → SSE 帧：agent 四帧、检索与追索、复核，以及 BYO fail-closed 的报告工厂。
 * 事件名与载荷字节级不变。
 */
import type { AtomSearchBundle } from "../lib/atomSearch.js";
import type { CasePipelineHooks, CasePipelineInput, PipelineStep, RunAgentFn } from "../lib/casePipeline/index.js";
import type { InvestigationSnapshotV1 } from "../lib/investigation/index.js";
import type { createInvestigationEmitter } from "../lib/investigationEmitter.js";
import { ByoKeyError } from "../lib/orchestrateByo.js";
import { runReportComposerWithFallback } from "../lib/reportFallback.js";
import { getSearchToolName } from "../lib/searchProviders.js";
import { toFriendlyError } from "./publicStream.js";

function makeReportRunner(runAgent: RunAgentFn) {
  return async ({
    claim,
    steps,
    search360Result,
    atomSearchBundle,
    onFallback,
    signal,
    deadlineMs,
  }: {
    claim: string;
    steps: PipelineStep[];
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
    onFallback?: (step: PipelineStep) => void;
    signal?: AbortSignal;
    deadlineMs?: number;
  }) =>
    runReportComposerWithFallback({
      claim,
      steps,
      search360Result,
      runAgent: (agentId, s, search, execution) => runAgent(agentId, s as PipelineStep[], search, atomSearchBundle, execution),
      onFallback,
      signal,
      deadlineMs,
    });
}

/**
 * BYO fail-closed 报告工厂：包装 makeReportRunner，密钥失败时抛出阻断收尾，不静默回退 env 密钥。
 */
export function makeRunReport(
  runAgent: RunAgentFn,
  byo: { modelName?: string } | undefined,
  byoFail: AbortController,
  sendEvent: (data: object) => void
): CasePipelineInput["runReport"] {
  return async (args) => {
    const reportStep = await makeReportRunner(runAgent)({
      ...args,
      onFallback: (step) => {
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
    });
    // BYO fail-closed：密钥失败引发的报告兜底不算完成，抛出触发错误收尾，
    // 绝不把确定性兜底报告冒充成功结果，也绝不回退 env 密钥重烧一遍。
    if (byo && byoFail.signal.aborted) {
      throw byoFail.signal.reason instanceof Error
        ? byoFail.signal.reason
        : new ByoKeyError("你保存的模型密钥调用失败，这次核查已停止。");
    }
    return reportStep;
  };
}

/**
 * Agent 事件回调工厂：把 agent_start / agent_thought / agent_complete / agent_error 四帧
 * 的 sendEvent 调用聚在一起，入口主体只传给 byoAdapter.makeRunAgent。
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
  claim: string;
  sendEvent: (data: object) => void;
  emitInvestigation: (snapshot: InvestigationSnapshotV1) => void;
  emitter: ReturnType<typeof createInvestigationEmitter>;
  searchesCounter: { current: number };
}): CasePipelineHooks {
  const { claim, sendEvent, emitInvestigation, emitter, searchesCounter } = ctx;
  return {
    searchMode: "sequential",
    onInvestigationSnapshot: (snapshot) => {
      emitInvestigation(snapshot);
    },
    onSelfProof: (info) => {
      console.log(
        `[agent_self_proof] claim=${JSON.stringify(claim).slice(0, 120)} kept=${info.kept.length} dropped=${info.dropped.length}`
      );
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
    onEvidenceLoopRoundStart: (info) => {
      searchesCounter.current += 1;
      sendEvent({
        type: "tool_start",
        toolName: "证据追索",
        query: info.query,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          round: info.round,
          goal: info.goal,
          purpose: info.purpose,
          missingEvidence: info.missingEvidence,
          trigger: info.trigger,
        },
        timestamp: Date.now(),
      });
    },
    onEvidenceLoopRoundResult: (info) => {
      sendEvent({
        type: "tool_result",
        toolName: "证据追索",
        query: info.query,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          round: info.round,
          sourceCount: info.sourceCount,
          newSourceCount: info.newSourceCount,
          goal: info.goal,
          purpose: info.purpose,
          resultKind: info.resultKind,
          gain: info.gain,
          missingAfter: info.missingAfter,
          action: info.action,
          detail: info.detail,
        },
        timestamp: Date.now(),
      });
    },
    onEvidenceLoopStopped: (info) => {
      const reasonText: Record<string, string> = {
        "evidence-found": "缺口收窄，转入重判",
        "no-new-evidence": "继续搜也没有新证据，判停",
        "rewrite-empty": "没有可用的新查询，判停",
        "search-failed": "补查检索失败，判停",
      };
      sendEvent({
        type: "tool_result",
        toolName: "证据追索",
        query: info.atom,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          rounds: info.rounds,
          reason: info.reason,
          reasonText: reasonText[info.reason] ?? info.reason,
        },
        timestamp: Date.now(),
      });
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
