import {
  callAgentWithFallback,
  ProviderFallbackError,
  type AgentTextProviderId,
} from "./providerRouter.js";

export type LlmEnv = Readonly<Record<string, string | undefined>>;

export type CallJobParams = {
  job: string;
  systemPrompt: string;
  userContent: string;
  responseSchema?: object;
  maxTokens?: number;
  env: LlmEnv;
  modelOverride?: { provider: AgentTextProviderId; model: string };
  reasoningEffort?: "low" | "medium" | "high";
};

export type CallJobResult = {
  /** 已 JSON.parse 的模型输出；调用方用 typebox 按工单 schema 校验后再用 */
  output: unknown;
  model: string;
  latencyMs: number;
  reasoning?: string;
};

const DEFAULT_MAX_TOKENS = 4096;

function toRouterEnv(env: LlmEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function appendSchema(systemPrompt: string, responseSchema: object | undefined): string {
  if (responseSchema === undefined) return systemPrompt;
  // 云厂商 HTTP 适配不消费 responseSchema，只能附到 prompt；Codex 仍走 --output-schema。
  return `${systemPrompt}\n\n# RESPONSE SCHEMA\n${JSON.stringify(responseSchema)}`;
}

export async function callJob({
  job,
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens = DEFAULT_MAX_TOKENS,
  env,
  modelOverride,
  reasoningEffort,
}: CallJobParams): Promise<CallJobResult> {
  const routerEnv = toRouterEnv(env);
  try {
    const result = await callAgentWithFallback({
      agentId: job,
      systemPrompt: appendSchema(systemPrompt, responseSchema),
      userContent,
      responseSchema: responseSchema ?? {},
      maxTokens,
      env: routerEnv,
      codexBin: routerEnv.CODEX_BIN || "",
      reasoningEffort,
      modelOverride,
    });
    return {
      output: result.output,
      model: result.model,
      latencyMs: result.latencyMs,
      ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    };
  } catch (error) {
    if (error instanceof ProviderFallbackError) {
      throw new Error(`${error.message}: ${error.providerErrors.join("; ")}`);
    }
    throw error;
  }
}
