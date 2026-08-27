import { describe, expect, it } from "vitest";
import { mergeToolCalls, parseToolCalls } from "./parseToolCalls";

describe("parseToolCalls", () => {
  it("reads one or more XML tool_call blocks", () => {
    const text = [
      "先搜再打开。",
      "<tool_call>",
      "<name>web_search</name>",
      '<arguments>{"query":"隔夜菜 致癌"}</arguments>',
      "</tool_call>",
      "<tool_call>",
      "<name>todo_write</name>",
      '<arguments>{"todos":[{"id":"1","label":"检索","status":"active"}]}</arguments>',
      "</tool_call>",
    ].join("\n");
    const calls = parseToolCalls(text);
    expect(calls.map((c) => c.name)).toEqual(["web_search", "todo_write"]);
    expect(calls[0]?.arguments).toEqual({ query: "隔夜菜 致癌" });
    expect(calls[1]?.arguments.todos).toEqual([{ id: "1", label: "检索", status: "active" }]);
  });

  it("native toolCalls win over XML in the text", () => {
    const merged = mergeToolCalls({
      text: "<tool_call><name>web_search</name><arguments>{}</arguments></tool_call>",
      toolCalls: [{ id: "1", name: "submit_verdict", arguments: { verdictType: "unverified" } }],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("submit_verdict");
  });

  it("empty text yields no calls", () => {
    expect(parseToolCalls("")).toEqual([]);
    expect(parseToolCalls("没有工具，只有一段话")).toEqual([]);
  });
});
