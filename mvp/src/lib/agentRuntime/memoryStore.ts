import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AgentMemoryCase {
  id: string;
  claim: string;
  normalizedClaim: string;
  createdAt: number;
  finalReport?: unknown;
  steps: Array<{
    agent: string;
    model?: string;
    output?: unknown;
    evidenceBundle?: unknown;
  }>;
  searchModel?: string;
  sourceUrls: string[];
  unresolvedQuestions: string[];
}

export interface AgentMemoryHit {
  case: AgentMemoryCase;
  score: number;
  matchedTerms: string[];
}

export interface AgentMemoryStore {
  search(claim: string, limit?: number): Promise<AgentMemoryHit[]>;
  write(record: AgentMemoryCase): Promise<void>;
}

export class JsonlAgentMemoryStore implements AgentMemoryStore {
  constructor(private readonly filePath = join(process.cwd(), ".agent-memory", "cases.jsonl")) {}

  async search(claim: string, limit = 5): Promise<AgentMemoryHit[]> {
    const records = await this.readAll();
    const queryTerms = tokenizeClaim(claim);
    if (queryTerms.length === 0) return [];

    return records
      .map((record) => {
        const recordTerms = tokenizeClaim(`${record.claim} ${record.normalizedClaim}`);
        const matchedTerms = queryTerms.filter((term) => recordTerms.includes(term));
        const score = matchedTerms.length / Math.max(queryTerms.length, 1);
        return { case: record, score, matchedTerms: Array.from(new Set(matchedTerms)) };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.case.createdAt - a.case.createdAt)
      .slice(0, limit);
  }

  // 审查 P2-5 修复：原实现 readAll→filter→writeAll 是 read-modify-write 竞态。
  // 改为 append-only：每次只追加一行 JSON，不做全文件重写。
  // 多次写同一 id 不会丢数据，readAll 会按 id 取最新（见下方）。
  // 文件会随时间增长，需要外部 compact() 维护；当前 demo 量级不阻塞。
  async write(record: AgentMemoryCase): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    await appendFile(this.filePath, line, "utf8");
  }

  private async readAll(): Promise<AgentMemoryCase[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      // 审查 P2-6 修复：单行损坏不应导致整个 store 不可读，跳过损坏行并记录
      const allRecords: AgentMemoryCase[] = [];
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          allRecords.push(JSON.parse(line) as AgentMemoryCase);
        } catch {
          console.warn(`[memoryStore] 跳过损坏的 JSONL 行: ${line.slice(0, 80)}`);
        }
      }
      // 审查 P2-5 修复：append-only 模式下同一 id 可能有多条记录，
      // 按 (id, createdAt) 取最新版本覆盖较早版本，避免读到旧数据。
      const byId = new Map<string, AgentMemoryCase>();
      for (const record of allRecords) {
        const existing = byId.get(record.id);
        if (!existing || record.createdAt >= existing.createdAt) {
          byId.set(record.id, record);
        }
      }
      return Array.from(byId.values());
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export function buildMemoryCase({
  id,
  claim,
  steps,
  finalReport,
  searchResult,
}: {
  id: string;
  claim: string;
  steps: Array<Record<string, any>>;
  finalReport?: unknown;
  searchResult?: any;
}): AgentMemoryCase {
  const sourceUrls = new Set<string>();
  for (const source of searchResult?.sources ?? []) {
    if (typeof source?.url === "string" && source.url) sourceUrls.add(source.url);
  }

  const unresolvedQuestions = new Set<string>();
  for (const item of searchResult?.unresolvedEvidenceGaps ?? []) {
    if (typeof item === "string" && item) unresolvedQuestions.add(item);
  }
  for (const step of steps) {
    for (const item of step?.evidenceBundle?.unresolvedQuestions ?? []) {
      if (typeof item === "string" && item) unresolvedQuestions.add(item);
    }
  }

  return {
    id,
    claim,
    normalizedClaim: normalizeClaim(claim),
    createdAt: Date.now(),
    finalReport,
    steps: steps.map((step) => ({
      agent: String(step.agent || ""),
      model: typeof step.model === "string" ? step.model : undefined,
      output: step.output,
      evidenceBundle: step.evidenceBundle,
    })),
    searchModel: typeof searchResult?.model === "string" ? searchResult.model : undefined,
    sourceUrls: Array.from(sourceUrls).slice(0, 20),
    unresolvedQuestions: Array.from(unresolvedQuestions).slice(0, 20),
  };
}

function normalizeClaim(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?;；:"“”'‘’()[\]【】]/g, "");
}

function tokenizeClaim(value: string) {
  const normalized = normalizeClaim(value);
  const latinTerms = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const chineseTerms = Array.from(new Set(normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []));
  const bigrams: string[] = [];
  for (const segment of chineseTerms) {
    for (let i = 0; i < segment.length - 1; i += 1) {
      bigrams.push(segment.slice(i, i + 2));
    }
  }
  return Array.from(new Set([...latinTerms, ...bigrams])).slice(0, 80);
}
