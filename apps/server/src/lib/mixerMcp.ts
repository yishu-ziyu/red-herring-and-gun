import type { Request, Response } from "express";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface RedHerringRunner {
  (input: { claim: string }): Promise<unknown>;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";

const redHerringTool = {
  name: "red_herring_truth_check",
  title: "红鲱鱼与枪：信息真实性核查",
  description:
    "对一段中文或中英混合的传闻、营销话术、社媒截图转写、网页链接摘要进行多 Agent 真实性核查，返回风险识别、事实核验、信源评估和最终报告。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claim: {
        type: "string",
        description: "需要核查的原始材料。可以是传闻、社媒文本、营销话术、新闻摘要或用户粘贴的链接上下文。",
      },
    },
    required: ["claim"],
  },
};

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function isJsonRpcNotification(request: JsonRpcRequest) {
  return request.id === undefined || request.id === null;
}

function getParamsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
}

function summarizeOrchestrateResult(raw: unknown) {
  const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const finalReport = result.finalReport && typeof result.finalReport === "object"
    ? result.finalReport as Record<string, unknown>
    : {};
  const steps = Array.isArray(result.steps) ? result.steps : [];

  return {
    conclusion: finalReport.conclusion ?? finalReport.summaryForPublic ?? "",
    credibilityScore: finalReport.credibilityScore ?? null,
    credibilityLabel: finalReport.credibilityLabel ?? "",
    recommendation: finalReport.recommendation ?? "",
    summaryForPublic: finalReport.summaryForPublic ?? "",
    agentCount: steps.length,
    models: steps
      .map((step) => step && typeof step === "object" ? (step as Record<string, unknown>).model : undefined)
      .filter((model): model is string => typeof model === "string"),
    finalReport,
  };
}

async function callRedHerringTool(args: unknown, runner: RedHerringRunner): Promise<McpToolCallResult> {
  const params = getParamsObject(args);
  const claim = typeof params.claim === "string" ? params.claim.trim() : "";
  if (!claim) {
    return {
      isError: true,
      content: [{ type: "text", text: "缺少 claim 参数。请传入需要核查的文本。" }],
    };
  }

  const raw = await runner({ claim });
  const summary = summarizeOrchestrateResult(raw);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(summary, null, 2),
      },
    ],
    structuredContent: summary,
  };
}

export async function handleMcpJsonRpc(request: JsonRpcRequest, runner: RedHerringRunner) {
  if (request.jsonrpc !== "2.0") {
    return jsonRpcError(request.id, -32600, "Invalid Request: jsonrpc must be 2.0");
  }

  if (!request.method || typeof request.method !== "string") {
    return jsonRpcError(request.id, -32600, "Invalid Request: missing method");
  }

  if (request.method === "notifications/initialized") {
    return undefined;
  }

  if (request.method === "initialize") {
    return jsonRpcResult(request.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "red-herring-and-gun",
        title: "红鲱鱼与枪",
        version: "1.0.0",
      },
      instructions:
        "调用 red_herring_truth_check 工具核查用户给出的传闻或信息材料。输出应标明可信度、关键证据和不能推断的边界。",
    });
  }

  if (request.method === "ping") {
    return jsonRpcResult(request.id, {});
  }

  if (request.method === "tools/list") {
    return jsonRpcResult(request.id, { tools: [redHerringTool] });
  }

  if (request.method === "tools/call") {
    const params = getParamsObject(request.params);
    const name = typeof params.name === "string" ? params.name : "";
    if (name !== redHerringTool.name) {
      return jsonRpcError(request.id, -32602, `Unknown tool: ${name || "(missing)"}`);
    }

    try {
      const result = await callRedHerringTool(params.arguments, runner);
      return jsonRpcResult(request.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "red_herring_truth_check failed";
      return jsonRpcResult(request.id, {
        isError: true,
        content: [{ type: "text", text: message }],
      });
    }
  }

  if (isJsonRpcNotification(request)) {
    return undefined;
  }

  return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
}

async function runLocalOrchestrate(env: Record<string, string>, input: { claim: string }) {
  const port = Number(env.PORT) || 3000;
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/orchestrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim: input.claim }),
    signal: AbortSignal.timeout(150000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data.message === "string" ? data.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function mcpHttpHandler(req: Request, res: Response, env: Record<string, string>) {
  if (req.method === "GET") {
    res.json({
      name: "red-herring-and-gun",
      title: "红鲱鱼与枪",
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: "streamable-http",
      tools: [redHerringTool],
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body;
  const runner: RedHerringRunner = (input) => runLocalOrchestrate(env, input);
  const requests = Array.isArray(body) ? body : [body];
  const responses = await Promise.all(
    requests.map((item) => handleMcpJsonRpc(item as JsonRpcRequest, runner))
  );
  const filtered = responses.filter((item) => item !== undefined);

  if (Array.isArray(body)) {
    res.json(filtered);
    return;
  }

  if (filtered.length === 0) {
    res.status(202).end();
    return;
  }
  res.json(filtered[0]);
}
