import { describe, expect, it } from "vitest";
import { runClaimLoop } from "./runClaimLoop";
import { runAgentLoop } from "./runAgentLoop";
import { createLoopTools } from "./tools";
import { wantsAgentLoop } from "./index";
import type { LoopLlm, LoopTodo } from "./types";

function scriptedLlm(turns: Array<{ text: string; thinking?: string }>): LoopLlm {
  let i = 0;
  return async ({ onThinking }) => {
    const turn = turns[i] ?? { text: "" };
    i += 1;
    if (turn.thinking) onThinking?.(turn.thinking);
    return turn;
  };
}

function xml(name: string, args: unknown): string {
  return `<tool_call>\n<name>${name}</name>\n<arguments>${JSON.stringify(args)}</arguments>\n</tool_call>`;
}

describe("wantsAgentLoop", () => {
  it("default off", () => {
    expect(wantsAgentLoop({ claim: "x" }, {})).toBe(false);
    expect(wantsAgentLoop({ execution: "pipeline" }, {})).toBe(false);
  });

  it("env or payload turns it on", () => {
    expect(wantsAgentLoop({}, { AGENT_LOOP: "1" })).toBe(true);
    expect(wantsAgentLoop({ execution: "loop" }, {})).toBe(true);
  });
});

describe("runAgentLoop", () => {
  it("thinks, searches, fetches, then submit_verdict", async () => {
    const allowedUrls = new Set<string>();
    const todos = { current: [] as LoopTodo[] };
    const searches: string[] = [];
    const fetched: string[] = [];
    const tools = createLoopTools({
      search: async (query) => {
        searches.push(query);
        return {
          sources: [{ url: "https://who.int/food", title: "WHO", snippet: "没有致癌结论" }],
        };
      },
      fetchPage: async (url) => {
        fetched.push(url);
        return { url, title: "WHO", text: "隔夜菜加热不会致癌。" };
      },
      allowedUrls,
      todos,
    });

    const result = await runAgentLoop({
      systemPrompt: "test",
      userMessage: "隔夜菜加热会致癌",
      tools,
      maxTurns: 6,
      callLlm: scriptedLlm([
        {
          thinking: "先拆成能不能核的判断。",
          text: [
            xml("todo_write", {
              todos: [
                { id: "1", label: "确认核查问题", status: "done" },
                { id: "2", label: "检索公开材料", status: "active" },
              ],
            }),
            xml("web_search", { query: "隔夜菜 加热 致癌" }),
          ].join("\n"),
        },
        {
          thinking: "打开来源。",
          text: xml("web_fetch", { url: "https://who.int/food" }),
        },
        {
          thinking: "有出处，可以下判断。",
          text: xml("submit_verdict", {
            verdictType: "false",
            conclusion: "不能信。公开材料不支持致癌。",
            claimAtoms: ["隔夜菜加热会致癌"],
            claimAtomTypes: [{ text: "隔夜菜加热会致癌", verifiable: true, type: "causal" }],
            subclaimVerdicts: [
              {
                claimAtom: "隔夜菜加热会致癌",
                verdict: "false",
                evidence: "WHO 页不支持",
                contradictingSources: [{ url: "https://who.int/food", title: "WHO" }],
              },
            ],
            keyFindings: ["没有致癌结论"],
          }),
        },
      ]),
    });

    expect(result.stopReason).toBe("submit_verdict");
    expect(result.turns).toBe(3);
    expect(searches).toEqual(["隔夜菜 加热 致癌"]);
    expect(fetched).toEqual(["https://who.int/food"]);
    expect(todos.current.map((t) => t.label)).toContain("检索公开材料");
    expect(result.terminalArgs?.verdictType).toBe("false");
  });

  it("refuses fetch of URLs that were not searched", async () => {
    const allowedUrls = new Set<string>();
    const tools = createLoopTools({
      search: async () => ({ sources: [] }),
      allowedUrls,
      todos: { current: [] },
    });
    const result = await runAgentLoop({
      systemPrompt: "t",
      userMessage: "x",
      tools,
      maxTurns: 2,
      callLlm: scriptedLlm([
        {
          text: xml("web_fetch", { url: "https://evil.example/x" }),
        },
        {
          text: xml("submit_verdict", { verdictType: "unverified", conclusion: "还查不清。" }),
        },
      ]),
    });
    const fetchRow = result.toolTrace.find((row) => row.name === "web_fetch");
    expect(asError(fetchRow?.result)).toMatch(/只能打开本次检索/);
  });

  it("stops unverified when the model talks without tools", async () => {
    const result = await runAgentLoop({
      systemPrompt: "t",
      userMessage: "x",
      tools: createLoopTools({
        search: async () => ({ sources: [] }),
        allowedUrls: new Set(),
        todos: { current: [] },
      }),
      maxTurns: 3,
      callLlm: scriptedLlm([{ text: "我认为这是真的。" }]),
    });
    expect(result.stopReason).toBe("no_tool");
    expect(result.terminalArgs).toBeUndefined();
    expect(result.turns).toBe(3);
  });

  it("nudges once then submits when the first turn had no tool", async () => {
    const result = await runAgentLoop({
      systemPrompt: "t",
      userMessage: "x",
      tools: createLoopTools({
        search: async () => ({ sources: [] }),
        allowedUrls: new Set(),
        todos: { current: [] },
      }),
      maxTurns: 3,
      callLlm: scriptedLlm([
        { text: "先说两句。" },
        { text: xml("submit_verdict", { verdictType: "unverified", conclusion: "还查不清。" }) },
      ]),
    });
    expect(result.stopReason).toBe("submit_verdict");
    expect(result.turns).toBe(2);
    expect(result.terminalArgs?.verdictType).toBe("unverified");
  });

  it("forces submit_verdict after a second silent turn", async () => {
    const result = await runAgentLoop({
      systemPrompt: "t",
      userMessage: "x",
      tools: createLoopTools({
        search: async () => ({ sources: [] }),
        allowedUrls: new Set(),
        todos: { current: [] },
      }),
      maxTurns: 4,
      callLlm: scriptedLlm([
        { text: "先说两句。" },
        { text: "还是不调工具。" },
        { text: xml("submit_verdict", { verdictType: "unverified", conclusion: "还查不清。" }) },
      ]),
    });
    expect(result.stopReason).toBe("submit_verdict");
    expect(result.turns).toBe(3);
  });
});

