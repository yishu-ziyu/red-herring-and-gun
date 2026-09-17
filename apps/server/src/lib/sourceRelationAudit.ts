import { stripCitationMarkers } from "./citationBinding.js";

export type ClaimSourceRelation = "support" | "contradict" | "context-only" | "unverified";

export type ClaimSourceRelationAudit = {
  claimAtom: string;
  url: string;
  relation: ClaimSourceRelation;
  reason: string;
};

type SourceLike = { url?: unknown; title?: unknown; snippet?: unknown };

type VerdictLike = {
  claimAtom?: unknown;
  verdict?: unknown;
  evidence?: unknown;
  supportingSources?: unknown;
  contradictingSources?: unknown;
  evidenceGaps?: unknown;
  sourcesRelatedOnly?: unknown;
  [key: string]: unknown;
};

function normalizedUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function sourceList(value: unknown): SourceLike[] {
  return Array.isArray(value)
    ? value.filter((item): item is SourceLike => Boolean(item) && typeof item === "object")
    : [];
}

export function parseClaimSourceRelationAudits(value: unknown): ClaimSourceRelationAudit[] {
  if (!Array.isArray(value)) return [];
  const out: ClaimSourceRelationAudit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const claimAtom = typeof rec.claimAtom === "string" ? rec.claimAtom.trim() : "";
    const url = normalizedUrl(rec.url);
    const relation = rec.relation;
    if (!claimAtom || !/^https?:\/\//i.test(url)) continue;
    if (relation !== "support" && relation !== "contradict" && relation !== "context-only" && relation !== "unverified") continue;
    out.push({
      claimAtom,
      url,
      relation,
      reason: typeof rec.reason === "string" ? rec.reason.trim().slice(0, 320) : "",
    });
  }
  return out;
}

export function relationAuditCoversDirectionalSources(
  verdicts: unknown,
  audits: unknown,
  claimAtomKeyFn: (value: string) => string,
): boolean {
  const rows = parseClaimSourceRelationAudits(audits);
  const keys = new Set(rows.map((row) => `${claimAtomKeyFn(row.claimAtom)}\u0000${row.url}`));
  if (!Array.isArray(verdicts)) return true;
  for (const item of verdicts) {
    if (!item || typeof item !== "object") continue;
    const verdict = item as VerdictLike;
    const atom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    const atomKey = claimAtomKeyFn(atom);
    for (const source of [...sourceList(verdict.supportingSources), ...sourceList(verdict.contradictingSources)]) {
      const url = normalizedUrl(source.url);
      if (url && !keys.has(`${atomKey}\u0000${url}`)) return false;
    }
  }
  return true;
}

/**
 * Second-opinion gate for public evidence direction.
 * Missing/unclear audits never become directional evidence. The source remains
 * in the retrieval bundle, so InvestigationSnapshot can still expose it as context-only.
 */
export function applyClaimSourceRelationAudit<T extends VerdictLike>(
  verdicts: T[],
  auditsRaw: unknown,
  claimAtomKeyFn: (value: string) => string,
): T[] {
  const audits = parseClaimSourceRelationAudits(auditsRaw);
  const byKey = new Map<string, ClaimSourceRelationAudit>();
  for (const audit of audits) {
    byKey.set(`${claimAtomKeyFn(audit.claimAtom)}\u0000${audit.url}`, audit);
  }

  return verdicts.map((verdict) => {
    const claimAtom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    const atomKey = claimAtomKeyFn(claimAtom);
    const support: SourceLike[] = [];
    const contradict: SourceLike[] = [];
    let changed = false;
    let hadDirectional = false;

    const place = (source: SourceLike, original: "support" | "contradict") => {
      const url = normalizedUrl(source.url);
      if (!url) return;
      hadDirectional = true;
      const audit = byKey.get(`${atomKey}\u0000${url}`);
      if (!audit || audit.relation === "context-only" || audit.relation === "unverified") {
        changed = true;
        return;
      }
      if (audit.relation === "support") support.push(source);
      else contradict.push(source);
      if (audit.relation !== original) changed = true;
    };
    for (const source of sourceList(verdict.supportingSources)) place(source, "support");
    for (const source of sourceList(verdict.contradictingSources)) place(source, "contradict");

    const verdictNorm = typeof verdict.verdict === "string" ? verdict.verdict.trim().toLowerCase() : "";
    const directionConsistent =
      verdictNorm === "true"
        ? support.length > 0 && contradict.length === 0
        : verdictNorm === "false"
          ? contradict.length > 0 && support.length === 0
          : verdictNorm === "partial" || verdictNorm === "exaggerated"
            ? support.length + contradict.length > 0
            : true;
    const shouldDemote = hadDirectional && !directionConsistent;
    const oldGaps = Array.isArray(verdict.evidenceGaps)
      ? verdict.evidenceGaps.filter((gap): gap is string => typeof gap === "string")
      : [];
    const relationGap = "来源与这条命题的方向关系尚未通过独立核验，暂不作为支持或反驳";
    const gaps = shouldDemote && !oldGaps.includes(relationGap) ? [relationGap, ...oldGaps].slice(0, 3) : oldGaps;

    return {
      ...verdict,
      supportingSources: support,
      contradictingSources: contradict,
      evidence: changed ? stripCitationMarkers(typeof verdict.evidence === "string" ? verdict.evidence : "") : verdict.evidence,
      evidenceGaps: gaps,
      sourcesRelatedOnly: support.length + contradict.length === 0 && hadDirectional ? true : verdict.sourcesRelatedOnly === true,
      ...(shouldDemote ? { verdict: "unverified" } : {}),
    } as T;
  });
}
