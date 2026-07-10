/**
 * deepagents-poc/rumorDetectorAgent.ts
 *
 * RumorDetector React Agent — wires the React Agent loop
 * with the existing system prompt from agentConfigs.ts.
 *
 * This is the agent entry point that demonstrates:
 *   React Agent loop (LLM → tool call → tool result → LLM → final output)
 */

import type { RumorDetectorOutput } from "./types";
import { runReactAgent } from "./reactAgent";
import { createMockLLM, createSearch360Tool } from "./mockLLM";

const SYSTEM_PROMPT = `你是红鲱鱼与枪的 RumorDetector（谣言特征检测专家）。
你的工作方式像侦探立案：先观察语言痕迹，拆出可验证命题，只记录证据需求，不凭常识补事实。
你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题，再识别其中可能存在的谣言特征和谣言类型。

你需要检测以下类型的谣言特征：
1. 绝对化表述 — 使用「一定」「绝对」「100%」「所有」等极端词汇
2. 匿名信源 — 使用「内部消息」「知情人士」「独家爆料」等无法核实的来源
3. 恐惧诉求 — 利用「致癌」「中毒」「致死」等词汇制造恐慌
4. 情绪煽动 — 使用「震惊」「疯了」「愤怒」等强烈情绪词汇
5. 模糊引用 — 引用「科学家说」「研究表明」但不指明具体来源
6. 煽动传播 — 要求「赶紧转发」「不转不是」等
7. 阴谋论暗示 — 暗示「幕后黑手」「真相被掩盖」
8. 虚假紧迫性 — 使用「倒计时」「最后机会」等制造虚假紧迫感

评估严重程度：
- high：检测到 4 个及以上谣言特征
- medium：检测到 2-3 个谣言特征
- low：检测到 1 个谣言特征

关键边界：你此时没有联网搜索结果。不得写"已知事实""实际上"等外部事实判断；只能说"需要验证 X"。
analysis 必须聚焦语言风险、命题结构和证据需求；不得补充 claim 之外的现实背景。

输出要求（严格 JSON 格式，不要 Markdown，不要代码块）：
{
  "claimAtoms": ["可核查原子命题1"],
  "rumorTypes": ["社会"],
  "rumorIndicators": ["谣言特征1", "谣言特征2"],
  "severity": "medium",
  "analysis": "详细分析说明",
  "detectedPatterns": ["匹配的模式1", "匹配的模式2"],
  "neededEvidence": ["需要查找的证据类型"],
  "handoffTargets": ["fact_checker", "source_validator"]
}

handoffTargets 可包含 fact_checker、source_validator、report_composer，但不得直接跳到 report_composer。
severity 必须是 'low'、'medium'、'high' 之一。`;

export interface RumorDetectorAgentOptions {
  claim: string;
  onStepComplete?: (step: number, messages: unknown[]) => void;
}

export interface RumorDetectorResult {
  claim: string;
  output: RumorDetectorOutput;
  trace: ReactAgentTrace[];
}

export interface ReactAgentTrace {
  step: number;
  type: "llm" | "tool_call" | "tool_result" | "final";
  detail: Record<string, unknown>;
}

export async function runRumorDetector(
  options: RumorDetectorAgentOptions
): Promise<RumorDetectorResult> {
  const { claim, onStepComplete } = options;

  const mockLLM = createMockLLM();
  const searchTool = createSearch360Tool();

  const trace: ReactAgentTrace[] = [];

  const wrappedOnStep = (step: number, messages: unknown[]) => {
    const lastMsg = messages[messages.length - 1] as { role?: string; content?: string; toolCalls?: unknown[] };
    if (lastMsg?.role === "assistant" && lastMsg.toolCalls?.length) {
      trace.push({
        step,
        type: "tool_call",
        detail: { toolCalls: lastMsg.toolCalls },
      });
    }
    if (lastMsg?.role === "tool") {
      trace.push({
        step,
        type: "tool_result",
        detail: { result: lastMsg.content },
      });
    }
    onStepComplete?.(step, messages);
  };

  const result = await runReactAgent(claim, mockLLM, [searchTool], {
    systemPrompt: SYSTEM_PROMPT,
    maxIterations: 4,
    onStepComplete: wrappedOnStep,
  });

  trace.push({
    step: result.steps.length,
    type: "final",
    detail: { output: result.finalOutput },
  });

  return {
    claim,
    output: result.finalOutput as RumorDetectorOutput,
    trace,
  };
}
