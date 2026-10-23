import { createHash, randomUUID } from "node:crypto";
import type { InvestigationSnapshot } from "../../../shared/investigation/schema.js";
import { normalizeInvestigationSourceUrl } from "../../../shared/investigation/sourceIdentity.js";
import { openDatabase } from "./sqliteStore.js";

type Metadata = Record<string, unknown>;
export type RecordedMaterial = { materialId: string; runId: string; url: string | null; kind: string; content: string; contentHash: string; metadata: Metadata; createdAt: number };
type AttemptStatus = "succeeded" | "failed" | "cancelled";
export class RunRecordingError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("调查记录未能持久保存，不能发布本轮结果");
    this.name = "RunRecordingError";
    this.cause = cause;
  }
}

// Only application inputs belong here. Never pass environment, request or provider transport objects.
function safeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/token|api[-_]?key|secret|password|credential|signature/i.test(key)) url.searchParams.set(key, "[redacted]");
  }
  return url.href;
}

function serializable(value: unknown): string {
  return JSON.stringify(value ?? null, (key, item) =>
    /^(headers?|cookies?|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credentials?|env)$/i.test(key)
      ? undefined : item);
}
export interface RunRecorder {
  recordMaterial(input: { url?: string; kind: string; content: string; metadata?: Metadata }): string;
  startAttempt(input: { stage: string; input: unknown; provider?: string; model?: string; metadata?: Metadata }): string;
  finishAttempt(id: string, input: { status: AttemptStatus; output?: unknown; error?: string; provider?: string; model?: string; metadata?: Metadata }): void;
  listMaterials(): RecordedMaterial[];
  getMaterial(materialId: string): RecordedMaterial | null;
  validateSnapshot(snapshot: InvestigationSnapshot, options?: { requireEvidenceMaterials?: boolean }): void;
  assertHealthy(): void;
}

export function createRunRecorder(runId: string): RunRecorder {
  let failure: RunRecordingError | undefined;
  const guard = <T>(operation: () => T): T => {
    if (failure) throw failure;
    try { return operation(); } catch (error) { failure = new RunRecordingError(error); throw failure; }
  };
  const db = guard(() => {
    const database = openDatabase();
    if (!database) throw new Error("Persistent database unavailable");
    return database;
  });
  const getMaterial = (materialId: string): RecordedMaterial | null => guard(() => {
    const row = db.prepare("SELECT * FROM run_materials WHERE runId=? AND materialId=?").get(runId, materialId) as unknown as (Omit<RecordedMaterial, "metadata"> & { metadata: string }) | undefined;
    return row ? { ...row, metadata: JSON.parse(row.metadata) as Metadata } : null;
  });
  return {
    getMaterial,
    validateSnapshot(snapshot, options = {}) {
      guard(() => {
        const required = (id: string) => {
          const material = getMaterial(id);
          if (!material) throw new Error("Referenced material is not part of this run");
          if (createHash("sha256").update(material.content).digest("hex") !== material.contentHash) throw new Error("Material content hash mismatch");
          return material;
        };
        const sameUrl = (material: RecordedMaterial, url: string) => {
          if (!material.url || normalizeInvestigationSourceUrl(safeUrl(material.url)) !== normalizeInvestigationSourceUrl(safeUrl(url))) {
            throw new Error("Referenced material URL differs from source URL");
          }
        };
        const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
        for (const source of snapshot.sources) {
          if (!source.materialId) continue;
          const material = required(source.materialId);
          sameUrl(material, source.url);
          if (source.excerptKind && source.excerptKind !== material.kind) throw new Error("Source kind differs from material kind");
        }
        for (const claim of snapshot.claims) {
          for (const evidence of claim.evidence) {
            if (!evidence.materialId) {
              if (options.requireEvidenceMaterials && (evidence.role === "support" || evidence.role === "contradict")) throw new Error("Directional evidence has no saved material reference");
              if (evidence.quoteRange) throw new Error("Quote range has no material reference");
              continue;
            }
            const material = required(evidence.materialId);
            const source = sources.get(evidence.sourceId);
            if (!source) throw new Error("Evidence references a missing source");
            sameUrl(material, source.url);
            if (evidence.excerptKind && evidence.excerptKind !== material.kind) throw new Error("Evidence kind differs from material kind");
            if (evidence.quote) {
              const range = evidence.quoteRange;
              if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > material.content.length || material.content.slice(range.start, range.end) !== evidence.quote) {
                throw new Error("Evidence quote does not match its material range");
              }
            } else if (evidence.quoteRange) throw new Error("Quote range has no quote");
          }
        }
      });
    },
    assertHealthy() { if (failure) throw failure; },
    recordMaterial(input) {
      return guard(() => {
        const materialId = randomUUID();
        // Each observation has its own identity, even when URL and content match.
        db.prepare("INSERT INTO run_materials (materialId,runId,url,kind,content,contentHash,metadata,createdAt) VALUES (?,?,?,?,?,?,?,?)")
          .run(materialId, runId, input.url ? safeUrl(input.url) : null, input.kind, input.content,
            createHash("sha256").update(input.content).digest("hex"), serializable(input.metadata ?? {}), Date.now());
        return materialId;
      });
    },
    startAttempt(input) {
      return guard(() => {
        const attemptId = randomUUID();
        db.prepare("INSERT INTO run_attempts (attemptId,runId,stage,provider,model,status,input,startedAt,metadata) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(attemptId, runId, input.stage, input.provider ?? null, input.model ?? null, "running", serializable(input.input), Date.now(), serializable(input.metadata ?? {}));
        return attemptId;
      });
    },
    finishAttempt(attemptId, input) {
      guard(() => {
        const row = db.prepare("SELECT metadata FROM run_attempts WHERE attemptId=? AND runId=? AND status='running'").get(attemptId, runId) as { metadata: string } | undefined;
        if (!row) throw new Error("Missing or already finished attempt");
        db.prepare("UPDATE run_attempts SET status=?,output=?,error=?,provider=COALESCE(?,provider),model=COALESCE(?,model),finishedAt=?,metadata=? WHERE attemptId=? AND runId=?")
          .run(input.status, input.output === undefined ? null : serializable(input.output), input.error ?? null,
            input.provider ?? null, input.model ?? null, Date.now(), serializable({ ...JSON.parse(row.metadata), ...input.metadata }), attemptId, runId);
      });
    },
    listMaterials() {
      return guard(() => (db.prepare("SELECT * FROM run_materials WHERE runId=? ORDER BY createdAt, rowid").all(runId) as unknown as Array<{ materialId: string; runId: string; url: string | null; kind: string; content: string; contentHash: string; metadata: string; createdAt: number }>)
        .map((row) => ({ ...row, metadata: JSON.parse(row.metadata) as Metadata })));
    },
  };
}
