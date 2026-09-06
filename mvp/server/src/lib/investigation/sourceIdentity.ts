/**
 * InvestigationSource.id 的稳定派生与跨 Snapshot 门禁（Issue #76）。
 *
 * id 是规范化 URL 的纯函数，不依赖 phase、role、evidence 排序或注册顺序。
 * 同一 URL 在一次 investigation 的任意 Snapshot 中必须得到同一 id。
 * 同 URL 的 support / contradict 仍是两条 EvidenceLink，不在这里合成 stance。
 */
export type SnapshotSourceLike = {
  id: string;
  url: string;
};

export type SnapshotEvidenceLike = {
  sourceId: string;
  role: string;
};

export type SnapshotClaimLike = {
  id: string;
  evidence: readonly SnapshotEvidenceLike[];
};

export type SnapshotLike = {
  phase?: string;
  sources: readonly SnapshotSourceLike[];
  claims: readonly SnapshotClaimLike[];
};

export type SemanticRoleTransition = {
  claimId: string;
  sourceId: string;
  url: string;
  from: string;
  to: string;
  atPhase?: string;
};

export type SourceIdentityConflict =
  | { kind: "id-reuse"; sourceId: string; beforeUrl: string; afterUrl: string }
  | { kind: "url-reassigned"; url: string; beforeId: string; afterId: string };

const SETTLED_ROLES = new Set(["support", "contradict", "context-only"]);

export function normalizeInvestigationSourceUrl(url: string): string {
  return url.trim();
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** CSS-safe、跨 Snapshot 稳定：只由规范化 URL 决定。 */
export function investigationSourceId(url: string): string {
  return `src-${fnv1a64Hex(normalizeInvestigationSourceUrl(url))}`;
}

export function sourceUrlById(snapshot: SnapshotLike, sourceId: string): string {
  const found = snapshot.sources.find((source) => source.id === sourceId);
  return found ? normalizeInvestigationSourceUrl(found.url) : "";
}

export function sourceIdsStableBetween(
  before: SnapshotLike,
  after: SnapshotLike
): { stable: boolean; conflicts: SourceIdentityConflict[] } {
  return sourceIdsStableAcross([before, after]);
}

export function sourceIdsStableAcross(snapshots: readonly SnapshotLike[]): {
  stable: boolean;
  conflicts: SourceIdentityConflict[];
} {
  const idToUrl = new Map<string, string>();
  const urlToId = new Map<string, string>();
  const conflicts: SourceIdentityConflict[] = [];
  const seenConflict = new Set<string>();
  const add = (conflict: SourceIdentityConflict) => {
    const key =
      conflict.kind === "id-reuse"
        ? `id:${conflict.sourceId}:${conflict.beforeUrl}:${conflict.afterUrl}`
        : `url:${conflict.url}:${conflict.beforeId}:${conflict.afterId}`;
    if (seenConflict.has(key)) return;
    seenConflict.add(key);
    conflicts.push(conflict);
  };

  for (const snapshot of snapshots) {
    for (const source of snapshot.sources) {
      const url = normalizeInvestigationSourceUrl(source.url);
      if (!url || !source.id) continue;
      const prevUrl = idToUrl.get(source.id);
      if (prevUrl && prevUrl !== url) {
        add({ kind: "id-reuse", sourceId: source.id, beforeUrl: prevUrl, afterUrl: url });
      }
      const prevId = urlToId.get(url);
      if (prevId && prevId !== source.id) {
        add({ kind: "url-reassigned", url, beforeId: prevId, afterId: source.id });
      }
      idToUrl.set(source.id, url);
      urlToId.set(url, source.id);
    }
  }

  return { stable: conflicts.length === 0, conflicts };
}

/**
 * 真实 settling：同一 Claim + 同一规范化 URL + 同一 sourceId，
 * unassessed → support | contradict | context-only。
 * 同号 sourceId 指向不同 URL 时不得当成 transition。
 */
export function findSemanticRoleTransition(
  snapshots: readonly SnapshotLike[]
): SemanticRoleTransition | null {
  const prev = new Map<string, { sourceId: string; role: string }>();
  for (const snapshot of snapshots) {
    for (const claim of snapshot.claims) {
      for (const link of claim.evidence) {
        const url = sourceUrlById(snapshot, link.sourceId);
        if (!url) continue;
        const key = `${claim.id}\0${url}`;
        const prior = prev.get(key);
        if (
          prior &&
          prior.role === "unassessed" &&
          SETTLED_ROLES.has(link.role) &&
          prior.sourceId === link.sourceId
        ) {
          return {
            claimId: claim.id,
            sourceId: link.sourceId,
            url,
            from: prior.role,
            to: link.role,
            ...(snapshot.phase ? { atPhase: snapshot.phase } : {}),
          };
        }
        prev.set(key, { sourceId: link.sourceId, role: link.role });
      }
    }
  }
  return null;
}

export function evaluateSourceIdentityGate(input: {
  snapshots: readonly SnapshotLike[];
  sourceIdsStable?: boolean;
  requireTransition?: boolean;
}): {
  ok: boolean;
  errors: string[];
  transition: SemanticRoleTransition | null;
  sourceIdsStable: boolean;
} {
  const stability = sourceIdsStableAcross(input.snapshots);
  const transition = findSemanticRoleTransition(input.snapshots);
  const errors: string[] = [];

  if (!stability.stable) {
    for (const conflict of stability.conflicts) {
      if (conflict.kind === "id-reuse") {
        errors.push(
          `sourceId ${conflict.sourceId} mapped to ${conflict.beforeUrl} then ${conflict.afterUrl}`
        );
      } else {
        errors.push(
          `url ${conflict.url} changed sourceId ${conflict.beforeId} → ${conflict.afterId}`
        );
      }
    }
  }
  if (input.sourceIdsStable === false) {
    errors.push("sourceIdsStable=false");
  }
  if (input.requireTransition && !transition) {
    errors.push("no observable unassessed→role transition for the same URL and sourceId");
  }

  return {
    ok: errors.length === 0,
    errors,
    transition,
    sourceIdsStable: stability.stable,
  };
}
