import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { searchClaimAcrossSources } from "./src/lib/sherlockStyleSearch";
import { AGENT_CONFIGS, buildAgentInput } from "./src/lib/agentConfigs";

const execFileAsync = promisify(execFile);

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    controllerNote: { type: "string" },
    agentTitle: { type: "string" },
    agentSubtitle: { type: "string" },
    resultTitle: { type: "string" },
    resultSubtitle: { type: "string" },
    resultStatus: { type: "string", enum: ["risk", "active", "supported", "limited", "blocked", "rewrite"] },
    traceText: { type: "string" },
    inspectorSummary: { type: "string" },
    canSay: { type: "array", items: { type: "string" } },
    cannotSay: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
  },
  required: [
    "controllerNote",
    "agentTitle",
    "agentSubtitle",
    "resultTitle",
    "resultSubtitle",
    "resultStatus",
    "traceText",
    "inspectorSummary",
    "canSay",
    "cannotSay",
    "sources",
  ],
};

const recursiveResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    controllerNote: { type: "string" },
    runTitle: { type: "string" },
    traceText: { type: "string" },
    clues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          source: { type: "string" },
          role: { type: "string", enum: ["support", "limit", "counter", "context", "lead"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["id", "title", "summary", "source", "role", "confidence"],
      },
    },
    frontier: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          reasonToContinue: { type: "string" },
          nextQuestion: { type: "string" },
          estimatedValue: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["id", "title", "reasonToContinue", "nextQuestion", "estimatedValue"],
      },
    },
    stopped: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          reason: { type: "string", enum: ["duplicate", "budget", "low_confidence", "out_of_scope"] },
        },
        required: ["id", "title", "reason"],
      },
    },
    canSay: { type: "array", items: { type: "string" } },
    cannotSay: { type: "array", items: { type: "string" } },
  },
  required: ["controllerNote", "runTitle", "traceText", "clues", "frontier", "stopped", "canSay", "cannotSay"],
};

const allowedStatuses = new Set(["risk", "active", "supported", "limited", "blocked", "rewrite", "clue", "frontier", "stopped", "controller"]);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), agentApiPlugin(env)],
  };
});

