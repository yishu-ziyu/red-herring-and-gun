import type { SelfProofModelCall } from "../claimAtom/index.js";
import { finalizeLoopReport } from "./gates.js";
import { INVESTIGATOR_SYSTEM_PROMPT } from "./prompt.js";
import { runAgentLoop } from "./runAgentLoop.js";
import { compactSearchResult, createLoopTools, type SearchFn } from "./tools.js";
import type { LoopLlm, LoopObserver, LoopTodo, ToolCall } from "./types.js";

export const INVESTIGATOR_AGENT = "investigator";
export const INVESTIGATOR_NAME = "核查";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function queryOf(call: ToolCall): string {
  if (typeof call.arguments.query === "string") return call.arguments.query;
  if (typeof call.arguments.url === "string") return call.arguments.url;
  if (call.name === "todo_write") return "任务板";
  if (call.name === "submit_verdict") return "收束判断";
  return call.name;
}

function sseObserver(onEvent: (data: object) => void, startedAt: number): LoopObserver {
  return {
    onLoopStart: () => {
      onEvent({
        type: "agent_start",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        timestamp: Date.now(),
      });
    },
    onThinking: (text) => {
      const content = text.trim();
      if (!content) return;
      onEvent({
        type: "agent_thought",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        content,
        seq: 0,
        done: false,
        partial: true,
        timestamp: Date.now(),
      });
    },
    onToolStart: (call) => {
      onEvent({
        type: "tool_start",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        toolId: call.name,
        toolName: call.name,
        query: queryOf(call),
        timestamp: Date.now(),
      });
    },
    onToolResult: (call, result) => {
      const rec = asRecord(result);
      onEvent({
        type: "tool_result",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        toolId: call.name,
        toolName: call.name,
        query: queryOf(call),
        result: call.name === "web_search" ? compactSearchResult(rec) : rec,
        timestamp: Date.now(),
      });
    },
    onToolError: (call, error) => {
      onEvent({
        type: "tool_error",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        toolId: call.name,
        toolName: call.name,
        query: queryOf(call),
        error,
        timestamp: Date.now(),
      });
    },
    onLoopEnd: () => {
      onEvent({
        type: "agent_complete",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        latencyMs: Date.now() - startedAt,
        timestamp: Date.now(),
      });
    },
  };
}

export async function runClaimLoop(input: {
  claim: string;
  search: SearchFn;
  callLlm: LoopLlm;
  callSelfProofModel?: SelfProofModelCall;
  onEvent?: (data: object) => void;
  maxTurns?: number;
}): Promise<{
  finalReport: Record<string, unknown>;
  todos: LoopTodo[];
  stopReason: string;
  turns: number;
}> {
  const allowedUrls = new Set<string>();
  const todos = { current: [] as LoopTodo[] };
  const startedAt = Date.now();
  const tools = createLoopTools({
    search: input.search,
    allowedUrls,
    todos,
  });
  const loop = await runAgentLoop({
    systemPrompt: INVESTIGATOR_SYSTEM_PROMPT,
    userMessage: `请核查：\n${input.claim}`,
    tools,
    callLlm: input.callLlm,
    observers: input.onEvent ? sseObserver(input.onEvent, startedAt) : undefined,
    maxTurns: input.maxTurns,
  });
  const finalReport = await finalizeLoopReport({
    claim: input.claim,
    loop,
    callSelfProofModel: input.callSelfProofModel,
  });
  return {
    finalReport,
    todos: todos.current,
    stopReason: loop.stopReason,
    turns: loop.turns,
  };
}
