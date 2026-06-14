import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  async write(record: AgentMemoryCase): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const existing = await this.readAll();
    const deduped = existing.filter((item) => item.id !== record.id);
    const content = [...deduped, record].map((item) => JSON.stringify(item)).join("\n");
    await writeFile(this.filePath, content ? `${content}\n` : "", "utf8");
  }

  private async readAll(): Promise<AgentMemoryCase[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentMemoryCase);
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
