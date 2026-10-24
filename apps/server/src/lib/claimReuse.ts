/**
 * 同一句话有人查完过：直接给出那次的最终结果，不再跑管线。
 *
 * 只认规范化后完全相同的文字，且双方都只有文字：有图片、链接的请求和追问一律现查，
 * 所以不会把别人的图片、链接、追问带给这位访客。复用的快照只记原结果的核查时间，
 * 不带原调查编号或原访客的任何信息；引用的材料复制进新调查，证据照常能核对。
 */
import type { InvestigationSnapshotV1 } from "../../../shared/investigation/index.js";
import { createInvestigationEmitter } from "./investigationEmitter.js";
import { createRunRecorder } from "./runRecorder.js";
import type { RunService } from "./runService.js";
import type { PublishedRunResult } from "./runStore.js";
import type { CaseIntakePayload } from "./visionIntake.js";

const REUSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** 去空白、去标点、全角转半角、英文小写。只用于判断两句话是否相同。 */
export function normalizeClaimForReuse(text: string): string {
  return text
    .trim()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .toLowerCase()
    .replace(/[\s\p{P}~`^|]/gu, "");
}

export function isTextOnlyIntake(intake: CaseIntakePayload | null): boolean {
  return !intake || (intake.images.length === 0 && intake.links.length === 0);
}

/** 最近 30 天内同一句话最新的、可复用的最终结果；没有就是 null。 */
export function findReusableResult(runs: RunService, claim: string, now = Date.now()): PublishedRunResult | null {
  const key = normalizeClaimForReuse(claim);
  if (!key) return null;
  const since = now - REUSE_WINDOW_MS;
  for (const candidate of runs.listReuseCandidates(since)) {
    if (normalizeClaimForReuse(candidate.claim) !== key) continue;
    const result = runs.getResult(candidate.runId);
    const snapshot = result?.snapshot;
    if (!result || result.kind !== "final" || result.createdAt < since) continue;
    if (!snapshot || snapshot.phase !== "complete" || !snapshot.conclusion || snapshot.reusedFrom) continue;
    try {
      createRunRecorder(candidate.runId).validateSnapshot(snapshot, { requireEvidenceMaterials: true });
    } catch {
      continue;
    }
    return result;
  }
  return null;
}

/** 去掉用户自己提交的链接材料，以及所有对它的引用。 */
function withoutIntakeMaterials(snapshot: InvestigationSnapshotV1): InvestigationSnapshotV1 {
  const removed = new Set(snapshot.sources.filter((source) => source.material === "user-intake").map((source) => source.id));
  if (!removed.size) return snapshot;
  const keep = (id: string) => !removed.has(id);
  return {
    ...snapshot,
    sources: snapshot.sources.filter((source) => keep(source.id)),
    claims: snapshot.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.filter((link) => keep(link.sourceId)),
      gaps: claim.gaps.map((gap) => (gap.resolvedBySourceIds ? { ...gap, resolvedBySourceIds: gap.resolvedBySourceIds.filter(keep) } : gap)),
    })),
    conflicts: snapshot.conflicts.map((conflict) => ({
      ...conflict,
      sides: conflict.sides.map((side) => ({ ...side, sourceIds: side.sourceIds.filter(keep) })),
    })),
    ...(snapshot.conclusion ? { conclusion: { ...snapshot.conclusion, sourceIds: snapshot.conclusion.sourceIds.filter(keep) } } : {}),
  };
}

/** 原话只是标点、空白、大小写不同：按这次的原话重新定位每一点；找不到就不标位置。 */
function relocateSpans(snapshot: InvestigationSnapshotV1, claim: string): InvestigationSnapshotV1 {
  if (snapshot.originalClaim === claim) return snapshot;
  const previous = snapshot.originalClaim;
  return {
    ...snapshot,
    originalClaim: claim,
    claims: snapshot.claims.map((item) => {
      if (!item.originalSpan) return item;
      const { originalSpan, ...rest } = item;
      const piece = previous.slice(originalSpan.start, originalSpan.end);
      const start = piece ? claim.indexOf(piece) : -1;
      return start >= 0 ? { ...rest, originalSpan: { start, end: start + piece.length } } : rest;
    }),
  };
}

/**
 * 为刚建好的 run 提交一份复用结果：事件序列与正常完成一致
 * （完成态快照与活动 → complete 带 finalReport → run_state completed），结果以 final 发布。
 */
export function commitReusedResult(runs: RunService, run: { runId: string; claim: string }, source: PublishedRunResult): void {
  const { runId, claim } = run;
  const recorder = createRunRecorder(runId);
  recorder.recordMaterial({ kind: "original-input", content: JSON.stringify(runs.getInput(runId) ?? { claim }) });
  const sourceRecorder = createRunRecorder(source.runId);
  const copied = new Map<string, string>();
  const copy = (materialId: string | undefined): string | undefined => {
    if (!materialId) return undefined;
    const existing = copied.get(materialId);
    if (existing) return existing;
    const material = sourceRecorder.getMaterial(materialId);
    if (!material) throw new Error("Reused result references a missing material");
    const next = recorder.recordMaterial({
      ...(material.url ? { url: material.url } : {}),
      kind: material.kind,
      content: material.content,
      metadata: material.metadata,
    });
    copied.set(materialId, next);
    return next;
  };
  const base = relocateSpans(withoutIntakeMaterials(structuredClone(source.snapshot)), claim);
  const checkedAt = base.checkedAt ?? new Date(source.createdAt).toISOString();
  const snapshot: InvestigationSnapshotV1 = {
    ...base,
    sources: base.sources.map((item) => (item.materialId ? { ...item, materialId: copy(item.materialId)! } : item)),
    claims: base.claims.map((item) => ({
      ...item,
      evidence: item.evidence.map((link) => (link.materialId ? { ...link, materialId: copy(link.materialId)! } : link)),
    })),
    reusedFrom: { checkedAt },
  };
  recorder.validateSnapshot(snapshot, { requireEvidenceMaterials: true });
  recorder.assertHealthy();

  let terminalEvents: Record<string, unknown>[] = [];
  createInvestigationEmitter({
    runId,
    send: (event) => runs.publish(runId, event),
    commitSnapshot: (_snapshot, events) => { terminalEvents = events; },
  }).emitSnapshot(snapshot);
  const report: Record<string, unknown> = { ...structuredClone(source.report ?? {}), investigation: snapshot };
  runs.commit(runId, {
    status: "completed",
    snapshot,
    publication: "final",
    report,
    events: [
      ...terminalEvents,
      { type: "complete", claim, steps: [], finalReport: report },
      { type: "run_state", status: "completed", terminal: true },
    ],
  });
}
