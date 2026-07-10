/**
 * deepagents-poc/mockLLM.ts
 *
 * A simulated LLM that performs tool calls deterministically,
 * then produces a final structured answer.
 *
 * Flow:
 *   1. First call: always returns a search_360 tool call
 *   2. Second call: returns a report_search360 tool call with the search result
 *   3. Third call: returns the final structured output
 */

import type { AgentMessage, LLMResponse, ToolCall } from "./types";

// ── Deterministic mock responses per claim ────────────────────

const FAKE_SEARCH_RESULTS = [
  {
    title: "WHO Fact Sheet - World Health Organization",
    url: "https://www.who.int/news-room/fact-sheets",
    snippet: "No peer-reviewed study has established a causal link between this claim and health outcomes.",
    credibilityScore: 90,
    stance: "contradicting",
  },
  {
    title: "知乎讨论 - 该话题的学术争议",
    url: "https://www.zhihu.com/question/discussion",
    snippet: "多位答主引用研究指出相关说法缺乏直接证据，仅为相关性而非因果性。",
    credibilityScore: 65,
    stance: "neutral",
  },
  {
    title: "百度知道 - 常见疑问",
    url: "https://zhidao.baidu.com/question/1234.html",
    snippet: "此说法已被多个官方辟谣平台标记为未证实。",
    credibilityScore: 45,
    stance: "supporting",
  },
];

function buildToolCall(id: string, name: string, args: Record<string, string>): ToolCall {
  return { id, name, arguments: args };
}

let globalTurn = 0;

export function createMockLLM(): { invoke: (messages: AgentMessage[]) => Promise<LLMResponse> } {
  return { invoke: mockInvoke };
}

async function mockInvoke(messages: AgentMessage[]): Promise<LLMResponse> {
  globalTurn++;
  await new Promise((r) => setTimeout(r, 80));

  const claim = extractClaim(messages);

  if (globalTurn <= 2) {
    return {
      content: globalTurn === 1
        ? "I need to search for evidence before forming a diagnosis."
        : "Let me do one more targeted search.",
      toolCalls: [
        buildToolCall(`tc-${globalTurn}`, "search_360", {
          query: globalTurn === 1
            ? `fact-check: "${claim}"`
            : `debunk: "${claim}" scientific evidence`,
          region: "zh-CN",
          limit: String(4 - globalTurn),
        }),
      ],
      stopReason: "tool_use",
    };
  }

  // Turn 3+: return final structured diagnosis
  const output = generateMockOutput(claim);
  return {
    content: JSON.stringify(output, null, 2),
    stopReason: "end_turn",
  };
}

function extractClaim(messages: AgentMessage[]): string {
  const userMsg = messages.find((m) => m.role === "user");
  if (!userMsg?.content) return "";
  // Strip the instruction prefix to get the raw claim
  const prefix = "分析以下声明：\n\n";
  const suffix = "\n\n请按 JSON 格式输出分析结果。如果需要搜索证据，调用 search_360 工具。";
  let text = userMsg.content;
  if (text.startsWith(prefix)) text = text.slice(prefix.length);
  if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
  return text.trim();
}

function generateMockOutput(claim: string): Record<string, unknown> {
  return {
    claimAtoms: [claim],
    rumorTypes: ["科技", "健康"],
    rumorIndicators: ["恐惧诉求", "模糊引用", "煽动传播"],
    severity: "medium",
    analysis: `声明"${claim}"包含多个高风险特征：使用绝对化语言制造恐慌，引用模糊来源，且未提供可验证的科学依据。需要进一步搜索以确认事实状态。`,
    detectedPatterns: ["恐惧诉求", "模糊引用"],
    neededEvidence: ["原始研究出处", "权威机构声明", "独立重复实验"],
    handoffTargets: ["fact_checker", "source_validator"],
  };
}

// ── Search 360 Mock Tool ───────────────────────────────────────

export interface Search360ToolResult {
  _source: "search360" | "tool-error";
  sources: typeof FAKE_SEARCH_RESULTS;
  answerPreview: string;
}

let searchCallCount = 0;

export function createSearch360Tool() {
  return {
    name: "search_360",
    description: "Mock 360 search - returns canned evidence",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        region: { type: "string" },
        limit: { type: "number" },
      },
    },

    async execute(args: Record<string, string>): Promise<Search360ToolResult> {
      await new Promise((r) => setTimeout(r, 80));
      searchCallCount++;
      return {
        _source: "search360",
        sources: FAKE_SEARCH_RESULTS,
        answerPreview: `搜索 [${args.query}] 返回 ${FAKE_SEARCH_RESULTS.length} 个结果。部分来源支持、部分反驳，需要人工研判。`,
      };
    },

    reset() {
      searchCallCount = 0;
    },
  };
}
