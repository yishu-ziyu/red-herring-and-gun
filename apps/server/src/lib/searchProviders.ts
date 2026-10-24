/**
 * 搜索结果在服务端其余部分眼里的样子：per-atom 检索入口、失败占位、给核查模型看的压缩形态。
 * 检索本身（多路 Provider、去重、排序）在 search/。
 */

import type { ExecutionBudget } from "./executionBudget.js";
import { searchAtom, type SearchProgressEvent } from "./search/searchAtom.js";
import { stringItems } from "./valueCoerce.js";

export type { SearchProgressEvent } from "./search/searchAtom.js";

export function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "Parallel Search";
  if (result?._source === "tool-error") return "Search Tool";
  return "Search";
}

export function buildSearchFailure(query: string, message: string) {
  return {
    answer: "",
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: [`搜索真实调用失败：${message}`],
    relatedQuestions: [],
    model: "search:error",
    traceText: `搜索真实调用失败：“${query}”未产生可引用证据。原因：${message}`,
    _source: "tool-error",
  };
}

/** 给核查模型看的来源：标题、URL、域名、片段。不带 S1/C1 这类检索序号。 */
function agentFacingSource(source: any) {
  const url = String(source?.url || source?.link || "").trim();
  const domain = String(source?.domain || source?.site || "").trim();
  const title = String(source?.title || source?.name || "").trim().slice(0, 120) || domain || url;
  if (!title && !url) return null;
  return {
    title,
    url,
    domain,
    snippet: String(source?.snippet || source?.summary || source?.content || ""),
    role: source?.evidenceRole || source?.role || "线索",
    credibility: source?.credibility || "",
  };
}

function agentFacingSources(list: unknown, limit: number) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map(agentFacingSource).filter(Boolean);
}

export function compactSearchResultForAgent(searchResult: any) {
  const sources = agentFacingSources(searchResult?.sources, 8).map((source) => ({
    ...source!,
    title: String(source!.title).slice(0, 120),
    snippet: String(source!.snippet).slice(0, 450),
  }));

  return {
    answer: typeof searchResult?.answer === "string" ? searchResult.answer.slice(0, 1800) : "",
    sources,
    supportingEvidence: stringItems(searchResult?.supportingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    contradictingEvidence: stringItems(searchResult?.contradictingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    relatedQuestions: stringItems(searchResult?.relatedQuestions).slice(0, 4),
    model: String(searchResult?.model || ""),
    traceText: String(searchResult?.traceText || "").slice(0, 700),
    _source: searchResult?._source || "search",
  };
}

/** Production per-atom search; a failed search comes back as a tool-error result, not a throw. */
export async function retrieveAtomSources(
  env: Record<string, string>,
  atom: string,
  onProgress?: (event: SearchProgressEvent) => void,
  execution: ExecutionBudget = {},
) {
  const outcome = await searchAtom(atom, { env, onProgress, ...execution });
  if (!outcome.ok) return buildSearchFailure(atom, outcome.reason);
  return {
    answer: outcome.answer,
    sources: outcome.sources,
    unresolvedEvidenceGaps: outcome.gaps,
    model: outcome.model,
    traceText: outcome.traceText,
    _source: "parallel-search",
  };
}
