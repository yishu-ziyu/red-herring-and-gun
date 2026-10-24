import Anthropic from "@anthropic-ai/sdk";
import { getTimeoutMs } from "../executionBudget.js";
import { emptyReplyError, envValue, isQuotaReply, modelFromEnv, ProviderError, type ModelProvider } from "./provider.js";

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;
type ImageMediaType = Anthropic.Base64ImageSource["media_type"];

const MAX_OUTPUT_TOKENS = 64000;
const DEFAULT_TIMEOUT_MS = 120000;
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const IMAGE_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function effortFor(env: Record<string, string>): Effort {
  const raw = envValue(env, "ANTHROPIC_EFFORT").toLowerCase() as Effort;
  return EFFORTS.includes(raw) ? raw : "medium";
}

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return { type: "image", source: { type: "url", url } };
  const mediaType = match[1].toLowerCase() as ImageMediaType;
  if (!IMAGE_TYPES.includes(mediaType)) {
    throw new ProviderError("http", `Anthropic 不支持的图片格式：${match[1]}`);
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } };
}

/** The router owns retries and fallback, so every SDK failure becomes a ProviderError kind it already understands. */
function toProviderError(error: unknown): unknown {
  if (error instanceof ProviderError || error instanceof Anthropic.APIUserAbortError) return error;
  if (!(error instanceof Anthropic.APIError)) return error;
  const detail = `Anthropic API 调用失败：${error.status ? `HTTP ${error.status} ` : ""}${error.message}`;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("auth", detail, error);
  }
  // 429 is per-minute throttling: fall through to the next provider without parking this one for 10 minutes.
  if (error instanceof Anthropic.RateLimitError) return new ProviderError("http", detail, error);
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("connect", detail, error);
  if (error.status === 402 || error.type === "billing_error" || isQuotaReply(error.message)) {
    return new ProviderError("quota", detail, error);
  }
  return new ProviderError("http", detail, error);
}

export const anthropic: ModelProvider = {
  id: "anthropic",
  vision: true,
  apiKeyEnv: "ANTHROPIC_API_KEY",
  configured: (env) => Boolean(envValue(env, "ANTHROPIC_API_KEY")),
  modelFor: (env, agentId) => modelFromEnv(env, "ANTHROPIC", agentId, "claude-haiku-5-5"),
  timeoutMs: (env) => getTimeoutMs(env, "ANTHROPIC_PROVIDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  skipAfterTimeouts: () => 2,
  async call({ env, model, system, user, images, maxTokens, signal }) {
    const client = new Anthropic({
      apiKey: envValue(env, "ANTHROPIC_API_KEY"),
      authToken: null,
      baseURL: envValue(env, "ANTHROPIC_BASE_URL") || undefined,
      maxRetries: 0,
      timeout: anthropic.timeoutMs(env, model),
    });
    const content: Anthropic.ContentBlockParam[] = [
      ...(images ?? []).map(imageBlock),
      { type: "text", text: user },
    ];
    let message: Anthropic.Message;
    try {
      // Thinking is adaptive and on by default on Haiku 5.5; sampling params and prefill are rejected.
      message = await client.messages
        .stream(
          {
            model,
            max_tokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
            system,
            messages: [{ role: "user", content }],
            output_config: { effort: effortFor(env) },
          },
          { signal }
        )
        .finalMessage();
    } catch (error) {
      throw toProviderError(error);
    }

    const ending = `stop_reason=${message.stop_reason}, output_tokens=${message.usage.output_tokens}`;
    if (message.stop_reason === "refusal") {
      throw new ProviderError("http", `Anthropic 拒绝回答（category=${message.stop_details?.category ?? "none"}，${ending}）`);
    }
    if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
      throw emptyReplyError("Anthropic", `（输出被截断，${ending}, max_tokens=${Math.min(maxTokens, MAX_OUTPUT_TOKENS)}）。`);
    }
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text) throw emptyReplyError("Anthropic", `（${ending}）。`);
    return { text, model: `anthropic:${message.model}` };
  },
};
