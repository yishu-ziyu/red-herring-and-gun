import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryCandidate, MemoryCandidateHit, MemoryCandidateKind, MemoryCandidateStatus } from "./memoryCandidateTypes";

export interface MemoryCandidateStore {
  propose(candidates: MemoryCandidate[]): Promise<void>;
  list(filter?: { status?: MemoryCandidateStatus; kind?: MemoryCandidateKind }): Promise<MemoryCandidate[]>;
  setStatus(id: string, status: MemoryCandidateStatus, reason?: string): Promise<MemoryCandidate | null>;
  searchAccepted(claim: string, limit?: number): Promise<MemoryCandidateHit[]>;
}

export class JsonlMemoryCandidateStore implements MemoryCandidateStore {
  constructor(private readonly filePath = join(process.cwd(), ".agent-memory", "candidates.jsonl")) {}

  async propose(candidates: MemoryCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    const existing = await this.readAll();
    const incomingIds = new Set(candidates.map((candidate) => candidate.id));
    const merged = [
      ...candidates,
      ...existing.filter((candidate) => !incomingIds.has(candidate.id)),
    ];
    await this.writeAll(merged);
  }

  async list(filter?: { status?: MemoryCandidateStatus; kind?: MemoryCandidateKind }): Promise<MemoryCandidate[]> {
    const records = await this.readAll();
    return records
      .filter((candidate) => !filter?.status || candidate.status === filter.status)
      .filter((candidate) => !filter?.kind || candidate.kind === filter.kind)
      .sort((a, b) => b.provenance.createdAt - a.provenance.createdAt);
  }

  async setStatus(id: string, status: MemoryCandidateStatus, reason?: string): Promise<MemoryCandidate | null> {
    const records = await this.readAll();
    let updated: MemoryCandidate | null = null;
    const next = records.map((candidate) => {
      if (candidate.id !== id) return candidate;
      updated = {
        ...candidate,
        status,
        statusReason: reason,
        statusUpdatedAt: Date.now(),
      };
      return updated;
    });
    if (!updated) return null;
    await this.writeAll(next);
    return updated;
  }

  async searchAccepted(claim: string, limit = 5): Promise<MemoryCandidateHit[]> {
    const records = await this.list({ status: "accepted" });
    const queryTerms = tokenizeClaim(claim);
    if (queryTerms.length === 0) return [];

    return records
      .map((candidate) => {
        const payloadText = safeStringify(candidate.payload);
        const candidateTerms = tokenizeClaim([
          candidate.title,
          candidate.summary,
          candidate.provenance.claim,
          candidate.tags.join(" "),
          payloadText,
        ].join(" "));
        const matchedTerms = queryTerms.filter((term) => candidateTerms.includes(term));
        const score = matchedTerms.length / Math.max(queryTerms.length, 1);
        return { candidate, score, matchedTerms: Array.from(new Set(matchedTerms)) };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.candidate.provenance.createdAt - a.candidate.provenance.createdAt)
      .slice(0, limit);
  }

  private async readAll(): Promise<MemoryCandidate[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemoryCandidate);
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(records: MemoryCandidate[]) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const content = records.map((candidate) => JSON.stringify(candidate)).join("\n");
    await writeFile(this.filePath, content ? `${content}\n` : "", "utf8");
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
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
  return Array.from(new Set([...latinTerms, ...bigrams])).slice(0, 100);
}
