/**
 * Claim Trace：只从 originalClaim + claims[].originalSpan 生成可渲染片段。
 * 不猜测、不模糊匹配、不改写原句。
 */

export type ClaimTraceInput = {
  id: string;
  text: string;
  originalSpan?: { start: number; end: number } | null;
};

export type ClaimTraceSegment = {
  text: string;
  claimId: string | null;
  traceable: boolean;
};

type ValidSpan = { start: number; end: number; claimId: string };

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function spansOverlap(a: ValidSpan, b: ValidSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 合法 span 才可回指。下列情况全部降级为不高亮：
 * 缺失、越界、start>=end、空切片、切片与 claim.text 不一致、无法确定性解释的重叠。
 */
export function buildClaimTraceSegments(
  originalClaim: string,
  claims: ReadonlyArray<ClaimTraceInput>,
): ClaimTraceSegment[] {
  if (typeof originalClaim !== "string" || originalClaim.length === 0) {
    return [];
  }

  const candidates: ValidSpan[] = [];
  for (const claim of claims) {
    if (!claim || typeof claim.id !== "string" || claim.id.length === 0) continue;
    const span = claim.originalSpan;
    if (!span) continue;
    const start = span.start;
    const end = span.end;
    if (!isFiniteInteger(start) || !isFiniteInteger(end)) continue;
    if (start < 0 || end > originalClaim.length || start >= end) continue;
    const slice = originalClaim.slice(start, end);
    if (slice.length === 0) continue;
    if (slice !== claim.text) continue;
    candidates.push({ start, end, claimId: claim.id });
  }

  const overlapping = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (spansOverlap(candidates[i]!, candidates[j]!)) {
        overlapping.add(candidates[i]!.claimId);
        overlapping.add(candidates[j]!.claimId);
      }
    }
  }

  const usable = candidates
    .filter((span) => !overlapping.has(span.claimId))
    .sort((a, b) => a.start - b.start);

  const segments: ClaimTraceSegment[] = [];
  let cursor = 0;
  for (const span of usable) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({
        text: originalClaim.slice(cursor, span.start),
        claimId: null,
        traceable: false,
      });
    }
    segments.push({
      text: originalClaim.slice(span.start, span.end),
      claimId: span.claimId,
      traceable: true,
    });
    cursor = span.end;
  }
  if (cursor < originalClaim.length) {
    segments.push({
      text: originalClaim.slice(cursor),
      claimId: null,
      traceable: false,
    });
  }
  if (segments.length === 0) {
    segments.push({ text: originalClaim, claimId: null, traceable: false });
  }
  return segments;
}
