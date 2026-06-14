// ───────────────────────────────────────────────────────────────
// Server-side LLM provider HTTP adapters
// 为 4-Agent pipeline 提供 6 个 LLM provider 的 OpenAI / Anthropic 兼容调用
// 任何 router（callAgentWithFallback）通过 import 这些函数调度
// ───────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ───────────────────────────────────────────────────────────────
// Response text extractors（OpenAI 兼容 / Anthropic 兼容 / 空响应诊断）
// ───────────────────────────────────────────────────────────────

/**
 * 从 OpenAI 兼容协议的 JSON 响应中提取首个 choice 的文本。
 * 支持 content 是 string 或 array-of-parts（reasoning 模型常见）两种形态。
 */
export function extractChatCompletionText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * 当 OpenAI 兼容响应返回空文本时，描述 finish_reason / content 类型 / 推理长度，
 * 方便定位是 length_truncated 还是 reasoning_only 等场景。
 */
export function describeEmptyChatCompletion(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason || choice?.finishReason || "unknown";
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  return `finish_reason=${finishReason}, content_type=${typeof message?.content}, reasoning_chars=${reasoning.length}`;
}

/**
 * 从 Anthropic 兼容响应中提取 text。
 * 支持两种入口：完整 JSON 响应（{content:[{text}]}）和 SSE 流式（data: {delta:{text}}）。
 */
export function extractAnthropicText(raw: string): string {
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

function extractAnthropicContent(data: any): string {
  const parts: string[] = [];
  for (const item of data?.content ?? []) {
    if (typeof item?.text === "string") parts.push(item.text);
  }
  return parts.join("");
}

// ───────────────────────────────────────────────────────────────
// Provider 1: DeepSeek（OpenAI 兼容 + json_object 强制）
// ───────────────────────────────────────────────────────────────

export async function callDeepSeekAgent({
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

// ───────────────────────────────────────────────────────────────
// Provider 2: MiMo（Anthropic 兼容，多集群 fallback 在 router 层）
// ───────────────────────────────────────────────────────────────

export async function callMimoAgent({
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

// ───────────────────────────────────────────────────────────────
// Provider 3: StepFun 阶跃星辰（OpenAI 兼容 + reasoning_effort）
// ───────────────────────────────────────────────────────────────

export async function callStepFunAgent({
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
  if (!text) throw new Error(`StepFun API 没有返回可解析文本（${describeEmptyChatCompletion(data)}）。`);

  return { text, model: `stepfun:${model}` };
}

// ───────────────────────────────────────────────────────────────
// Provider 4: 360 智脑（OpenAI 兼容）
// ───────────────────────────────────────────────────────────────

export async function call360ChatAgent({
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
      stream: false,
      temperature: 0.3,
      max_tokens: maxTokens,
      top_p: 0.8,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`360 智脑 API 调用失败：${detail}`);
  }
  const text = extractChatCompletionText(data);
  if (!text) throw new Error("360 智脑 API 没有返回可解析文本。");
  return { text, model: `360-chat:${model}` };
}

// ───────────────────────────────────────────────────────────────
// Provider 5: Anthropic proxy（Anthropic 兼容，baseUrl 由 ANTHROPIC_BASE_URL env 决定）
// ───────────────────────────────────────────────────────────────

export async function callAnthropicAgent({
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

// ───────────────────────────────────────────────────────────────
// Provider 6: 本地 Codex CLI（subprocess 调用 codex exec）
// 输出 raw JSON（不解析），router 用 parseAgentJson 二次处理
// ───────────────────────────────────────────────────────────────

export async function callCodexAgent({
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
