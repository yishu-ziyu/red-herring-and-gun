/**
 * 本机知识库（localStorage）：查过的案件，以及旧版本留下的证据库。
 * 下面的类型就是存进去的数据形状；旧记录照原样读，字段不能改名。
 */
import { semanticClaimSimilarity } from "../../shared/semanticRecall";

type ScoreLevel = "高" | "中" | "低";

type EvidenceRole = "支持" | "反驳" | "限定" | "背景" | "线索" | "不可用";

type RumorType = "健康" | "社会" | "科技" | "财经" | "政治" | "娱乐";

interface ClaimDiagnosis {
  mixedJudgments: string[];
  ambiguousTerms: string[];
  risk: string;
  whyNotDirectFactCheck: string;
  rumorIndicators?: string[];
}

interface AgentEvidenceBundle {
  agentId: string;
  claimIds: string[];
  supportEvidenceIds: string[];
  contradictEvidenceIds: string[];
  confidenceDelta: number;
  unresolvedQuestions: string[];
  sourceQualityScore?: number;
  logicRiskCount?: number;
}

/** 旧版多 Agent 管线每一步的记录。新记录写空数组，旧记录里还有。 */
interface HandoffStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "pending" | "running" | "completed" | "failed";
  evidenceBundle?: AgentEvidenceBundle;
  error?: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  claim: string;
  claimEmbedding?: number[];
  rumorType: RumorType | string;
  diagnosis: ClaimDiagnosis;
  finalReport: Record<string, unknown>;
  handoffSteps: HandoffStep[];
  verificationResult?: "true" | "false" | "partial" | "unknown";
  timestamp: number;
  tags: string[];
}

/** 旧版本写入的证据库条目。现在只读，作为检索线索发给服务端。 */
interface EvidenceLibraryEntry {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  summary: string;
  role: EvidenceRole;
  relatedClaimIds: string[];
  credibility: ScoreLevel;
  timestamp: number;
}

export interface KnowledgeBase {
  saveCase(entry: KnowledgeBaseEntry): Promise<void>;
  getCase(id: string): Promise<KnowledgeBaseEntry | null>;
  listCases(): Promise<KnowledgeBaseEntry[]>;
  findSimilarCases(claim: string, limit?: number): Promise<KnowledgeBaseEntry[]>;
  findEvidence(query: string, options?: { limit?: number }): Promise<EvidenceLibraryEntry[]>;
}

const MAX_CASES = 80;
const CASES_KEY = "red-herring-knowledge-cases:v2:anonymous";
const EVIDENCE_KEY = "red-herring-evidence-library:v2:anonymous";

function canUseStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
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
  if (!canUseStorage()) throw new Error("本地存储不可用");
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // localStorage 写满时不静默停写——列表是新→旧排序，
    // 从尾部（最旧）折半裁剪重试，并留下可观测的 console.error
    console.error(`[knowledgeBase] ${key} 写入失败，尝试裁剪重试`, error);
    let list = value;
    while (list.length > 1) {
      list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
      try {
        window.localStorage.setItem(key, JSON.stringify(list));
        return;
      } catch {
        // 继续折半
      }
    }
    console.error(`[knowledgeBase] ${key} 裁剪后仍无法写入，本地知识库降级为只读`);
    throw error;
  }
}

export function normalizeHistoryClaim(claim: string): string {
  return claim.trim().replace(/\s+/g, " ");
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

function sortByTimestamp<T extends { timestamp: number }>(items: T[]) {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
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
    },

    async getCase(id) {
      return readList<KnowledgeBaseEntry>(CASES_KEY).find((entry) => entry.id === id) ?? null;
    },

    async listCases() {
      return sortByTimestamp(readList<KnowledgeBaseEntry>(CASES_KEY));
    },

    async findSimilarCases(claim, limit = 5) {
      const entries = readList<KnowledgeBaseEntry>(CASES_KEY);
      return entries
        .map((entry) => ({ entry, score: semanticClaimSimilarity(claim, entry.claim) }))
        .filter((item) => item.score >= 10)
        .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
        .slice(0, limit)
        .map((item) => item.entry);
    },

    async findEvidence(query, options) {
      const tokens = tokenize(query);
      const limit = options?.limit ?? 8;
      return readList<EvidenceLibraryEntry>(EVIDENCE_KEY)
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
  };
}
