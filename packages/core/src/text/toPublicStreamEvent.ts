// ───────────────────────────────────────────────────────────────
// 公开 SSE 只发用户可读文案。原始 provider 诊断留在服务端 logger，
// 不再随 detail / providerErrors 下发到浏览器，避免 UI 或网络面板泄漏运维信息。
// ───────────────────────────────────────────────────────────────
export interface FriendlyErrorInfo {
  /** 用户可读友好文案（不包含原始诊断） */
  message: string;
  /** 原始诊断串（可选；仅当原始串与友好文案不同才携带） */
  detail?: string;
  /** provider 级错误明细（可选） */
  providerErrors?: string[];
}

export function toFriendlyError(error: unknown, fallback: string): FriendlyErrorInfo {
  void error;
  return { message: fallback };
}

// provider 名不得出现在公开流（产品规则：用户不看见模型 ID）。
// model 字段与「provider:model」形状的字符串值（_scoreSource 等）一并清空，
// latencyMs 整个删除；普通正文不匹配模型引用形状，不受影响。服务端 logger 保留全量诊断。
const PROVIDER_NAME_RE = /minimax|stepfun|deepseek|360gpt|ai360|mimo|anthropic|openai|moonshot|kimi/i;
const MODEL_REF_RE = /^[a-z0-9_-]+:[A-Za-z0-9._-]+$/;
const STRIP_KEYS = new Set([
  "provider",
  "model",
  "error",
  "requestId",
  "request_id",
  "latency",
  "latencyMs",
  "systemPrompt",
  "userContent",
]);

function scrubProviderDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => scrubProviderDiagnostics(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) continue;
      if (
        typeof item === "string" &&
        PROVIDER_NAME_RE.test(item) &&
        (key === "model" || MODEL_REF_RE.test(item))
      ) {
        continue;
      }
      out[key] = scrubProviderDiagnostics(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function toPublicStreamEvent(data: object): Record<string, unknown> {
  const event = scrubProviderDiagnostics(data) as Record<string, unknown>;
  delete event.detail;
  delete event.providerErrors;
  if (event.type === "error" && event.code !== "checks_exhausted") {
    event.message = "这次核查没能完成，请稍后重试";
    delete event.error;
  } else if (event.type === "agent_error" || event.type === "tool_error") {
    event.error = "这一步没能完成，核查会按现有材料继续";
    delete event.message;
  }
  return event;
}
