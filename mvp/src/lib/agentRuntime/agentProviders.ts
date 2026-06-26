import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentTextProviderId = "deepseek" | "mimo" | "stepfun" | "360" | "anthropic" | "codex";
export type AgentReasoningEffort = "low" | "medium" | "high";

export interface AgentProviderRequest {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
  env: Record<string, string>;
  codexBin: string;
  reasoningEffort?: AgentReasoningEffort;
  traceLabel?: string;
  deadlineAt?: number;
}

export interface AgentProviderResult {
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
}

function getProviderTimeoutMs(env: Record<string, string>, key: string, fallbackMs: number) {
  const value = Number(env[key] || process.env[key] || fallbackMs);
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

export function getAgentTextProviderOrder(env: Record<string, string>): AgentTextProviderId[] {
  const configured = env.ORCHESTRATE_TEXT_PROVIDER_ORDER || process.env.ORCHESTRATE_TEXT_PROVIDER_ORDER;
  const fallback: AgentTextProviderId[] = ["deepseek", "mimo", "stepfun", "360", "anthropic"];
  const allProviders: AgentTextProviderId[] = [...fallback, "codex"];
  if (!configured) return fallback;

  const valid = new Set(allProviders);
  const ordered: AgentTextProviderId[] = [];
  for (const item of configured.split(",").map((entry) => entry.trim().toLowerCase())) {
    if (!valid.has(item as AgentTextProviderId)) continue;
    const provider = item as AgentTextProviderId;
    if (!ordered.includes(provider)) ordered.push(provider);
  }
  const missing = fallback.filter((provider) => !ordered.includes(provider));
  return [...ordered, ...missing];
}

async function withProviderTimeout<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} provider 超时 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callAgentWithFallback({
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens,
  env,
  codexBin,
  reasoningEffort = "high",
  traceLabel = "Agent",
  deadlineAt,
}: AgentProviderRequest): Promise<AgentProviderResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const providerTimeoutMs = getProviderTimeoutMs(env, "ORCHESTRATE_PROVIDER_TIMEOUT_MS", 60000);
  const providerMaxTokens = getProviderMaxTokens(env, maxTokens);
  const inputBytes = new TextEncoder().encode(userContent).length;

  const runProvider = async <T,>(provider: string, modelName: string, call: (signal: AbortSignal) => Promise<T>) => {
    const providerStart = Date.now();
    const attemptTimeoutMs = getAttemptTimeoutMs(env, provider, providerTimeoutMs, traceLabel, deadlineAt);
    if (attemptTimeoutMs < 3000) {
      throw new Error(`${traceLabel} ${provider}:${modelName} 跳过：剩余总时限不足`);
    }
    console.info("[orchestrate-provider] start", {
      agent: traceLabel,
      provider,
      model: modelName,
      inputBytes,
      timeoutMs: attemptTimeoutMs,
    });
    try {
      const result = await withProviderTimeout(call, attemptTimeoutMs, `${traceLabel} ${provider}:${modelName}`);
      console.info("[orchestrate-provider] complete", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} 调用失败`;
      console.error("[orchestrate-provider] error", {
        agent: traceLabel,
        provider,
        model: modelName,
        latencyMs: Date.now() - providerStart,
        message,
      });
      throw error;
    }
  };

  const textProviderOrder = getAgentTextProviderOrder(env);
  console.info("[orchestrate-provider] order", { agent: traceLabel, order: textProviderOrder });

  for (const provider of textProviderOrder) {
    if (provider === "deepseek") {
      const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
      const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
      const deepseekModel = getDeepSeekModelForTrace(env, traceLabel);
      if (!deepseekApiKey) continue;

      try {
        const result = await runProvider("deepseek", deepseekModel, (signal) =>
          callDeepSeekAgent({
            apiKey: deepseekApiKey,
            baseUrl: deepseekBaseUrl,
            model: deepseekModel,
            systemPrompt,
            userContent,
            maxTokens: providerMaxTokens,
            signal,
          })
        );
        return parseProviderText(result, startTime);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "DeepSeek Agent 调用失败");
      }
    }

    if (provider === "mimo") {
      const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
      const mimoModel = env.MIMO_MODEL || process.env.MIMO_MODEL || "mimo-v2.5-pro";
      const primaryMimoCluster = (env.MIMO_BASE_URL || process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, "");
      const mimoClusters = shouldTryAllMimoClusters(env)
        ? [
          primaryMimoCluster,
          "https://token-plan-sgp.xiaomimimo.com/anthropic",
          "https://token-plan-ams.xiaomimimo.com/anthropic",
        ]
        : [primaryMimoCluster];
      if (!mimoApiKey) continue;

      for (const clusterUrl of mimoClusters) {
        try {
          const result = await runProvider("mimo", mimoModel, (signal) =>
            callMimoAgent({
              baseUrl: clusterUrl,
              apiKey: mimoApiKey,
              model: mimoModel,
              systemPrompt,
              userContent,
              maxTokens: providerMaxTokens,
              signal,
            })
          );
          return parseProviderText(result, startTime);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "MiMo Agent 调用失败";
          errors.push(`[${clusterUrl}] ${msg}`);
          if (msg.includes("Invalid API Key") || msg.includes('"code": "401"')) break;
        }
      }
    }

    if (provider === "stepfun") {
      const stepfunApiKey = env.STEPFUN_API_KEY || process.env.STEPFUN_API_KEY;
      const stepfunModel = env.STEPFUN_MODEL || process.env.STEPFUN_MODEL || "step-2-mini";
      const stepfunBaseUrl = (env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
      if (!stepfunApiKey) continue;

      try {
        const result = await runProvider("stepfun", stepfunModel, (signal) =>
          callStepFunAgent({
            baseUrl: stepfunBaseUrl,
            apiKey: stepfunApiKey,
            model: stepfunModel,
            systemPrompt,
            userContent,
            maxTokens: providerMaxTokens,
            reasoningEffort,
            signal,
          })
        );
        return parseProviderText(result, startTime);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "StepFun Agent 调用失败";
        errors.push(`[stepfun:${stepfunModel}] ${msg}`);
      }
    }

    if (provider === "360") {
      const ai360ApiKey = getSearch360ApiKey(env);
      const ai360BaseUrl = (env.AI360_BASE_URL || process.env.AI360_BASE_URL || "https://api.360.cn/v1").replace(/\/$/, "");
      const ai360Model =
        env.AI360_CHAT_MODEL ||
        env.AI360_MODEL ||
        process.env.AI360_CHAT_MODEL ||
        process.env.AI360_MODEL ||
        "360gpt-pro";
      if (!ai360ApiKey) continue;

      try {
        const result = await runProvider("360", ai360Model, (signal) =>
          call360ChatAgent({
            apiKey: ai360ApiKey,
            baseUrl: ai360BaseUrl,
            model: ai360Model,
            systemPrompt,
            userContent,
            maxTokens: providerMaxTokens,
            signal,
          })
        );
        return parseProviderText(result, startTime);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "360 智脑 Agent 调用失败";
        errors.push(`[360:${ai360Model}] ${msg}`);
      }
    }

    if (provider === "anthropic") {
      const anthropicConfig = await loadAnthropicConfig(env);
      if (!anthropicConfig?.baseUrl || !anthropicConfig.model) continue;

      try {
        const result = await runProvider("anthropic-local", anthropicConfig.model, (signal) =>
          callAnthropicAgent({
            baseUrl: anthropicConfig.baseUrl,
            token: anthropicConfig.token,
            model: anthropicConfig.model,
            systemPrompt,
            userContent,
            maxTokens: providerMaxTokens,
            signal,
          })
        );
        return parseProviderText(result, startTime);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Anthropic Agent 调用失败");
      }
    }

    if (provider === "codex") {
      try {
        const codexModel = env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5";
        const result = await runProvider("codex-cli", codexModel, () =>
          callCodexAgent({
            codexBin,
            model: codexModel,
            systemPrompt,
            userContent,
            responseSchema,
            maxTokens: providerMaxTokens,
          })
        );
        return parseProviderText(result, startTime);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Codex Agent 调用失败");
      }
    }
  }

  throw new Error(errors.join("；") || "没有可用的 Agent provider");
}

function getAttemptTimeoutMs(
  env: Record<string, string>,
  provider: string,
  configuredTimeoutMs: number,
  traceLabel: string,
  deadlineAt?: number
) {
  const providerKey = `ORCHESTRATE_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TIMEOUT_MS`;
  const providerConfigured = getProviderTimeoutMs(env, providerKey, configuredTimeoutMs);
  const isDeepSeek = provider === "deepseek";
  const isFactReasoningDeepSeek = isDeepSeek && (traceLabel === "FactChecker" || traceLabel === "SourceValidator");
  const isReportComposerDeepSeek = isDeepSeek && traceLabel === "ReportComposer";
  const factReasoningDeepSeekTimeout = getProviderTimeoutMs(env, "ORCHESTRATE_FACT_REASONING_DEEPSEEK_TIMEOUT_MS", 65000);
  const reportComposerDeepSeekTimeout = getProviderTimeoutMs(env, "ORCHESTRATE_REPORT_COMPOSER_DEEPSEEK_TIMEOUT_MS", 85000);
  const providerCap = provider === "mimo"
    ? 12000
    : provider === "deepseek"
      ? isReportComposerDeepSeek
        ? reportComposerDeepSeekTimeout
        : isFactReasoningDeepSeek
          ? factReasoningDeepSeekTimeout
          : 45000
      : provider === "stepfun"
        ? 35000
        : provider === "360"
          ? 25000
          : configuredTimeoutMs;
  const timeoutMs = isReportComposerDeepSeek
    ? providerCap
    : isFactReasoningDeepSeek
      ? Math.min(providerConfigured, providerCap)
    : Math.min(configuredTimeoutMs, providerConfigured, providerCap);
  if (!deadlineAt) return timeoutMs;
  const remainingMs = deadlineAt - Date.now() - 1500;
  return Math.max(0, Math.min(timeoutMs, remainingMs));
}

function getProviderMaxTokens(env: Record<string, string>, requestedMaxTokens: number) {
  const configured = Number(env.ORCHESTRATE_PROVIDER_MAX_TOKENS || process.env.ORCHESTRATE_PROVIDER_MAX_TOKENS || 0);
  if (Number.isFinite(configured) && configured > 0) return Math.max(requestedMaxTokens, configured);
  return requestedMaxTokens;
}

function getDeepSeekModelForTrace(env: Record<string, string>, traceLabel: string) {
  const normalized = traceLabel.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  const traceKey = `DEEPSEEK_${normalized}_MODEL`;
  return env[traceKey] || process.env[traceKey] || env.DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
}

function shouldTryAllMimoClusters(env: Record<string, string>) {
  return (env.MIMO_TRY_ALL_CLUSTERS || process.env.MIMO_TRY_ALL_CLUSTERS || "").trim() === "1";
}

function parseProviderText(result: { text: string; model: string }, startTime: number): AgentProviderResult {
  return {
    output: parseProviderJson(result.text),
    model: result.model,
    latencyMs: Date.now() - startTime,
  };
}

function parseProviderJson(text: string) {
  const jsonText = extractJsonObject(text);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = repairLikelyJsonSyntax(jsonText);
    try {
      return JSON.parse(repaired);
    } catch {
      throw error;
    }
  }
}

function repairLikelyJsonSyntax(jsonText: string) {
  return jsonText
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/"(\s*\r?\n\s*)"/g, '",$1"')
    .replace(/"(\s*\r?\n\s*)("[^"\r\n]+":)/g, '",$1$2')
    .replace(/([}\]])(\s*\r?\n\s*)([{[])/g, "$1,$2$3");
}

async function call360ChatAgent({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  signal: AbortSignal;
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
    signal,
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

async function callMimoAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  signal,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  signal: AbortSignal;
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
    signal,
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
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  signal: AbortSignal;
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
    signal,
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
  signal,
}: {
  baseUrl: string;
  token: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  signal: AbortSignal;
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
    signal,
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

// Reasoning 系列模型（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
// 三者皆会触发 400 Invalid request。仅 chat 模型才发这些字段。
export function buildStepFunRequestBody({
  model,
  messages,
  maxTokens,
  responseFormat,
  temperature,
  reasoningEffort,
}: {
  model: string;
  messages: unknown[];
  maxTokens: number;
  responseFormat?: { type: "json_object" };
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Record<string, unknown> {
  const isReasoning = /^step-3\.7-flash$/i.test(model);
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
  };
  if (!isReasoning) {
    if (responseFormat !== undefined) body.response_format = responseFormat;
    if (temperature !== undefined) body.temperature = temperature;
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort;
  }
  return body;
}

async function callStepFunAgent({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userContent,
  maxTokens,
  reasoningEffort = "high",
  signal,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  reasoningEffort?: AgentReasoningEffort;
  signal: AbortSignal;
}) {
  // Reasoning 系列模型（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
  // 三者皆会触发 400 Invalid request。仅 chat 模型才发这些字段。
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildStepFunRequestBody({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        maxTokens,
        responseFormat: { type: "json_object" },
        temperature: 0.3,
        reasoningEffort,
      })
    ),
    signal,
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

async function loadAnthropicConfig(env: Record<string, string>) {
  const token = env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseUrl = (env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "").replace(/\/$/, "");
  const model = env.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "";
  if (!token || !baseUrl || !model) return null;
  return { token, baseUrl, model };
}

function getSearch360ApiKey(env: Record<string, string>) {
  return (
    env.QIHOO_360_API_KEY ||
    env.ZHINAO_API_KEY ||
    env.AI360_API_KEY ||
    process.env.QIHOO_360_API_KEY ||
    process.env.ZHINAO_API_KEY ||
    process.env.AI360_API_KEY ||
    ""
  );
}

function extractChatCompletionText(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function describeEmptyChatCompletion(data: any) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason || choice?.finishReason || "unknown";
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  return `finish_reason=${finishReason}, content_type=${typeof message?.content}, reasoning_chars=${reasoning.length}`;
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
