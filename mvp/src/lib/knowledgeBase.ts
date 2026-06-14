import type {
  EvidenceLibraryEntry,
  EvidenceRole,
  KnowledgeBaseEntry,
  KnowledgeBaseStats,
  ScoreLevel,
  SearchStrategyMemory,
} from "./schemas";
import type { MemoryCandidate, MemoryCandidateKind, MemoryCandidateStatus } from "./agentRuntime/memoryCandidateTypes";

export interface KnowledgeBase {
  saveCase(entry: KnowledgeBaseEntry): Promise<void>;
  getCase(id: string): Promise<KnowledgeBaseEntry | null>;
  listCases(filter?: { rumorType?: string; tag?: string }): Promise<KnowledgeBaseEntry[]>;
  findSimilarCases(claim: string, limit?: number): Promise<KnowledgeBaseEntry[]>;
  addEvidence(evidence: EvidenceLibraryEntry): Promise<void>;
  findEvidence(query: string, options?: { role?: EvidenceRole; limit?: number }): Promise<EvidenceLibraryEntry[]>;
  getSearchStrategy(rumorType: string): Promise<SearchStrategyMemory | null>;
  updateSearchStrategy(rumorType: string, updates: Partial<SearchStrategyMemory>): Promise<void>;
  saveMemoryCandidate(candidate: MemoryCandidate): Promise<void>;
  listMemoryCandidates(filter?: { status?: MemoryCandidateStatus; kind?: MemoryCandidateKind }): Promise<MemoryCandidate[]>;
  getStats(): Promise<KnowledgeBaseStats>;
}

const CASES_KEY = "red-herring-knowledge-cases";
const EVIDENCE_KEY = "red-herring-evidence-library";
const STRATEGY_KEY = "red-herring-search-strategies";
const MEMORY_CANDIDATES_KEY = "red-herring-memory-candidates";
const MAX_CASES = 80;
const MAX_EVIDENCE = 240;
const MAX_MEMORY_CANDIDATES = 240;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList<T>(key: string): T[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, value: T[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, " ")
    .trim();
  const words = normalized.split(/\s+/).filter((word) => word.length >= 2);
  const chineseBigrams: string[] = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair)) chineseBigrams.push(pair);
  }

  return new Set([...words, ...chineseBigrams]);
}

export function calculateClaimSimilarity(claimA: string, claimB: string): number {
  const tokensA = tokenize(claimA);
  const tokensB = tokenize(claimB);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1;
  });

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const substringBonus =
    claimA.includes(claimB.slice(0, 8)) || claimB.includes(claimA.slice(0, 8)) ? 0.18 : 0;

  return Math.min(100, Math.round((jaccard * 0.82 + substringBonus) * 100));
}

