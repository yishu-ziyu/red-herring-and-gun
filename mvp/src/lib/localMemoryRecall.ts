/**
 * 本地记忆召回（纯数据，无 UI）：查过的案件与已确认记忆作为检索线索喂给后端。
 * 从 MissionControlView 抽出，供 legacy 执行壳与生产 Golden Path 共用；
 * 只作为复用检索路径与信源经验，不直接替代本案证据。
 */
import { calculateClaimSimilarity, type KnowledgeBase } from "./knowledgeBase";
import { semanticClaimSimilarity } from "./semanticRecall";
import type { KnowledgeBaseEntry } from "./schemas";

export interface LocalMemoryRecall extends Record<string, unknown> {
  hitCount: number;
  acceptedCandidateCount: number;
  evidenceCount: number;
  hits: Array<{
    id: string;
    claim: string;
    score: number;
    verdict?: string;
    tags: string[];
    sourceUrls: string[];
  }>;
  acceptedCandidates: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    confidence: number;
    matchedTerms: string[];
  }>;
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    domain?: string;
    snippet: string;
    sourceType: string;
    evidenceRole: string;
  }>;
  relatedQuestions: string[];
  traceText: string;
}

export async function buildLocalMemoryRecall(
  knowledgeBase: KnowledgeBase,
  claim: string
): Promise<LocalMemoryRecall> {
  const [cases, evidenceEntries, acceptedCandidates] = await Promise.all([
    knowledgeBase.findSimilarCases(claim, 4),
    knowledgeBase.findEvidence(claim, { limit: 5 }),
    knowledgeBase.listMemoryCandidates({ status: "accepted" }),
  ]);
  const scoredCandidates = acceptedCandidates
    .map((candidate) => {
      const candidateText = `${candidate.title} ${candidate.summary} ${candidate.tags.join(" ")} ${candidate.provenance.claim}`;
      const matchedTerms = matchedLocalMemoryTerms(claim, candidateText);
      // G2 语义召回：词面命中数为主，语义相似度兜底（同义说法零词面交集时仍可召回）
      const semanticScore = semanticClaimSimilarity(claim, candidate.provenance.claim);
      const score = Math.max(matchedTerms.length, semanticScore / 25);
      return { candidate, matchedTerms, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.confidence - a.candidate.confidence)
    .slice(0, 4);

  const caseSources = cases.flatMap((entry) =>
    extractSourceUrlsFromCase(entry).slice(0, 2).map((url, index) => ({
      id: `${entry.id}-memory-source-${index}`,
      title: `历史案件来源：${entry.claim.slice(0, 36)}${entry.claim.length > 36 ? "..." : ""}`,
      url,
      domain: safeDomainFromUrl(url),
      snippet: `来自相似案件，原信息相似度 ${calculateClaimSimilarity(claim, entry.claim)}/100。旧案只作为检索线索，不直接进入本案结论。`,
      sourceType: "历史案件",
      evidenceRole: "线索",
    }))
  );

  const evidenceSources = evidenceEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.sourceUrl,
    domain: safeDomainFromUrl(entry.sourceUrl ?? entry.source),
    snippet: entry.summary || entry.source,
    sourceType: `本地证据库/${entry.credibility}`,
    evidenceRole: entry.role,
  }));

  const hits = cases.map((entry) => ({
    id: entry.id,
    claim: entry.claim,
    score: calculateClaimSimilarity(claim, entry.claim),
    verdict: finalReportText(entry.finalReport, "credibilityLabel") || finalReportText(entry.finalReport, "verdictType"),
    tags: entry.tags.slice(0, 5),
    sourceUrls: extractSourceUrlsFromCase(entry).slice(0, 5),
  }));

  const relatedQuestions = [
    ...hits.slice(0, 2).map((hit) => `复核历史案件「${hit.claim.slice(0, 24)}」是否仍适用于本案`),
    ...evidenceEntries.slice(0, 2).map((entry) => `追查证据「${entry.title.slice(0, 24)}」的原始来源`),
  ];

  return {
    hitCount: hits.length,
    acceptedCandidateCount: scoredCandidates.length,
    evidenceCount: evidenceEntries.length,
    hits,
    acceptedCandidates: scoredCandidates.map(({ candidate, matchedTerms }) => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      confidence: candidate.confidence,
      matchedTerms,
    })),
    sources: [...evidenceSources, ...caseSources].slice(0, 8),
    relatedQuestions,
    traceText: `读取本地案件库 ${hits.length} 条、证据库 ${evidenceEntries.length} 条、已确认记忆 ${scoredCandidates.length} 条；这些内容只用于复用检索路径和信源经验，不直接替代本案证据。`,
  };
}

function finalReportText(report: unknown, key: string) {
  if (!report || typeof report !== "object") return "";
  const value = (report as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function extractSourceUrlsFromCase(entry: KnowledgeBaseEntry) {
  const urls = new Set<string>();
  entry.handoffSteps.forEach((step) => {
    collectUrls(step.output).forEach((url) => urls.add(url));
    collectUrls(step.evidenceBundle).forEach((url) => urls.add(url));
  });
  collectUrls(entry.finalReport).forEach((url) => urls.add(url));
  return Array.from(urls);
}

function collectUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.match(/https?:\/\/[^\s)\]}>，。；;]+/g) ?? [];
  if (Array.isArray(value)) return value.flatMap((item) => collectUrls(item));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => collectUrls(item));
  return [];
}

function matchedLocalMemoryTerms(query: string, target: string) {
  const queryTerms = tokenizeLocalMemoryText(query);
  const targetTerms = new Set(tokenizeLocalMemoryText(target));
  return queryTerms.filter((term) => targetTerms.has(term)).slice(0, 12);
}

function tokenizeLocalMemoryText(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, "")
    .trim();
  const terms = new Set<string>(normalized.match(/[a-z0-9]{2,}/g) ?? []);
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair)) terms.add(pair);
  }
  return Array.from(terms);
}

function safeDomainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