function agentApiPlugin(env: Record<string, string>) {
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const codexBin = env.CODEX_BIN || process.env.CODEX_BIN || "/Users/mahaoxuan/.local/bin/codex";
  const codexModel = env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5";

  async function handler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const llmResult = apiKey
        ? await callOpenAI({ apiKey, baseUrl, model, payload })
        : await callLocalProvider({ codexBin, model: codexModel, payload, env });
      return sendJson(res, 200, llmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知 LLM 调用错误";
      return sendJson(res, 502, { message });
    }
  }

  async function recursiveHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const llmResult = apiKey
        ? await callOpenAIRecursive({ apiKey, baseUrl, model, payload })
        : await callLocalProviderRecursive({ codexBin, model: codexModel, payload, env });
      return sendJson(res, 200, llmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知递归搜索错误";
      return sendJson(res, 502, { message });
    }
  }

  async function sherlockHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const result = await searchClaimAcrossSources(payload.claim, payload.keywords);
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sherlock 搜索错误";
      return sendJson(res, 502, { message });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 多 Agent Orchestrate Handler（串行 handoff）
  // ───────────────────────────────────────────────────────────────

  async function orchestrateHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const claim = payload.claim;
    if (!claim || typeof claim !== "string") {
      return sendJson(res, 400, { message: "缺少 claim 参数" });
    }

    // Helper: run a single agent
    async function runAgent(agentId: string, steps: any[]): Promise<any> {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }

      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, claim, steps);

      let output: Record<string, unknown>;
      let modelUsed: string;

      try {
        const result = await callAgentWithFallback({
          systemPrompt: agentConfig.systemPrompt,
          userContent: JSON.stringify(agentInput, null, 2),
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
        });
        output = result.output;
        modelUsed = result.model;
      } catch (error) {
        const fallback = buildOrchestrateDemoFallback(agentId, claim);
        output = fallback;
        modelUsed = "demo-fallback:orchestrate";
      }

      return {
        agent: agentConfig.id,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        systemPrompt: agentConfig.systemPrompt,
        input: agentInput,
        output,
        model: modelUsed,
        latencyMs: Date.now() - stepStart,
        timestamp: Date.now(),
        status: "completed",
      };
    }

    try {
      const steps: any[] = [];

      // Phase 1: RumorDetector (serial)
      const rumorStep = await runAgent("rumor_detector", steps);
      steps.push(rumorStep);

      // Phase 2: FactChecker + SourceValidator (parallel)
      const [factStep, sourceStep] = await Promise.all([
        runAgent("fact_checker", steps),
        runAgent("source_validator", steps),
      ]);
      steps.push(factStep, sourceStep);

      // Phase 3: ReportComposer (serial)
      const reportStep = await runAgent("report_composer", steps);
      steps.push(reportStep);

      const finalReport = reportStep.output;

      return sendJson(res, 200, {
        claim,
        steps,
        finalReport,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Orchestrate 调用错误";
      return sendJson(res, 502, { message, steps: [] });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 多 Agent Orchestrate Stream Handler（SSE 实时流）
  // ───────────────────────────────────────────────────────────────

  async function orchestrateStreamHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const claim = payload.claim;
    if (!claim || typeof claim !== "string") {
      return sendJson(res, 400, { message: "缺少 claim 参数" });
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Helper: run a single agent and stream events
    async function runAgentWithStream(agentId: string, steps: any[]): Promise<any> {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }

      // Notify frontend: agent started
      sendEvent({
        type: "agent_start",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        model: agentConfig.model || "",
        timestamp: Date.now(),
      });

      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, claim, steps);

      let output: Record<string, unknown>;
      let modelUsed: string;

      try {
        const result = await callAgentWithFallback({
          systemPrompt: agentConfig.systemPrompt,
          userContent: JSON.stringify(agentInput, null, 2),
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
        });
        output = result.output;
        modelUsed = result.model;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Agent 调用失败";
        sendEvent({ type: "agent_error", agent: agentId, error: msg });
        const fallback = buildOrchestrateDemoFallback(agentId, claim);
        output = fallback;
        modelUsed = "demo-fallback:orchestrate";
      }

      const step = {
        agent: agentConfig.id,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        systemPrompt: agentConfig.systemPrompt,
        input: agentInput,
        output,
        model: modelUsed,
        latencyMs: Date.now() - stepStart,
        timestamp: Date.now(),
        status: "completed" as const,
      };

      // Notify frontend: agent completed
      sendEvent({
        type: "agent_complete",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        output,
        model: modelUsed,
        latencyMs: step.latencyMs,
        timestamp: Date.now(),
      });

      return step;
    }

    try {
      const steps: any[] = [];

      // Phase 1: RumorDetector (serial — downstream agents depend on its output)
      const rumorStep = await runAgentWithStream("rumor_detector", steps);
      steps.push(rumorStep);

      // Phase 2: FactChecker + SourceValidator (parallel — both only need claim + rumorDetector output)
      const [factStep, sourceStep] = await Promise.all([
        runAgentWithStream("fact_checker", steps),
        runAgentWithStream("source_validator", steps),
      ]);
      steps.push(factStep, sourceStep);

      // Phase 3: ReportComposer (serial — needs outputs from all previous agents)
      const reportStep = await runAgentWithStream("report_composer", steps);
      steps.push(reportStep);

      const finalReport = reportStep.output;

      sendEvent({
        type: "complete",
        claim,
        steps,
        finalReport,
        totalLatencyMs: steps.reduce((sum, s) => sum + s.latencyMs, 0),
        timestamp: Date.now(),
      });

      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Orchestrate Stream 错误";
      sendEvent({ type: "error", message });
      res.end();
    }
  }

  return {
    name: "suzheng-agent-api",
    configureServer(server: any) {
      server.middlewares.use("/api/agent/expand", handler);
      server.middlewares.use("/api/agent/recursive-search", recursiveHandler);
      server.middlewares.use("/api/agent/sherlock-search", sherlockHandler);
      server.middlewares.use("/api/agent/orchestrate", orchestrateHandler);
      server.middlewares.use("/api/agent/orchestrate-stream", orchestrateStreamHandler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use("/api/agent/expand", handler);
      server.middlewares.use("/api/agent/recursive-search", recursiveHandler);
      server.middlewares.use("/api/agent/sherlock-search", sherlockHandler);
      server.middlewares.use("/api/agent/orchestrate", orchestrateHandler);
      server.middlewares.use("/api/agent/orchestrate-stream", orchestrateStreamHandler);
    },
  };
}

async function callLocalProvider({
  codexBin,
  model,
  payload,
  env,
}: {
  codexBin: string;
  model: string;
  payload: any;
  env: Record<string, string>;
}) {
  const errors: string[] = [];

  // 优先尝试 MiMo Token Plan（Anthropic 兼容协议，多集群回退）
  const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
  const mimoModel = env.MIMO_MODEL || "mimo-v2.5-pro";
  const mimoClusters = [
    (env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
    "https://token-plan-sgp.xiaomimimo.com/anthropic",
    "https://token-plan-ams.xiaomimimo.com/anthropic",
  ];

  if (mimoApiKey) {
    for (const clusterUrl of mimoClusters) {
      try {
        return await callMimoApi({ baseUrl: clusterUrl, model: mimoModel, apiKey: mimoApiKey, payload });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MiMo API 调用失败";
        errors.push(`[${clusterUrl}] ${msg}`);
      }
    }
  }

  // 尝试 DeepSeek API（OpenAI 兼容协议）
  const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-chat";

  if (deepseekApiKey) {
    try {
      return await callDeepSeekApi({ apiKey: deepseekApiKey, baseUrl: deepseekBaseUrl, model: deepseekModel, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "DeepSeek API 调用失败");
    }
  }

  const anthropicConfig = await loadAnthropicConfig(env);
  if (anthropicConfig?.baseUrl && anthropicConfig.model) {
    try {
      return await callAnthropicProxy({ ...anthropicConfig, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic proxy 调用失败");
    }
  }

  try {
    return await callLocalCodex({ codexBin, model, payload });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Codex CLI 调用失败");
  }

  throw new Error(errors.join("；") || "没有可用的本地模型 provider");
}

async function callLocalProviderRecursive({
  codexBin,
  model,
  payload,
  env,
}: {
  codexBin: string;
  model: string;
  payload: any;
  env: Record<string, string>;
}) {
  const errors: string[] = [];

  // 优先尝试 MiMo Token Plan（多集群回退）
  const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
  const mimoModel = env.MIMO_MODEL || "mimo-v2.5-pro";
  const mimoClusters = [
    (env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
    "https://token-plan-sgp.xiaomimimo.com/anthropic",
    "https://token-plan-ams.xiaomimimo.com/anthropic",
  ];

  if (mimoApiKey) {
    for (const clusterUrl of mimoClusters) {
      try {
        return await callMimoApiRecursive({ baseUrl: clusterUrl, model: mimoModel, apiKey: mimoApiKey, payload });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MiMo API 递归搜索调用失败";
        errors.push(`[${clusterUrl}] ${msg}`);
      }
    }
  }

  // 尝试 DeepSeek API（OpenAI 兼容协议）
  const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-chat";

  if (deepseekApiKey) {
    try {
      return await callDeepSeekApiRecursive({ apiKey: deepseekApiKey, baseUrl: deepseekBaseUrl, model: deepseekModel, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "DeepSeek API 递归搜索调用失败");
    }
  }

  const anthropicConfig = await loadAnthropicConfig(env);
  if (anthropicConfig?.baseUrl && anthropicConfig.model) {
    try {
      return await callAnthropicProxyRecursive({ ...anthropicConfig, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic proxy 递归搜索调用失败");
    }
  }

  try {
    return await callLocalCodexRecursive({ codexBin, model, payload });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Codex CLI 递归搜索调用失败");
  }

  throw new Error(errors.join("；") || "没有可用的本地模型 provider");
}

async function loadAnthropicConfig(env: Record<string, string>) {
  const explicitBaseUrl = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const explicitModel = env.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL;
  const explicitToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

  if (explicitBaseUrl && explicitModel) {
    return {
      baseUrl: explicitBaseUrl.replace(/\/$/, ""),
      model: explicitModel,
      token: explicitToken || "local",
    };
  }

  try {
    const raw = await readFile(join(homedir(), ".claude/settings.json"), "utf8");
    const settings = JSON.parse(raw);
    const claudeEnv = settings?.env ?? {};
    const baseUrl = claudeEnv.ANTHROPIC_BASE_URL;
    const model = claudeEnv.ANTHROPIC_MODEL;
    const token = claudeEnv.ANTHROPIC_AUTH_TOKEN || claudeEnv.ANTHROPIC_API_KEY || "local";

    if (typeof baseUrl === "string" && typeof model === "string") {
      return { baseUrl: baseUrl.replace(/\/$/, ""), model, token };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function callOpenAI({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是真探 Agent（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  const body: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: modeInstruction,
            claim: payload.claim,
            selectedNode: payload.node,
            userPrompt: payload.prompt,
            visibleNodeTitles: payload.visibleNodeTitles,
          },
          null,
          2,
        ),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "node_agent_expansion",
        strict: true,
        schema: responseSchema,
      },
    },
    max_output_tokens: 900,
  };

  if (payload.mode === "search") {
    body.tools = [{ type: "web_search" }];
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`OpenAI Responses API 调用失败：${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI Responses API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(text), model);
}

async function callOpenAIRecursive({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明证据许可：可以说什么、不能说什么。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const body: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(buildRecursivePayload(payload), null, 2) },
    ],
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "recursive_evidence_search",
        strict: true,
        schema: recursiveResponseSchema,
      },
    },
    max_output_tokens: 1400,
  };

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`OpenAI Responses API 递归搜索失败：${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI Responses API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(text), model);
}

async function callAnthropicProxy({
  baseUrl,
  model,
  token,
  payload,
}: {
  baseUrl: string;
  model: string;
  token: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": token,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildCodexPrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`本地 Anthropic proxy 调用失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("本地 Anthropic proxy 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(extractJsonObject(text)), `anthropic-local:${model}`);
}

async function callAnthropicProxyRecursive({
  baseUrl,
  model,
  token,
  payload,
}: {
  baseUrl: string;
  model: string;
  token: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、可以说和不能说。",
    "不要自动继续展开 frontier，不要给最终答案。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": token,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      system: systemPrompt,
      messages: [{ role: "user", content: buildRecursivePrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`本地 Anthropic proxy 递归搜索失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("本地 Anthropic proxy 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(extractJsonObject(text)), `anthropic-local:${model}`);
}

// ───────────────────────────────────────────────────────────────
// MiMo Token Plan API（Anthropic 兼容协议）
// ───────────────────────────────────────────────────────────────

async function callMimoApi({
  baseUrl,
  model,
  apiKey,
  payload,
}: {
  baseUrl: string;
  model: string;
  apiKey: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是真探 Agent（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildCodexPrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MiMo API 调用失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("MiMo API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(extractJsonObject(text)), `mimo:${model}`);
}

async function callMimoApiRecursive({
  baseUrl,
  model,
  apiKey,
  payload,
}: {
  baseUrl: string;
  model: string;
  apiKey: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是真探 Agent（信息真相猎人）的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、可以说和不能说。",
    "不要自动继续展开 frontier，不要给最终答案。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      system: systemPrompt,
      messages: [{ role: "user", content: buildRecursivePrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MiMo API 递归搜索失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("MiMo API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(extractJsonObject(text)), `mimo:${model}`);
}

// ───────────────────────────────────────────────────────────────
// DeepSeek API（OpenAI Chat Completions 兼容协议）
// ───────────────────────────────────────────────────────────────

async function callDeepSeekApi({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是真探 Agent（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: modeInstruction,
              claim: payload.claim,
              selectedNode: payload.node,
              userPrompt: payload.prompt,
              visibleNodeTitles: payload.visibleNodeTitles,
            },
            null,
            2,
          ),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 900,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`DeepSeek API 调用失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("DeepSeek API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(text), `deepseek:${model}`);
}

async function callDeepSeekApiRecursive({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明证据许可：可以说什么、不能说什么。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(buildRecursivePayload(payload), null, 2) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1400,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`DeepSeek API 递归搜索失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("DeepSeek API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(text), `deepseek:${model}`);
}

function extractChatCompletionText(data: any) {
  return typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
}

async function callLocalCodex({
  codexBin,
  model,
  payload,
}: {
  codexBin: string;
  model: string;
  payload: any;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "suzheng-codex-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(responseSchema), "utf8");
    const prompt = buildCodexPrompt(payload);
    const args = [
      ...(payload.mode === "search" ? ["--search"] : []),
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-m",
      model,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      prompt,
    ];
    const timeout = Number(process.env.CODEX_LOCAL_TIMEOUT_MS || 180000);

    await execFileAsync(codexBin, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const raw = await readFile(outputPath, "utf8");
    return normalizeExpansionResult(JSON.parse(raw), `codex-local:${model}`);
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr.split("\n").slice(-4).join(" ") || error?.message || "未知错误";
    throw new Error(`本地 Codex 调用失败：${detail}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function callLocalCodexRecursive({
  codexBin,
  model,
  payload,
}: {
  codexBin: string;
  model: string;
  payload: any;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "suzheng-recursive-codex-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(recursiveResponseSchema), "utf8");
    const args = [
      "--search",
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-m",
      model,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      buildRecursivePrompt(payload),
    ];
    const timeout = Number(process.env.CODEX_LOCAL_TIMEOUT_MS || 180000);

    await execFileAsync(codexBin, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const raw = await readFile(outputPath, "utf8");
    return normalizeRecursiveResult(JSON.parse(raw), `codex-local:${model}`);
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr.split("\n").slice(-4).join(" ") || error?.message || "未知错误";
    throw new Error(`本地 Codex 递归搜索失败：${detail}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractAnthropicText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    return extractAnthropicContent(data);
  }

  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const dataText = line.slice(5).trim();
    if (!dataText || dataText === "[DONE]") continue;

    try {
      const event = JSON.parse(dataText);
      const deltaText = event?.delta?.text;
      if (typeof deltaText === "string") parts.push(deltaText);
      const blockText = event?.content_block?.text;
      if (event?.type === "content_block_start" && typeof blockText === "string") parts.push(blockText);
    } catch {
      continue;
    }
  }

  return parts.join("");
}

function extractAnthropicContent(data: any) {
  const parts: string[] = [];
  for (const item of data?.content ?? []) {
    if (typeof item?.text === "string") parts.push(item.text);
  }
  return parts.join("");
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

function buildCodexPrompt(payload: any) {
  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 Codex 的 web search 能力寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  return [
    "你是真探 Agent（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 中控为什么选择这个调度方向。",
    "- agentTitle / agentSubtitle: 被派出的子 Agent 名称和职责。",
    "- resultTitle / resultSubtitle / resultStatus: 接回 Canvas 的局部结果节点。",
    "- resultStatus 只能是 risk、active、supported、limited、blocked、rewrite 之一。",
    "- traceText: 左侧 Agent Trace 中的一句话。",
    "- inspectorSummary: 右侧 Inspector 对这次局部调用的总结。",
    "- canSay / cannotSay: 当前节点允许和禁止的表达。",
    "- sources: 如果联网或引用材料，写来源名或 URL；没有则返回空数组。",
    "",
    JSON.stringify(
      {
        task: modeInstruction,
        claim: payload.claim,
        selectedNode: payload.node,
        userPrompt: payload.prompt,
        visibleNodeTitles: payload.visibleNodeTitles,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildRecursivePayload(payload: any) {
  return {
    task: "围绕用户选择的 seed node 做一轮递归证据搜索。请搜索、提取线索、去重，并把下一步可扩展线索放入 frontier。不要自动继续下一层。",
    claim: payload.claim,
    seedNode: payload.seedNode,
    userQuestion: payload.question,
    depthLimit: payload.depthLimit,
    budgetLimit: payload.budgetLimit,
    visibleNodeTitles: payload.visibleNodeTitles,
    existingSources: payload.existingSources,
    outputRules: [
      "clues 是本轮发现的证据或上下文线索，最多 4 条。",
      "frontier 是值得用户下一步选择继续搜索的线索，最多 3 条。",
      "stopped 是不应继续扩展的线索，并说明停止原因。",
      "如果发现重复来源或重复观点，不要放入 clues，放入 stopped，reason=duplicate。",
      "canSay / cannotSay 必须围绕当前 seed node 的证据许可，不要给全局最终结论。",
    ],
  };
}

function buildRecursivePrompt(payload: any) {
  return [
    "你是溯证 Agent 的中控 LLM。",
    "用户在 Canvas 中选中一个节点，并要求从这里做递归证据搜索。",
    "你只做一轮：search -> extract -> normalize -> dedupe -> score -> frontier。",
    "不要自动继续展开 frontier。frontier 只是交给用户选择的下一步。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 中控为什么从这个节点启动递归搜索。",
    "- runTitle: 本轮递归搜索标题。",
    "- traceText: 左侧 Agent Trace 中的一句话。",
    "- clues: 本轮发现的证据线索，包含 title、summary、source、role、confidence。",
    "- frontier: 可继续扩展但等待用户选择的下一步线索。",
    "- stopped: 因重复、预算、低可信或越界而停止的线索。",
    "- canSay / cannotSay: 当前证据允许和禁止的表达。",
    "",
    JSON.stringify(buildRecursivePayload(payload), null, 2),
  ].join("\n");
}

function normalizeExpansionResult(raw: any, model: string) {
  const pickString = (key: string, fallback: string) => (typeof raw?.[key] === "string" && raw[key].trim() ? raw[key] : fallback);
  const pickArray = (key: string) => (Array.isArray(raw?.[key]) ? raw[key].filter((item: unknown) => typeof item === "string") : []);
  const status = typeof raw?.resultStatus === "string" && allowedStatuses.has(raw.resultStatus) ? raw.resultStatus : "limited";

  return {
    controllerNote: pickString("controllerNote", "中控 LLM 已根据当前节点选择局部调度方向。"),
    agentTitle: pickString("agentTitle", "局部推理子 Agent"),
    agentSubtitle: pickString("agentSubtitle", "只处理当前节点上的局部追问。"),
    resultTitle: pickString("resultTitle", "局部推理结果"),
    resultSubtitle: pickString("resultSubtitle", "等待用户决定是否继续沿此分支发散。"),
    resultStatus: status,
    traceText: pickString("traceText", "我只在用户选中的节点上调用子 Agent，并把局部结果接回画布。"),
    inspectorSummary: pickString("inspectorSummary", "本次调用返回了当前节点的局部推理结果。"),
    canSay: pickArray("canSay"),
    cannotSay: pickArray("cannotSay"),
    sources: pickArray("sources"),
    model,
  };
}

function normalizeRecursiveResult(raw: any, model: string) {
  const pickString = (key: string, fallback: string) => (typeof raw?.[key] === "string" && raw[key].trim() ? raw[key] : fallback);
  const pickArray = (key: string) => (Array.isArray(raw?.[key]) ? raw[key] : []);
  const textArray = (key: string) => pickArray(key).filter((item: unknown) => typeof item === "string");
  const clueRoles = new Set(["support", "limit", "counter", "context", "lead"]);
  const confidenceValues = new Set(["low", "medium", "high"]);
  const valueLevels = new Set(["low", "medium", "high"]);
  const stoppedReasons = new Set(["duplicate", "budget", "low_confidence", "out_of_scope"]);

  return {
    controllerNote: pickString("controllerNote", "中控 LLM 已从当前节点启动一轮递归证据搜索。"),
    runTitle: pickString("runTitle", "递归证据搜索"),
    traceText: pickString("traceText", "我从用户选择的节点出发，只生成本轮线索和下一批 frontier，等待用户继续选择。"),
    clues: pickArray("clues").slice(0, 4).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `clue-${index + 1}`),
      title: pickNestedString(item, "title", `证据线索 ${index + 1}`),
      summary: pickNestedString(item, "summary", "这是一条需要继续审计的证据线索。"),
      source: pickNestedString(item, "source", "未提供来源"),
      role: clueRoles.has(item?.role) ? item.role : "lead",
      confidence: confidenceValues.has(item?.confidence) ? item.confidence : "medium",
    })),
    frontier: pickArray("frontier").slice(0, 3).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `frontier-${index + 1}`),
      title: pickNestedString(item, "title", `下一步线索 ${index + 1}`),
      reasonToContinue: pickNestedString(item, "reasonToContinue", "这条线索可能帮助补足当前节点的证据边界。"),
      nextQuestion: pickNestedString(item, "nextQuestion", "继续检查这条线索能支持什么、不能支持什么。"),
      estimatedValue: valueLevels.has(item?.estimatedValue) ? item.estimatedValue : "medium",
    })),
    stopped: pickArray("stopped").slice(0, 3).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `stopped-${index + 1}`),
      title: pickNestedString(item, "title", `停止线索 ${index + 1}`),
      reason: stoppedReasons.has(item?.reason) ? item.reason : "low_confidence",
    })),
    canSay: textArray("canSay"),
    cannotSay: textArray("cannotSay"),
    model,
  };
}

function pickNestedString(item: any, key: string, fallback: string) {
  return typeof item?.[key] === "string" && item[key].trim() ? item[key] : fallback;
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;

  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("");
}

function readJson(req: any) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// ───────────────────────────────────────────────────────────────
// Agent Orchestrate 底层 Provider 调用
// ───────────────────────────────────────────────────────────────

async function callAgentWithFallback({
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens,
  env,
  codexBin,
  reasoningEffort = "high",
}: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
  env: Record<string, string>;
  codexBin: string;
  reasoningEffort?: "low" | "medium" | "high";
}) {
  const startTime = Date.now();
  const errors: string[] = [];

  // ───────────────────────────────────────────────────────────────
  // 1. StepFun（阶跃星辰）国产模型 — 赛道评分要求必须使用国产大模型
  //    step-3.7-flash 支持 reasoning_effort 三级控制
  // ───────────────────────────────────────────────────────────────
  const stepfunApiKey = env.STEPFUN_API_KEY || process.env.STEPFUN_API_KEY;
  const stepfunModel = env.STEPFUN_MODEL || process.env.STEPFUN_MODEL || "step-3.7-flash";
  const stepfunBaseUrl = (env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");

  if (stepfunApiKey) {
    try {
      const result = await callStepFunAgent({
        baseUrl: stepfunBaseUrl,
        apiKey: stepfunApiKey,
        model: stepfunModel,
        systemPrompt,
        userContent,
        maxTokens,
        reasoningEffort,
      });
      return {
        output: JSON.parse(extractJsonObject(result.text)),
        model: result.model,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "StepFun Agent 调用失败";
      errors.push(`[stepfun:${stepfunModel}] ${msg}`);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 2. MiMo Token Plan（Anthropic 兼容协议，多集群回退）
  // ───────────────────────────────────────────────────────────────
  const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
  const mimoModel = env.MIMO_MODEL || "mimo-v2.5-pro";
  const mimoClusters = [
    (env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
    "https://token-plan-sgp.xiaomimimo.com/anthropic",
    "https://token-plan-ams.xiaomimimo.com/anthropic",
  ];

  if (mimoApiKey) {
    for (const clusterUrl of mimoClusters) {
      try {
        const result = await callMimoAgent({
          baseUrl: clusterUrl,
          apiKey: mimoApiKey,
          model: mimoModel,
          systemPrompt,
          userContent,
          maxTokens,
        });
        return {
          output: JSON.parse(extractJsonObject(result.text)),
          model: result.model,
          latencyMs: Date.now() - startTime,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MiMo Agent 调用失败";
        errors.push(`[${clusterUrl}] ${msg}`);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 3. DeepSeek API
  // ───────────────────────────────────────────────────────────────
  const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-chat";

  if (deepseekApiKey) {
    try {
      const result = await callDeepSeekAgent({
        apiKey: deepseekApiKey,
        baseUrl: deepseekBaseUrl,
        model: deepseekModel,
        systemPrompt,
        userContent,
        maxTokens,
      });
      return {
        output: JSON.parse(extractJsonObject(result.text)),
        model: result.model,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "DeepSeek Agent 调用失败");
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 4. Anthropic Proxy
  // ───────────────────────────────────────────────────────────────
  const anthropicConfig = await loadAnthropicConfig(env);
  if (anthropicConfig?.baseUrl && anthropicConfig.model) {
    try {
      const result = await callAnthropicAgent({
        baseUrl: anthropicConfig.baseUrl,
        token: anthropicConfig.token,
        model: anthropicConfig.model,
        systemPrompt,
        userContent,
        maxTokens,
      });
      return {
        output: JSON.parse(extractJsonObject(result.text)),
        model: result.model,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic Agent 调用失败");
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 5. Codex CLI（本地模型回退）
  // ───────────────────────────────────────────────────────────────
  try {
    const result = await callCodexAgent({
      codexBin,
      model: env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5",
      systemPrompt,
      userContent,
      responseSchema,
      maxTokens,
    });
    return {
      output: JSON.parse(extractJsonObject(result.text)),
      model: result.model,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Codex Agent 调用失败");
  }

  throw new Error(errors.join("；") || "没有可用的 Agent provider");
}

async function callMimoAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}) {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`MiMo API 调用失败：${raw.slice(0, 500)}`);
  }
  const text = extractAnthropicText(raw);
  if (!text) throw new Error("MiMo API 没有返回可解析文本。");
  return { text, model: `mimo:${model}` };
}

async function callDeepSeekAgent({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userContent,
  maxTokens,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`DeepSeek API 调用失败：${detail}`);
  }
  const text = extractChatCompletionText(data);
  if (!text) throw new Error("DeepSeek API 没有返回可解析文本。");
  return { text, model: `deepseek:${model}` };
}

async function callAnthropicAgent({
  baseUrl,
  token,
  model,
  systemPrompt,
  userContent,
  maxTokens,
}: {
  baseUrl: string;
  token: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}) {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": token,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic proxy 调用失败：${raw.slice(0, 500)}`);
  }
  const text = extractAnthropicText(raw);
  if (!text) throw new Error("Anthropic proxy 没有返回可解析文本。");
  return { text, model: `anthropic-local:${model}` };
}

async function callCodexAgent({
  codexBin,
  model,
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens,
}: {
  codexBin: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "suzheng-orchestrate-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(responseSchema), "utf8");
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-m",
      model,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      `${systemPrompt}\n\n${userContent}`,
    ];
    const timeout = Number(process.env.CODEX_LOCAL_TIMEOUT_MS || 180000);

    await execFileAsync(codexBin, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const raw = await readFile(outputPath, "utf8");
    return { text: raw, model: `codex-local:${model}` };
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr.split("\n").slice(-4).join(" ") || error?.message || "未知错误";
    throw new Error(`Codex Agent 调用失败：${detail}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────
// StepFun（阶跃星辰）国产模型调用
// 使用 OpenAI 兼容协议，支持 reasoning_effort 三级控制
// ───────────────────────────────────────────────────────────────

async function callStepFunAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  reasoningEffort = "high",
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: reasoningEffort,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`StepFun API 调用失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("StepFun API 没有返回可解析文本。");

  return { text, model: `stepfun:${model}` };
}

function buildOrchestrateDemoFallback(agentId: string, claim: string) {
  const fallbacks: Record<string, Record<string, unknown>> = {
    rumor_detector: {
      _source: "demo-fallback",
      rumorIndicators: ["检测到绝对化表述", "检测到匿名信源暗示"],
      severity: "medium",
      analysis: `Demo 模式：对"${claim}"的谣言特征分析。该声明包含若干典型谣言特征，包括绝对化表述和可能的匿名信源暗示。`,
      detectedPatterns: ["绝对化表述", "匿名信源"],
    },
    fact_checker: {
      _source: "demo-fallback",
      factCheckResult: "partial",
      confidence: "medium",
      sources: ["Demo 来源：相关科普文章", "Demo 来源：专家访谈"],
      keyFindings: ["核心事实部分成立", "存在一定程度的夸大或断章取义"],
      counterEvidence: ["反面证据：部分数据不支持该结论", "反面证据：存在更准确的替代解释"],
    },
    source_validator: {
      _source: "demo-fallback",
      sourceReliability: "medium",
      verifiedSources: ["Demo：某权威机构官方网站"],
      questionableSources: ["Demo：社交媒体转发", "Demo：匿名爆料"],
      missingSources: ["Demo：具体研究论文未指明"],
      verificationNotes: "Demo 模式：部分信源可追溯到公开渠道，但存在匿名来源和模糊引用。",
    },
    report_composer: {
      _source: "demo-fallback",
      conclusion: "该声明部分可信，但存在明显的谣言特征和夸大成分。",
      credibilityScore: 45,
      credibilityLabel: "部分可信",
      recommendation: "建议不转发，等待更多权威信息源确认后再做判断。",
      summaryForPublic: "该信息包含部分事实，但也存在夸大和谣言特征，建议谨慎对待。",
    },
  };
  return fallbacks[agentId] ?? {};
}

// ───────────────────────────────────────────────────────────────
// Demo Fallback — ensures the hackerthon demo never breaks
// when no API key is configured or LLM providers are unavailable
// ───────────────────────────────────────────────────────────────

function buildDemoFallback(payload: any) {
  const mode = payload.mode as string;
  const nodeTitle = payload.node?.title ?? "当前节点";

  const fallbacks: Record<string, any> = {
    search: {
      controllerNote: `用户要求对"${nodeTitle}"进行联网搜索。Demo 模式下返回模拟搜索结果。`,
      agentTitle: "Searcher 子 Agent",
      agentSubtitle: "模拟搜索：返回与该节点相关的候选材料",
      resultTitle: "新增候选证据（模拟）",
      resultSubtitle: "以下材料为演示数据，真实环境将调用搜索引擎",
      resultStatus: "limited",
      traceText: `我在"${nodeTitle}"附近搜索到新的候选材料，已接入画布。`,
      inspectorSummary: "模拟搜索返回了 3 份候选材料。它们可以支撑部分讨论，但证据强度有限。",
      canSay: ["找到新的讨论材料", "可作为背景线索或进一步审计的起点"],
      cannotSay: ["不能直接将搜索结论作为最终判断", "需要进一步审计材料来源和证据强度"],
      sources: ["模拟来源：相关学术论文摘要", "模拟来源：行业报告片段", "模拟来源：新闻报道"],
      model: "demo-fallback:search",
    },
    evidence_audit: {
      controllerNote: `用户对"${nodeTitle}"发起证据审计。Demo 模式下返回模拟审计结果。`,
      agentTitle: "Grader 子 Agent",
      agentSubtitle: "模拟审计：评估当前节点可以说什么、不能说什么",
      resultTitle: "证据审计结果（模拟）",
      resultSubtitle: "当前节点的证据许可与限制",
      resultStatus: "active",
      traceText: `我审计了"${nodeTitle}"，发现还需要更多直接证据才能下结论。`,
      inspectorSummary: "模拟审计表明，当前材料不足以支持强结论，建议标记为待验证。",
      canSay: ["可以用作背景信息", "可以支撑初步讨论"],
      cannotSay: ["不能作为直接因果证据", "不能推出确定性结论"],
      sources: [],
      model: "demo-fallback:evidence_audit",
    },
    counter: {
      controllerNote: `用户对"${nodeTitle}"发起反证生成。Demo 模式下返回模拟反证。`,
      agentTitle: "Counter 子 Agent",
      agentSubtitle: "模拟反证：生成替代解释和反面检查路径",
      resultTitle: "反向分支（模拟）",
      resultSubtitle: "可能的替代解释和削弱因素",
      resultStatus: "risk",
      traceText: `我沿着"${nodeTitle}"生成了反证路径，防止过度自信。`,
      inspectorSummary: "模拟反证提示：可能存在宏观经济、行业周期等替代解释。",
      canSay: ["存在替代解释的可能性", "需要考虑反面证据"],
      cannotSay: ["不能因此否定原判断", "不能将可能性当作确定性"],
      sources: ["模拟来源：反方观点综述"],
      model: "demo-fallback:counter",
    },
    rewrite: {
      controllerNote: `用户对"${nodeTitle}"发起局部改写。Demo 模式下返回模拟改写。`,
      agentTitle: "Composer 子 Agent",
      agentSubtitle: "模拟改写：基于当前证据给出更谨慎的表达",
      resultTitle: "局部改写（模拟）",
      resultSubtitle: "将强断言调整为证据允许的范围",
      resultStatus: "rewrite",
      traceText: `我改写了"${nodeTitle}"的表达，使其更符合现有证据。`,
      inspectorSummary: "模拟改写完成：原句中的强因果推断已调整为更谨慎的表述。",
      canSay: ["可以用更谨慎的方式表达原观点", "保留核心观点但降低断言强度"],
      cannotSay: ["不能在没有证据的情况下保留强断言", "不能把不确定性包装成确定性"],
      sources: [],
      model: "demo-fallback:rewrite",
    },
  };

  return fallbacks[mode] ?? fallbacks.evidence_audit;
}
