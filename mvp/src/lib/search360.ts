import type { Search360Request, Search360Response } from "./schemas";
import { enrichSearch360Source } from "./sourceCredibility";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export function build360SearchDemoFallback(query: string): Search360Response {
  const supportQuery = build360SupportQuery(query);
  const contradictQuery = build360ContradictQuery(query);

  return {
    answer: "",
    sources: [],
    supportQuery,
    contradictQuery,
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: ["360 搜索服务未返回真实结果，系统不生成搜索摘要或证据判断。"],
    relatedQuestions: [],
    model: "demo-fallback:360",
    traceText: `360 搜索服务未返回真实结果：“${query}”暂不生成补充解释。`,
    _source: "demo-fallback",
  };
}

export function build360SupportQuery(claim: string): string {
  return `${claim} 证据 来源 官方说明 原始出处`;
}

export function build360ContradictQuery(claim: string): string {
  return `${claim} 辟谣 反例 争议 无法证实 误读`;
}

export function enrich360SearchResponse(response: Search360Response, request: Search360Request): Search360Response {
  const direction = request.direction ?? "neutral";
  const sources = response.sources.map((source, index) => enrichSearch360Source(source, index, {
    query: request.query,
    direction,
  }));
  const supportingEvidence = response.supportingEvidence?.length
    ? response.supportingEvidence.map((source, index) => enrichSearch360Source(source, index, {
        query: request.query,
        direction: "support",
      }))
    : sources.filter((source) => source.evidenceRole === "支持" || source.evidenceRole === "限定" || source.evidenceRole === "背景");
  const contradictingEvidence = response.contradictingEvidence?.length
    ? response.contradictingEvidence.map((source, index) => enrichSearch360Source(source, index, {
        query: request.query,
        direction: "contradict",
      }))
    : sources.filter((source) => source.evidenceRole === "反驳");

  return {
    ...response,
    sources,
    supportQuery: response.supportQuery ?? build360SupportQuery(request.claim ?? request.query),
    contradictQuery: response.contradictQuery ?? build360ContradictQuery(request.claim ?? request.query),
    supportingEvidence,
    contradictingEvidence,
    unresolvedEvidenceGaps:
      response.unresolvedEvidenceGaps ??
      (contradictingEvidence.length === 0 ? ["未找到明确反证，仍需扩大辟谣/反例检索范围"] : []),
  };
}

export async function request360BidirectionalSearch(payload: Search360Request): Promise<Search360Response> {
  const claim = payload.claim ?? payload.query;
  const [support, contradict] = await Promise.all([
    request360Search({ ...payload, query: build360SupportQuery(claim), claim, direction: "support" }),
    request360Search({ ...payload, query: build360ContradictQuery(claim), claim, direction: "contradict" }),
  ]);

  const supportingEvidence = support.sources.map((source, index) => enrichSearch360Source(source, index, {
    query: support.supportQuery ?? support.traceText ?? claim,
    direction: "support",
  }));
  const contradictingEvidence = contradict.sources.map((source, index) => enrichSearch360Source(source, index, {
    query: contradict.contradictQuery ?? contradict.traceText ?? claim,
    direction: "contradict",
  }));
  const sources = [...supportingEvidence, ...contradictingEvidence].map((source, index) => ({
    ...source,
    id: source.id ?? `S${index + 1}`,
  }));

  return {
    answer: [
      `支持检索：${support.answer}`,
      `反驳检索：${contradict.answer}`,
    ].join("\n\n"),
    sources,
    supportQuery: build360SupportQuery(claim),
    contradictQuery: build360ContradictQuery(claim),
    supportingEvidence,
    contradictingEvidence,
    unresolvedEvidenceGaps: contradictingEvidence.length > 0
      ? []
      : ["未找到明确反证或辟谣材料，需要人工继续选择 frontier 深挖"],
    relatedQuestions: Array.from(new Set([
      ...(support.relatedQuestions ?? []),
      ...(contradict.relatedQuestions ?? []),
      `${claim} 官方回应`,
      `${claim} 辟谣`,
    ])).slice(0, 6),
    model: `${support.model ?? "360"} + ${contradict.model ?? "360"}`,
    traceText: `360 双向搜索完成：支持来源 ${supportingEvidence.length} 条，反驳来源 ${contradictingEvidence.length} 条。`,
    _source: support._source === "360-ai-search" || contradict._source === "360-ai-search" ? "360-ai-search" : "demo-fallback",
  };
}

export async function request360Search(payload: Search360Request): Promise<Search360Response> {
  const response = await fetch(`${API_BASE}/api/search/360`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as Search360Response | { message?: string } | null;

  if (!response.ok || !data) {
    const message = data && "message" in data && data.message
      ? data.message
      : `HTTP ${response.status}`;
    throw new Error(`360 Search API 未返回真实结果：${message}`);
  }

  const enriched = enrich360SearchResponse(data as Search360Response, payload);
  if (!["360-ai-search", "anysearch-search", "metaso-search", "tavily-search", "exa-search", "parallel-search"].includes(enriched._source ?? "")) {
    throw new Error("搜索 API 返回非真实搜索结果，本轮不生成搜索摘要或证据判断。");
  }

  return enriched;
}

export async function requestProviderSearch(
  provider: "360_search" | "any_search" | "metaso_search" | "tavily_search" | "exa_search",
  payload: Search360Request
): Promise<Search360Response> {
  const response = await fetch(`${API_BASE}/api/search/provider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, provider }),
  });

  const data = (await response.json().catch(() => null)) as Search360Response | { message?: string } | null;

  if (!response.ok || !data) {
    const message = data && "message" in data && data.message
      ? data.message
      : `HTTP ${response.status}`;
    throw new Error(`${provider} 未返回真实结果：${message}`);
  }

  const enriched = enrich360SearchResponse(data as Search360Response, payload);
  if (!["360-ai-search", "anysearch-search", "metaso-search", "tavily-search", "exa-search"].includes(enriched._source ?? "")) {
    throw new Error(`${provider} 返回非真实搜索结果，本轮不生成搜索摘要或证据判断。`);
  }

  return enriched;
}
