/**
 * 本地记忆召回（纯数据，无 UI）：查过的相似案件与本地证据作为检索线索喂给后端。
 * 从 MissionControlView 抽出，供 legacy 执行壳与生产 Golden Path 共用；
 * 只作为复用检索路径与信源经验，不直接替代本案证据。
 */
import { calculateClaimSimilarity, type KnowledgeBase } from "./knowledgeBase";
import type { KnowledgeBaseEntry } from "./schemas";

export interface LocalMemoryRecall extends Record<string, unknown> {
  hitCount: number;
  evidenceCount: number;
  hits: Array<{
    id: string;
    claim: string;
    score: number;
    verdict?: string;
    tags: string[];
    sourceUrls: string[];
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
  const [cases, evidenceEntries] = await Promise.all([
    knowledgeBase.findSimilarCases(claim, 4),
    knowledgeBase.findEvidence(claim, { limit: 5 }),
  ]);

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
    verdict: finalReportText(entry.finalReport, "verdictType"),
    tags: entry.tags.slice(0, 5),
    sourceUrls: extractSourceUrlsFromCase(entry).slice(0, 5),
  }));

  const relatedQuestions = [
    ...hits.slice(0, 2).map((hit) => `复核历史案件「${hit.claim.slice(0, 24)}」是否仍适用于本案`),
    ...evidenceEntries.slice(0, 2).map((entry) => `追查证据「${entry.title.slice(0, 24)}」的原始来源`),
  ];

  return {
    hitCount: hits.length,
    evidenceCount: evidenceEntries.length,
    hits,
    sources: [...evidenceSources, ...caseSources].slice(0, 8),
    relatedQuestions,
    traceText: `读取本地案件库 ${hits.length} 条、证据库 ${evidenceEntries.length} 条；这些内容只用于复用检索路径和信源经验，不直接替代本案证据。`,
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

function safeDomainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
