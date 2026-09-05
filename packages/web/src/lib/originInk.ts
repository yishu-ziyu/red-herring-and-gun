import type { Case, Claim } from "@rhg/core/casefile";

export type OriginSegment = {
  text: string;
  kind: "plain" | "claim";
  claimId?: string;
  citeNs: number[];
};

export function locateClaim(source: string, claim: Claim): { start: number; end: number } | undefined {
  const span = claim.span;
  if (span && span.start >= 0 && span.end <= source.length && span.end > span.start) {
    if (source.slice(span.start, span.end) === claim.text) return span;
  }
  const text = claim.text;
  if (!text) return undefined;
  const first = source.indexOf(text);
  if (first < 0) return undefined;
  if (source.indexOf(text, first + 1) >= 0) return undefined;
  return { start: first, end: first + text.length };
}

function originCandidates(current: Case): string[] {
  const out: string[] = [];
  const seed = current.text.trim();
  if (seed) out.push(seed);
  for (const message of current.messages) {
    if (message.role !== "user") continue;
    const text = message.text.trim();
    if (text) out.push(text);
  }
  return out;
}

function checkableClaims(current: Case): Claim[] {
  return current.claims.filter((claim) => claim.checkable && claim.text.trim().length > 0);
}

function carriesAll(source: string, claims: readonly Claim[]): boolean {
  return claims.every((claim) => locateClaim(source, claim) !== undefined);
}

/** 从案件原文与用户消息里选一条能完整承载当前可核命题的原句；优先最新。不跨消息拼接。 */
export function pickOriginSource(current: Case): string | undefined {
  const claims = checkableClaims(current);
  if (claims.length === 0) return undefined;
  let chosen: string | undefined;
  for (const source of originCandidates(current)) {
    if (carriesAll(source, claims)) chosen = source;
  }
  return chosen;
}

export function citesForClaim(current: Case, claimId: string): number[] {
  const fromItems = (current.report?.claimItems ?? []).find((item) => item.claimId === claimId)?.citations ?? [];
  if (fromItems.length > 0) return [...fromItems];
  const byEvidence: number[] = [];
  for (const row of current.report?.citations ?? []) {
    const evidence = current.evidence.find((item) => item.id === row.evidenceId);
    if (evidence?.provenance.kind === "search" && evidence.provenance.claimId === claimId) {
      byEvidence.push(row.n);
    }
  }
  return byEvidence;
}

export function originSegments(current: Case): OriginSegment[] {
  const source = pickOriginSource(current);
  if (!source) return [];
  const located = current.claims
    .filter((claim) => claim.checkable)
    .map((claim) => {
      const span = locateClaim(source, claim);
      return span ? { claim, span } : undefined;
    })
    .filter((row): row is { claim: Claim; span: { start: number; end: number } } => Boolean(row))
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);

  const used: typeof located = [];
  for (const row of located) {
    if (used.some((prev) => !(row.span.end <= prev.span.start || row.span.start >= prev.span.end))) continue;
    used.push(row);
  }

  const segments: OriginSegment[] = [];
  let cursor = 0;
  for (const row of used) {
    if (row.span.start > cursor) {
      segments.push({ text: source.slice(cursor, row.span.start), kind: "plain", citeNs: [] });
    }
    segments.push({
      text: source.slice(row.span.start, row.span.end),
      kind: "claim",
      claimId: row.claim.id,
      citeNs: citesForClaim(current, row.claim.id),
    });
    cursor = row.span.end;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), kind: "plain", citeNs: [] });
  return segments.filter((item) => item.text.length > 0);
}
