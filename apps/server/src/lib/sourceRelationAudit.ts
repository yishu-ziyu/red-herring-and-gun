import { stripCitationMarkers } from "./citationBinding.js";
import { findClaimSourceRelationAudit } from "../../../shared/investigation/sourceIdentity.js";

type ClaimSourceRelation = "support" | "contradict" | "context-only" | "unverified";

type ClaimSourceRelationAudit = {
  claimAtom: string;
  url: string;
  relation: ClaimSourceRelation;
  reason: string;
  quote?: string;
};

type SourceLike = { url?: unknown; title?: unknown; snippet?: unknown; fetchStatus?: unknown };

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

function parseClaimSourceRelationAudits(value: unknown): ClaimSourceRelationAudit[] {
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
      ...(typeof rec.quote === "string" && rec.quote.trim() ? { quote: rec.quote.trim() } : {}),
    });
  }
  return out;
}

export function relationAuditCoversDirectionalSources(
  verdicts: unknown,
  audits: unknown,
): boolean {
  const rows = parseClaimSourceRelationAudits(audits);
  if (!Array.isArray(verdicts)) return true;
  for (const item of verdicts) {
    if (!item || typeof item !== "object") continue;
    const verdict = item as VerdictLike;
    const atom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    for (const source of [...sourceList(verdict.supportingSources), ...sourceList(verdict.contradictingSources)]) {
      const url = normalizedUrl(source.url);
      if (url && !findClaimSourceRelationAudit(rows, atom, url)) return false;
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
): T[] {
  const audits = parseClaimSourceRelationAudits(auditsRaw);

  return verdicts.map((verdict) => {
    const claimAtom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    const support: SourceLike[] = [];
    const contradict: SourceLike[] = [];
    let changed = false;
    let hadDirectional = false;
    let hadTruncated = false;

    const place = (source: SourceLike, original: "support" | "contradict") => {
      const url = normalizedUrl(source.url);
      if (!url) return;
      hadDirectional = true;
      if (source.fetchStatus === "truncated") {
        // 未读部分可能含否定或适用条件，局部正文不能作为这条命题的方向性依据。
        hadTruncated = true;
        changed = true;
        return;
      }
      const audit = findClaimSourceRelationAudit(audits, claimAtom, url);
      // 只记方向性候选（支持 / 反驳）没有核验结果的情况：这些来源会被降为只作背景。
      if (!audit && audits.length > 0) console.warn(`[relation-audit] directional source has no audit claimAtom=${JSON.stringify(claimAtom)} url=${url}`);
      if (!audit || audit.relation === "context-only" || audit.relation === "unverified") {
        changed = true;
        return;
      }
      // The quoted sentence was picked for the other direction; it does not belong to the moved row.
      const placed = audit.relation === original ? source : { ...source, quote: "" };
      if (audit.relation === "support") support.push(placed);
      else contradict.push(placed);
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
    const relationGap = hadTruncated
      ? "部分来源只取得局部正文，未读部分可能包含限定条件，暂不作为支持或反驳"
      : "来源与这条命题的方向关系尚未通过独立核验，暂不作为支持或反驳";
    const gaps = (shouldDemote || hadTruncated) && !oldGaps.includes(relationGap) ? [relationGap, ...oldGaps].slice(0, 3) : oldGaps;

    return {
      ...verdict,
      supportingSources: support,
      contradictingSources: contradict,
      evidence: changed ? stripCitationMarkers(typeof verdict.evidence === "string" ? verdict.evidence : "") : verdict.evidence,
      evidenceGaps: gaps,
      sourcesRelatedOnly: support.length + contradict.length === 0 && hadDirectional ? true : verdict.sourcesRelatedOnly === true,
      ...(shouldDemote ? {
        verdict: "unverified",
        label: "unresolved",
        reason: relationGap,
        demotedFrom: String(verdict.verdict ?? ""),
      } : {}),
    } as T;
  });
}
