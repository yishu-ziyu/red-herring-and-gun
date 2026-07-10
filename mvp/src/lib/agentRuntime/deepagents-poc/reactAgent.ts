/**
 * deepagents-poc/reactAgent.ts
 *
 * The core React Agent loop: LLM → Tool Call → Tool Execute → LLM → Final Output.
 *
 * This mirrors the LangChain "createReactAgent" pattern:
 *   1. Call LLM with current messages
 *   2. If LLM returns tool calls, execute them and append results
 *   3. Loop back to LLM with tool results
 *   4. When LLM returns text without tool calls, that's the final output
 */

import type { AgentMessage, LLMResponse } from "./types";

export interface AgentToolExecutor {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ReactAgentOptions {
  systemPrompt: string;
  maxIterations: number;
  onStepComplete?: (step: number, messages: AgentMessage[]) => void;
}

export interface ReactAgentRunResult {
  messages: AgentMessage[];
  steps: ReactAgentStep[];
  finalOutput?: Record<string, unknown>;
}

export interface ReactAgentStep {
  stepNumber: number;
  llmResponse: LLMResponse;
  toolExecutions?: Array<{
    toolName: string;
    args: Record<string, string>;
    result: Record<string, unknown>;
  }>;
}

export async function runReactAgent(
  claim: string,
  llm: { invoke: (messages: AgentMessage[]) => Promise<LLMResponse> },
  tools: AgentToolExecutor[],
  options: ReactAgentOptions
): Promise<ReactAgentRunResult> {
  const messages: AgentMessage[] = [
    { role: "system", content: options.systemPrompt },
    {
      role: "user",
      content: `分析以下声明：\n\n${claim}\n\n请按 JSON 格式输出分析结果。如果需要搜索证据，调用 search_360 工具。`,
    },
  ];

  const steps: ReactAgentStep[] = [];
  let iteration = 0;

  while (iteration < options.maxIterations) {
    iteration++;
    const stepNumber = iteration;

    // Step 1: Call LLM
    const llmResponse = await llm.invoke(messages);

    // Append assistant message with tool calls or content
    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: llmResponse.content,
    };
    if (llmResponse.toolCalls?.length) {
      assistantMsg.toolCalls = llmResponse.toolCalls;
    }
    messages.push(assistantMsg);

    const step: ReactAgentStep = { stepNumber, llmResponse };

    // Step 2: If there are tool calls, execute them and feed results back
    if (llmResponse.toolCalls?.length) {
      step.toolExecutions = [];

      for (const tc of llmResponse.toolCalls) {
        const tool = tools.find((t) => t.name === tc.name);
        const result = await tool?.execute(tc.arguments) ?? { error: `Unknown tool: ${tc.name}` };
        step.toolExecutions.push({ toolName: tc.name, args: tc.arguments, result });

        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: tc.id,
        });
      }
    } else {
      // No tool calls = final answer
      try {
        const parsed = JSON.parse(llmResponse.content);
        steps.push(step);
        options.onStepComplete?.(stepNumber, messages);
        return { messages, steps, finalOutput: parsed };
      } catch {
        steps.push(step);
        options.onStepComplete?.(stepNumber, messages);
        return { messages, steps, finalOutput: { raw: llmResponse.content } };
      }
    }

    steps.push(step);
    options.onStepComplete?.(stepNumber, messages);
  }

  return { messages, steps };
}
