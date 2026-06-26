import { appendFile, mkdir, readFile } from "node:fs/promises";
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

  // 审查 P2-4 修复：原实现 readAll→merge→writeAll 是 read-modify-write 竞态。
  // 改为 append-only：新候选直接 appendFile，不做全文件重写。
  // 同 id 重复 propose 由 readAll 去重（按 id 取最新版本）。
  async propose(candidates: MemoryCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const block = candidates.map((c) => JSON.stringify(c)).join("\n") + "\n";
    await appendFile(this.filePath, block, "utf8");
  }

  async list(filter?: { status?: MemoryCandidateStatus; kind?: MemoryCandidateKind }): Promise<MemoryCandidate[]> {
    const records = await this.readAll();
    return records
      .filter((candidate) => !filter?.status || candidate.status === filter.status)
      .filter((candidate) => !filter?.kind || candidate.kind === filter.kind)
      .sort((a, b) => b.provenance.createdAt - a.provenance.createdAt);
  }

  // 审查 P2-4 修复：setStatus 也改 append-only。
  // 流程：readAll 找到原 candidate → 构造 updated 副本 → appendFile 一行。
  // 读用于构造新记录，append 是原子操作，无 read-modify-write 竞态。
  // id 不存在时返回 null（与原 API 一致）。
  async setStatus(id: string, status: MemoryCandidateStatus, reason?: string): Promise<MemoryCandidate | null> {
    const records = await this.readAll();
    const original = records.find((candidate) => candidate.id === id);
    if (!original) return null;
    const updated: MemoryCandidate = {
      ...original,
      status,
      statusReason: reason,
      statusUpdatedAt: Date.now(),
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(updated)}\n`, "utf8");
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
      // 审查 P2-6 修复：单行损坏不应导致整个 store 不可读，跳过损坏行并记录
      const allRecords: MemoryCandidate[] = [];
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          allRecords.push(JSON.parse(line) as MemoryCandidate);
        } catch {
          console.warn(`[memoryCandidateStore] 跳过损坏的 JSONL 行: ${line.slice(0, 80)}`);
        }
      }
      // 审查 P2-4 修复：append-only 模式下同一 id 可能有多条记录（propose 重复 / setStatus 更新），
      // 按 (id, statusUpdatedAt || provenance.createdAt) 取最新版本覆盖较早版本。
      const byId = new Map<string, MemoryCandidate>();
      for (const record of allRecords) {
        const existing = byId.get(record.id);
        const recordTs = record.statusUpdatedAt ?? record.provenance.createdAt;
        const existingTs = existing?.statusUpdatedAt ?? existing?.provenance.createdAt ?? 0;
        if (!existing || recordTs >= existingTs) {
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
