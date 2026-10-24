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
      // model 字段只装模型或搜索服务的标识，前端不读，一律不下发。
      if (key === "model" && typeof item === "string") continue;
      if (typeof item === "string" && PROVIDER_NAME_RE.test(item) && MODEL_REF_RE.test(item)) continue;
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

// 搜索结果的 answer 是搜索服务拼出的原文串（带服务名与请求号），检索缺口里混着运维报错，
// providerOrigins 是搜索服务 ID，都不公开。
function dropSearchDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) dropSearchDiagnostics(item);
  delete (value as Record<string, unknown>).answer;
  delete (value as Record<string, unknown>).unresolvedEvidenceGaps;
  delete (value as Record<string, unknown>).providerOrigins;
}

// 模型写的思考和审核结论会提到搜索服务、模型服务（「360 AI Search 的 AnySearch 聚合答案」）。
// 根因已在检索侧去掉（喂给模型的材料不再带服务名），这里兜底旧数据和模型自己的说法：
// 连着写的一串服务名（含「的」「/」「返回的」这类连接）整体换成一个泛称，句子仍然读得通。
const SEARCH_SERVICE_NAMES = [
  String.raw`360\s*(?:AI\s*)?Search`, String.raw`360\s*智搜`, String.raw`search_?360`, String.raw`360_search`,
  // 「360 AnySearch」「360 sources」：紧挨着其他服务名或检索产出的 360 才算服务名，别的 360 是数字。
  String.raw`360(?=[\s/]*(?:any_?search|metaso|tavily|exa|sources?|answers?|results?|snippets?|says|来源|答案|结果|返回)(?![A-Za-z]))`,
  String.raw`any_?search(?::[\w-]+)?`, String.raw`metaso(?:[-_\s]?search)?(?::[\w-]+)?`, String.raw`秘塔(?:AI)?(?:搜索)?`,
  String.raw`tavily(?:[-_\s]?search)?`, String.raw`exa(?:[-_\s]?search)?`,
  String.raw`MiniMax\s*Token\s*Plan`, String.raw`(?:阶跃\s*)?Step\s*Plan`, String.raw`(?:MiniMax|StepFun)[\s_-]*search`,
  // MiniMax、阶跃同时供模型和搜索；后面跟着检索产出时按搜索服务说。
  String.raw`(?:MiniMax|StepFun|阶跃)(?=\s*(?:结果|来源|返回|搜索|检索|results?|sources?|answers?)(?![A-Za-z]))`,
  String.raw`coding[-_\s]?plan(?:[-_\s]?web[-_\s]?search)?`,
];
const MODEL_SERVICE_NAMES = [
  String.raw`MiniMax(?:-M[\w.-]*)?`, String.raw`StepFun(?:\s*Vision)?`, String.raw`阶跃(?:星辰)?`, String.raw`step-\d+(?:\.\d+)?-[a-z][\w.-]*`,
  String.raw`claude-[a-z]+-[\w.-]+`, String.raw`Anthropic`,
];
// ASCII 名字不能是更长单词的一部分（exa 不碰 example）。
const nameAlt = (names: string[]) => `(?<![A-Za-z])(?:${names.join("|")})(?![A-Za-z])`;
const ANY_SERVICE = `(?:${nameAlt(SEARCH_SERVICE_NAMES)}|${nameAlt(MODEL_SERVICE_NAMES)})`;
const SERVICE_RUN_RE = new RegExp(
  `${ANY_SERVICE}(?:\\s*(?:返回的|提供的|里的|中的|的|/|、|\\+|\\||和|与|及|或|and|or|,)?\\s*${ANY_SERVICE})*`,
  "gi",
);
const SEARCH_SERVICE_AT_RE = new RegExp(nameAlt(SEARCH_SERVICE_NAMES), "iy");
const CJK_RE = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

function scrubServiceNames(text: string): string {
  return text
    .replace(SERVICE_RUN_RE, (run, offset: number, whole: string) => {
      const before = whole.slice(0, offset).trimEnd().slice(-1);
      const after = whole.slice(offset + run.length).trimStart().slice(0, 1);
      const zh = CJK_RE.test(before) || CJK_RE.test(after);
      // 在原文里逐位查：「MiniMax结果」要连后文一起看才认得出是搜索服务。
      for (let at = offset; at < offset + run.length; at += 1) {
        SEARCH_SERVICE_AT_RE.lastIndex = at;
        if (SEARCH_SERVICE_AT_RE.test(whole)) return zh ? "搜索服务" : "search service";
      }
      return zh ? "模型" : "model";
    })
    .replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=搜索服务|模型)|(?<=搜索服务|模型)[ \t]+(?=[\u4e00-\u9fff])/g, "")
    .replace(/(搜索服务|模型)\1+/g, "$1");
}

// 原样摘抄的材料（来源标题、摘要、原话）和用户的说法不改写，只改模型自己写的文字。
const VERBATIM_KEY_RE = /^(?:url|title|snippet|quote|passage|excerpt|claim|claimAtom|claimAtoms|originalClaim|displayClaim)$/;

function scrubAgentText(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubServiceNames(value);
  if (depth > 8 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubAgentText(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = VERBATIM_KEY_RE.test(key) ? item : scrubAgentText(item, depth + 1);
  }
  return out;
}

export function toPublicStreamEvent(data: object): Record<string, unknown> {
  const event = scrubProviderDiagnostics(data) as Record<string, unknown>;
  if (event.type === "search_progress") anonymizeSearchProgress(event);
  if (event.type === "tool_result" || event.type === "tool_start") dropSearchDiagnostics(event.result);
  if (event.type === "agent_thought" && typeof event.content === "string") event.content = scrubServiceNames(event.content);
  if (event.type === "agent_complete") event.output = scrubAgentText(event.output);
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