describe("runClaimLoop", () => {
  it("emits existing SSE event types and gates unsourced true down to 还查不清", async () => {
    const events: Array<{ type?: string; toolName?: string; result?: unknown }> = [];
    const out = await runClaimLoop({
      claim: "某市明天给全市发钱",
      search: async () => ({
        sources: [{ url: "https://gov.example/notice", title: "通知", snippet: "未提及发钱" }],
      }),
      onEvent: (data) => events.push(data as { type?: string; toolName?: string; result?: unknown }),
      callLlm: scriptedLlm([
        {
          thinking: "先搜有没有官方通知。",
          text: xml("web_search", { query: "某市 发钱 通知" }),
        },
        {
          text: xml("submit_verdict", {
            verdictType: "true",
            conclusion: "能信。全市发钱。",
            claimAtoms: ["某市明天给全市发钱"],
            subclaimVerdicts: [{ claimAtom: "某市明天给全市发钱", verdict: "true", evidence: "没有出处也要真" }],
          }),
        },
      ]),
    });

    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "agent_thought")).toBe(true);
    expect(events.some((e) => e.type === "tool_start" && e.toolName === "web_search")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(false);
    expect(out.finalReport.verdictType).toBe("unverified");
    expect(String(out.finalReport.conclusion)).not.toMatch(/^(能信|不能信|只能信一部分|还查不清)/);
    expect(String(out.finalReport.conclusion)).not.toMatch(/Agent|web_search|MiniMax/);
    expect(out.finalReport._execution).toBe("agent_loop");
  });
});

function asError(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" ? error : "";
}
