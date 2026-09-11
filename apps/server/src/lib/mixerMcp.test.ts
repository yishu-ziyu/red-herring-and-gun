import { describe, expect, it } from "vitest";
import { handleMcpJsonRpc } from "./mixerMcp.js";

describe("mixer MCP JSON-RPC handler", () => {
  it("responds to initialize with MCP capabilities and server info", async () => {
    const response = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      async () => ({})
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "red-herring-and-gun" },
      },
    });
  });

  it("lists the red herring truth-check tool", async () => {
    const response = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      async () => ({})
    );

    expect((response as any).result.tools[0].name).toBe("red_herring_truth_check");
    expect((response as any).result.tools[0].inputSchema.required).toEqual(["claim"]);
  });

  it("calls the tool runner and returns structured content", async () => {
    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "red_herring_truth_check",
          arguments: { claim: "喝咖啡会导致心脏病概率增加。" },
        },
      },
      async () => ({
        steps: [{ model: "stepfun:step-2-mini" }],
        finalReport: {
          conclusion: "证据不足，不能直接推出咖啡导致心脏病。",
          credibilityScore: 42,
          credibilityLabel: "证据不足",
          recommendation: "查看剂量、人群和研究设计。",
        },
      })
    );

    expect((response as any).result.structuredContent).toMatchObject({
      conclusion: "证据不足，不能直接推出咖啡导致心脏病。",
      credibilityScore: 42,
      agentCount: 1,
      models: ["stepfun:step-2-mini"],
    });
  });

  it("returns a tool-level error for missing claim", async () => {
    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: "call-2",
        method: "tools/call",
        params: { name: "red_herring_truth_check", arguments: {} },
      },
      async () => ({})
    );

    expect((response as any).result.isError).toBe(true);
    expect((response as any).result.content[0].text).toMatch(/claim/);
  });
});
