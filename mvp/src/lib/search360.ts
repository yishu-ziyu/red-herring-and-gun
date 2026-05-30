import type { Search360Request, Search360Response, Search360Source } from "./schemas";
import { enrichSearch360Source } from "./sourceCredibility";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export function build360SearchDemoFallback(query: string): Search360Response {
  const supportQuery = build360SupportQuery(query);
  const contradictQuery = build360ContradictQuery(query);
  const sources: Search360Source[] = [
    {
      title: "权威机构公开说明（模拟）",
      url: "https://example.com/official-clarification",
      snippet: "模拟来源显示，该信息需要以官方公开公告为准，不能仅凭社交平台转发判断。",
    },
    {
      title: "主流媒体核查报道（模拟）",
      url: "https://example.com/fact-check-report",
      snippet: "模拟报道指出，原始说法存在断章取义或夸大风险，需要补充上下文。",
    },
    {
      title: "社交平台传播线索（模拟）",
      url: "https://example.com/social-post",
      snippet: "模拟线索显示该说法最早来自匿名账号，来源可追溯性较弱。",
    },
  ].map((source, index) => enrichSearch360Source(source, index, {
    query,
    direction: index === 1 ? "contradict" : index === 2 ? "neutral" : "support",
  }));

  return {
    answer: `Demo 模式：围绕“${query}”返回 360 智搜风格的模拟结果。真实环境会调用 360 AI Search，并把答案和来源接入画布。`,
    sources,
    supportQuery,
    contradictQuery,
    supportingEvidence: sources.filter((source) => source.evidenceRole === "支持"),
    contradictingEvidence: sources.filter((source) => source.evidenceRole === "反驳"),
    unresolvedEvidenceGaps: ["缺少原始出处", "缺少独立权威交叉验证"],
    relatedQuestions: [
      `${query} 官方回应`,
      `${query} 辟谣`,
      `${query} 证据来源`,
    ],
    model: "demo-fallback:360",
    traceText: "360 智搜未配置或调用失败，已使用可见 demo fallback。",
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
  try {
    const response = await fetch(`${API_BASE}/api/search/360`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as Search360Response | { message?: string } | null;

    if (!response.ok || !data) {
      console.warn(`360 Search API 失败 (HTTP ${response.status})，使用 demo fallback`);
      return build360SearchDemoFallback(payload.query);
    }

    return enrich360SearchResponse(data as Search360Response, payload);
  } catch (error) {
    console.warn("360 Search API 调用异常，使用 demo fallback:", error);
    return build360SearchDemoFallback(payload.query);
  }
}
