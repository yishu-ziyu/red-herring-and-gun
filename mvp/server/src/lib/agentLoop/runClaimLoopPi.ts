/**
 * runClaimLoopPi.ts — Agent Loop（pi 驱动）的核查编排。
 *
 * 与 runClaimLoop 同接口；执行引擎换成 pi-agent 会话：
 *   模型自由调度 web_search/todo_write → 提交 submit_verdict 草稿
 *   → 判决收束 100% 走 finalizeLoopReport（自证/URL 闸/公式分/publicCopy，纪律不动）。
 *
 * 事件映射：PiStreamItem → 现有 SSE 形状（agent_start / agent_thought / tool_start /
 * tool_result / agent_complete），过程可回看不变。
 */
import type { SelfProofModelCall } from "../claimAtom/index.js";
import { applyImageOriginToReport } from "../imageOrigin/index.js";
import { finalizeLoopReport } from "./gates.js";
import type { AgentLoopResult, LoopTodo } from "./types.js";
import { createPiCheckSession } from "../piBridge/piSession.js";

export const INVESTIGATOR_AGENT = "investigator";
export const INVESTIGATOR_NAME = "核查";

const MAX_TOOL_CALLS_DEFAULT = 40;

function urlFromSearchUrls(urls: string[]): Array<{ url: string; title: string; snippet: string }> {
  return urls
    .filter((u) => /^https?:\/\//i.test(u))
    .map((u) => ({ url: u, title: u, snippet: "" }));
}

export async function runClaimLoopPi(input: {
  claim: string;
  env: Record<string, string>;
  systemPrompt?: string;
  callSelfProofModel?: SelfProofModelCall;
  onEvent?: (data: object) => void;
  maxToolCalls?: number;
  /** 截图原图闸：与 casePipeline 同策略，reverse-image 命中才可写原图出处。 */
  lookupImageOrigin?: () => Promise<import("../imageOrigin/imageOrigin.js").ImageOriginResult>;
}): Promise<{
  finalReport: Record<string, unknown>;
  todos: LoopTodo[];
  stopReason: string;
  turns: number;
}> {
  const startedAt = Date.now();
  const todoItems: string[] = [];
  const emit = (data: object) => input.onEvent?.(data);

  emit({ type: "agent_start", agent: INVESTIGATOR_AGENT, agentName: INVESTIGATOR_NAME, timestamp: Date.now() });

  const pi = await createPiCheckSession({
    env: input.env,
    systemPrompt: input.systemPrompt,
    onTodo: (item) => todoItems.push(item),
  });

  try {
    let toolCallsSeen = 0;
    // 预算器：工具调用次数上限，超限即停并显式上报。
    const budgetStop = { hit: false };
    pi.session.subscribe((event: { type: string; [key: string]: unknown }) => {
      if (!/tool_execution_start|tool_execution_begin/i.test(event.type)) return;
      const kind = String((event as { toolName?: string }).toolName ?? "");
      toolCallsSeen += 1;
      if (toolCallsSeen > (input.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT)) {
        budgetStop.hit = true;
        return;
      }
      emit({
        type: "tool_start",
        agent: INVESTIGATOR_AGENT,
        agentName: INVESTIGATOR_NAME,
        toolId: kind,
        toolName: kind,
        timestamp: Date.now(),
      });
    });

    // 用户消息
    const userMessage = `请核查这句话：\n${input.claim}\n\n用 web_search 找公开出处（官方回应/辟谣/原始来源）。找完调用 submit_verdict 提交判定草稿。`;
    await pi.session.prompt(userMessage);

    // 事件流回放：把归一化事件转成 SSE（thought / tool_result 等）
    for (const ev of pi.events) {
      if (ev.kind === "delta" && ev.text) {
        emit({ type: "agent_thought", agent: INVESTIGATOR_AGENT, agentName: INVESTIGATOR_NAME, content: ev.text, seq: 0, done: false, partial: true, timestamp: Date.now() });
      } else if (ev.kind === "tool_result" && ev.toolName) {
        emit({ type: "tool_result", agent: INVESTIGATOR_AGENT, agentName: INVESTIGATOR_NAME, toolId: ev.toolName, toolName: ev.toolName, timestamp: Date.now() });
      }
    }

    const submitted = pi.getSubmittedVerdict();
    const stopReason: AgentLoopResult["stopReason"] = submitted ? "submit_verdict" : "no_tool";
    if (budgetStop.hit) {
      emit({ type: "tool_error", agent: INVESTIGATOR_AGENT, agentName: INVESTIGATOR_NAME, error: `工具调用超过预算 ${input.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT} 次`, timestamp: Date.now() });
    }

    const loop: AgentLoopResult = {
      messages: [],
      turns: toolCallsSeen,
      stopReason: budgetStop.hit ? "max_turns" : stopReason,
      terminalArgs: submitted,
      toolTrace: pi.searchUrls.map((url) => ({
        name: "web_search",
        arguments: { query: "" },
        result: { url, sources: urlFromSearchUrls([url]) },
      })),
      lastText: pi.events.filter((e) => e.kind === "delta").map((e) => (e.kind === "delta" ? e.text : "")).join("").slice(0, 16000),
    };

    const finalReport = await finalizeLoopReport({
      claim: input.claim,
      loop,
      callSelfProofModel: input.callSelfProofModel,
    });

    // 截图原图闸：与 casePipeline 同策略，命中才可写原图出处；未命中写「原图没查到」。
    if (input.lookupImageOrigin) {
      let origin: import("../imageOrigin/imageOrigin.js").ImageOriginResult | undefined;
      try {
        origin = await input.lookupImageOrigin();
      } catch {
        origin = undefined;
      }
      if (origin) applyImageOriginToReport(finalReport, origin);
    }

    emit({ type: "agent_complete", agent: INVESTIGATOR_AGENT, agentName: INVESTIGATOR_NAME, latencyMs: Date.now() - startedAt, timestamp: Date.now() });

    return {
      finalReport,
      todos: todoItems.map((label, index) => ({ id: `todo-${index}`, label, status: "done" as const })),
      stopReason: loop.stopReason,
      turns: loop.turns,
    };
  } finally {
    pi.dispose();
  }
}