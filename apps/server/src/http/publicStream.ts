/**
 * 公开 SSE 的清洗：浏览器只收用户可读文案。原始 provider 诊断留在服务端 logger，
 * 不随 detail / providerErrors 下发，避免 UI 或网络面板泄漏运维信息。
 */

// provider 名不得出现在公开流（产品规则：用户不看见模型 ID）。
// model 字段与「provider:model」形状的字符串值（_scoreSource 等）一并清空，
// latencyMs 整个删除；普通正文不匹配模型引用形状，不受影响。服务端 logger 保留全量诊断。
const PROVIDER_NAME_RE = /minimax|stepfun|deepseek|360gpt|ai360|mimo|anthropic|openai|moonshot|kimi/i;

const MODEL_REF_RE = /^[a-z0-9_-]+:[A-Za-z0-9._-]+$/;

function scrubProviderDiagnostics(value: unknown, depth = 0): unknown {
  // 超深子树无法证明已清洗，截断而不是把原始值直接公开。
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((item) => scrubProviderDiagnostics(item, depth + 1));
  if (value && typeof value === "object") {
    // 搜索失败对象含原始诊断，连 evidenceGaps 都可混入报错。公开层只保留失败标记。
    if ((value as Record<string, unknown>)._source === "tool-error") return { _source: "tool-error" };
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // systemPrompt / userContent 是内部工程文本（含 provider 名与规则清单），
      // 前端过程层不读取，剥离后顺带大幅减小公开载荷。
      if (key === "latencyMs" || key === "systemPrompt" || key === "userContent" || key === "traceText" || key === "providerErrors") continue;
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

type ProviderProgress = { id: string; label: string; status: string; resultCount: number };
type ProgressSource = { title: string; url: string; providerOrigins?: string[] };

// 搜索服务名同样不公开：按本条事件里的顺序改成「检索通道 N」，同一次运行里顺序固定，编号稳定。
function anonymizeSearchProgress(event: Record<string, unknown>) {
  const providers = (event.providers as ProviderProgress[] | undefined) ?? [];
  const channelOf = new Map(providers.map((p, i) => [p.id, `channel-${i + 1}`]));
  event.providers = providers.map((p, i) => ({ id: `channel-${i + 1}`, label: `检索通道 ${i + 1}`, status: p.status, resultCount: p.resultCount }));
  if (Array.isArray(event.sources)) {
    event.sources = (event.sources as ProgressSource[]).map(({ providerOrigins, ...source }) => ({
      ...source,
      channels: (providerOrigins ?? []).map((id) => channelOf.get(id)).filter(Boolean),
    }));
  }
}

// 搜索结果的 answer 是搜索服务拼出的原文串（带服务名与请求号），检索缺口里混着运维报错，都不公开。
function dropSearchDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) dropSearchDiagnostics(item);
  delete (value as Record<string, unknown>).answer;
  delete (value as Record<string, unknown>).unresolvedEvidenceGaps;
}

export function toPublicStreamEvent(data: object): Record<string, unknown> {
  const event = scrubProviderDiagnostics(data) as Record<string, unknown>;
  if (event.type === "search_progress") anonymizeSearchProgress(event);
  if (event.type === "tool_result" || event.type === "tool_start") dropSearchDiagnostics(event.result);
  delete event.detail;
  delete event.providerErrors;
  if (
    event.type === "error" &&
    event.code !== "checks_exhausted" &&
    event.code !== "image_unreadable"
  ) {
    event.message = "这次核查没能完成，请稍后重试";
    delete event.error;
  } else if (event.type === "agent_error" || event.type === "tool_error") {
    event.error = "这一步没能完成，核查会按现有材料继续";
    delete event.message;
  }
  return event;
}
