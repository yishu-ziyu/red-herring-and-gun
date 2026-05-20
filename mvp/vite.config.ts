import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

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
const allowedStatuses = new Set(["risk", "active", "supported", "limited", "blocked", "rewrite"]);

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

    try {
      const payload = await readJson(req);
      const llmResult = apiKey ? await callOpenAI({ apiKey, baseUrl, model, payload }) : await callLocalProvider({ codexBin, model: codexModel, payload, env });
      return sendJson(res, 200, llmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知 LLM 调用错误";
      return sendJson(res, 500, { message });
    }
  }

  return {
    name: "suzheng-agent-api",
    configureServer(server: any) {
      server.middlewares.use("/api/agent/expand", handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use("/api/agent/expand", handler);
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
  const anthropicConfig = await loadAnthropicConfig(env);
  const errors: string[] = [];

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
    "你是溯证 Agent 的中控 LLM。",
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
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  return [
    "你是溯证 Agent 的中控 LLM。",
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