function sortByTimestamp<T extends { timestamp: number }>(items: T[]) {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

function inferCredibilityFromScore(score?: number): ScoreLevel {
  if (typeof score !== "number") return "中";
  if (score >= 70) return "高";
  if (score >= 40) return "中";
  return "低";
}

export function createKnowledgeBase(): KnowledgeBase {
  return {
    async saveCase(entry) {
      const entries = readList<KnowledgeBaseEntry>(CASES_KEY);
      const nextEntry = {
        ...entry,
        tags: Array.from(new Set(entry.tags.filter(Boolean))),
      };
      const deduped = entries.filter((item) => item.id !== entry.id && item.claim !== entry.claim);
      writeList(CASES_KEY, [nextEntry, ...deduped].slice(0, MAX_CASES));

      const evidenceEntries = nextEntry.handoffSteps.flatMap((step) => {
        const rawSources = [
          ...(Array.isArray(step.output.sources) ? step.output.sources : []),
          ...(Array.isArray(step.output.verifiedSources) ? step.output.verifiedSources : []),
          ...(Array.isArray(step.output.questionableSources) ? step.output.questionableSources : []),
        ].filter((source): source is string => typeof source === "string" && source.trim().length > 0);

        return rawSources.map<EvidenceLibraryEntry>((source, index) => ({
          id: `${nextEntry.id}-evidence-${step.agent}-${index}`,
          title: source.slice(0, 80),
          source,
          sourceUrl: source.match(/https?:\/\/\S+/)?.[0],
          summary: `${step.agentName} 输出的来源线索`,
          role: step.agent === "source_validator" ? "线索" : "背景",
          relatedClaimIds: [nextEntry.id],
          credibility: inferCredibilityFromScore(nextEntry.credibilityScore),
          timestamp: nextEntry.timestamp,
        }));
      });

      if (evidenceEntries.length > 0) {
        const existingEvidence = readList<EvidenceLibraryEntry>(EVIDENCE_KEY);
        const evidenceKeys = new Set(evidenceEntries.map((item) => `${item.title}-${item.sourceUrl ?? item.source}`));
        const dedupedEvidence = existingEvidence.filter((item) => !evidenceKeys.has(`${item.title}-${item.sourceUrl ?? item.source}`));
        writeList(EVIDENCE_KEY, [...evidenceEntries, ...dedupedEvidence].slice(0, MAX_EVIDENCE));
      }
    },

    async getCase(id) {
      return readList<KnowledgeBaseEntry>(CASES_KEY).find((entry) => entry.id === id) ?? null;
    },

    async listCases(filter) {
      const entries = sortByTimestamp(readList<KnowledgeBaseEntry>(CASES_KEY));
      return entries.filter((entry) => {
        if (filter?.rumorType && entry.rumorType !== filter.rumorType) return false;
        if (filter?.tag && !entry.tags.includes(filter.tag)) return false;
        return true;
      });
    },

    async findSimilarCases(claim, limit = 5) {
      const entries = readList<KnowledgeBaseEntry>(CASES_KEY);
      return entries
        .map((entry) => ({ entry, score: calculateClaimSimilarity(claim, entry.claim) }))
        .filter((item) => item.score >= 10)
        .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
        .slice(0, limit)
        .map((item) => item.entry);
    },

    async addEvidence(evidence) {
      const entries = readList<EvidenceLibraryEntry>(EVIDENCE_KEY);
      const deduped = entries.filter((entry) => entry.id !== evidence.id && entry.sourceUrl !== evidence.sourceUrl);
      writeList(EVIDENCE_KEY, [evidence, ...deduped].slice(0, MAX_EVIDENCE));
    },

    async findEvidence(query, options) {
      const tokens = tokenize(query);
      const limit = options?.limit ?? 8;
      return readList<EvidenceLibraryEntry>(EVIDENCE_KEY)
        .filter((entry) => !options?.role || entry.role === options.role)
        .map((entry) => {
          const entryTokens = tokenize(`${entry.title} ${entry.summary} ${entry.source}`);
          let hits = 0;
          tokens.forEach((token) => {
            if (entryTokens.has(token)) hits += 1;
          });
          return { entry, hits };
        })
        .filter((item) => item.hits > 0)
        .sort((a, b) => b.hits - a.hits || b.entry.timestamp - a.entry.timestamp)
        .slice(0, limit)
        .map((item) => item.entry);
    },

    async getSearchStrategy(rumorType) {
      return readList<SearchStrategyMemory>(STRATEGY_KEY).find((entry) => entry.rumorType === rumorType) ?? null;
    },

    async updateSearchStrategy(rumorType, updates) {
      const entries = readList<SearchStrategyMemory>(STRATEGY_KEY);
      const existing = entries.find((entry) => entry.rumorType === rumorType);
      const nextEntry: SearchStrategyMemory = {
        id: existing?.id ?? `strategy-${rumorType}-${Date.now()}`,
        rumorType,
        effectiveQueries: updates.effectiveQueries ?? existing?.effectiveQueries ?? [],
        ineffectiveQueries: updates.ineffectiveQueries ?? existing?.ineffectiveQueries ?? [],
        sourceDomains: updates.sourceDomains ?? existing?.sourceDomains ?? [],
        timestamp: Date.now(),
        useCount: updates.useCount ?? (existing?.useCount ?? 0) + 1,
      };
      writeList(STRATEGY_KEY, [nextEntry, ...entries.filter((entry) => entry.rumorType !== rumorType)]);
    },

    async saveMemoryCandidate(candidate) {
      const entries = readList<MemoryCandidate>(MEMORY_CANDIDATES_KEY);
      const deduped = entries.filter((entry) => entry.id !== candidate.id);
      writeList(MEMORY_CANDIDATES_KEY, [candidate, ...deduped].slice(0, MAX_MEMORY_CANDIDATES));
    },

    async listMemoryCandidates(filter) {
      return readList<MemoryCandidate>(MEMORY_CANDIDATES_KEY)
        .filter((candidate) => !filter?.status || candidate.status === filter.status)
        .filter((candidate) => !filter?.kind || candidate.kind === filter.kind)
        .sort((a, b) => b.provenance.createdAt - a.provenance.createdAt);
    },

    async getStats() {
      const cases = readList<KnowledgeBaseEntry>(CASES_KEY);
      const evidence = readList<EvidenceLibraryEntry>(EVIDENCE_KEY);
      const typeDistribution = cases.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.rumorType] = (acc[entry.rumorType] ?? 0) + 1;
        return acc;
      }, {});

      return {
        totalCases: cases.length,
        totalEvidence: evidence.length,
        typeDistribution,
      };
    },
  };
}
