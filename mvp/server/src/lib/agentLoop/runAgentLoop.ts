import { mergeToolCalls } from "./parseToolCalls.js";
import type {
  AgentLoopResult,
  LoopLlm,
  LoopMessage,
  LoopObserver,
  LoopTool,
  ToolCall,
  ToolSpec,
} from "./types.js";

export const DEFAULT_MAX_TURNS = 16;
export const TERMINAL_TOOL = "submit_verdict";

function specsOf(tools: LoopTool[]): ToolSpec[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

function formatToolResults(
  rows: Array<{ call: ToolCall; result: unknown; error?: string }>
): string {
  return rows
    .map((row) => {
      const body = row.error
        ? { error: row.error }
        : row.result;
      return `${row.call.name} (${row.call.id}): ${JSON.stringify(body)}`;
    })
    .join("\n");
}

export async function runAgentLoop(input: {
  systemPrompt: string;
  userMessage: string;
  tools: LoopTool[];
  callLlm: LoopLlm;
  observers?: LoopObserver;
  maxTurns?: number;
  terminalTool?: string;
}): Promise<AgentLoopResult> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const terminal = input.terminalTool ?? TERMINAL_TOOL;
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const messages: LoopMessage[] = [{ role: "user", content: input.userMessage }];
  const toolTrace: AgentLoopResult["toolTrace"] = [];
  const observer = input.observers;

  observer?.onLoopStart?.();

  let lastText = "";
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    let llmTurn;
    let streamedThinking = false;
    try {
      llmTurn = await input.callLlm({
        systemPrompt: input.systemPrompt,
        messages,
        tools: specsOf(input.tools),
        onThinking: (text) => {
          streamedThinking = true;
          void observer?.onThinking?.(text, turn);
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型调用失败";
      const result: AgentLoopResult = {
        messages,
        turns: turn - 1,
        stopReason: "llm_error",
        toolTrace,
        lastText,
        error: message,
      };
      observer?.onLoopEnd?.(result);
      return result;
    }

    lastText = llmTurn.text ?? "";
    if (!streamedThinking && llmTurn.thinking?.trim()) {
      await observer?.onThinking?.(llmTurn.thinking, turn);
    }

    const assistantText = lastText || (llmTurn.thinking ? "" : "");
    const calls = mergeToolCalls(llmTurn);
    if (assistantText || calls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistantText || calls.map((c) => c.name).join(", "),
      });
    }

    if (calls.length === 0) {
      const alreadyNudged = messages.some(
        (msg) => msg.role === "user" && msg.content.includes("必须调用工具")
      );
      const alreadyForced = messages.some(
        (msg) => msg.role === "user" && msg.content.includes("现在只能 submit_verdict")
      );
      if (!alreadyNudged && turn < maxTurns) {
        messages.push({
          role: "user",
          content:
            "必须调用工具。证据不够就 web_search / web_fetch；任务已齐就立刻 submit_verdict，conclusion 写成研究备忘录 Markdown。不要只说话。",
        });
        continue;
      }
      if (!alreadyForced && turn < maxTurns) {
        messages.push({
          role: "user",
          content:
            "现在只能 submit_verdict。不要再 web_search 或 web_fetch。conclusion 用 Markdown 写研究备忘录，第一句加粗直接回答原问题。禁止用「能信 / 不能信 / 只能信一部分 / 还查不清」当第一句。",
        });
        continue;
      }
      const result: AgentLoopResult = {
        messages,
        turns: turn,
        stopReason: "no_tool",
        toolTrace,
        lastText,
      };
      observer?.onLoopEnd?.(result);
      return result;
    }

    const terminalCalls = calls.filter((c) => c.name === terminal);
    const workCalls = calls.filter((c) => c.name !== terminal);
    const ordered = [...workCalls, ...terminalCalls.slice(0, 1)];
    const rows: Array<{ call: ToolCall; result: unknown; error?: string }> = [];

    for (const call of ordered) {
      observer?.onToolStart?.(call);
      const tool = byName.get(call.name);
      if (!tool) {
        const error = `未知工具：${call.name}`;
        observer?.onToolError?.(call, error);
        rows.push({ call, result: { error }, error });
        toolTrace.push({ name: call.name, arguments: call.arguments, result: { error } });
        continue;
      }
      try {
        const result = await tool.execute(call.arguments ?? {});
        observer?.onToolResult?.(call, result);
        rows.push({ call, result });
        toolTrace.push({ name: call.name, arguments: call.arguments, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "工具失败";
        observer?.onToolError?.(call, message);
        rows.push({ call, result: { error: message }, error: message });
        toolTrace.push({
          name: call.name,
          arguments: call.arguments,
          result: { error: message },
        });
      }
      if (call.name === terminal) {
        const terminalRow = rows[rows.length - 1];
        const result: AgentLoopResult = {
          messages,
          turns: turn,
          stopReason: "submit_verdict",
          terminalArgs: call.arguments,
          toolTrace,
          lastText,
          error:
            terminalRow?.error ||
            (terminalRow?.result &&
            typeof terminalRow.result === "object" &&
            terminalRow.result &&
            "error" in terminalRow.result
              ? String((terminalRow.result as { error?: unknown }).error ?? "")
              : undefined),
        };
        observer?.onLoopEnd?.(result);
        return result;
      }
    }

    messages.push({
      role: "user",
      content: `工具结果：\n${formatToolResults(rows)}`,
    });
  }

  const result: AgentLoopResult = {
    messages,
    turns: maxTurns,
    stopReason: "max_turns",
    toolTrace,
    lastText,
  };
  observer?.onLoopEnd?.(result);
  return result;
}
