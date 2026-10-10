import { stripCitationMarkers } from "./citationBinding.js";
import { normalizeInvestigationSourceUrl } from "./investigation/sourceIdentity.js";

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

function hanChars(text: string): Set<string> {
  return new Set(text.match(/\p{Script=Han}/gu) ?? []);
}

/**
 * 找这一截、这个网址的方向核验结果。先按「这一截原文 + 网址」精确找；
 * 找不到时，在同一网址的核验结果里挑这一截文字最接近的那条（共有汉字至少占较短一方的一半）。
 * 2026-10-10：核验模型把这一截写成「吃隔夜菜等于吃毒药」，精确匹配全部落空，所有来源被降为「只和话题相关」，结论成了「还查不清」。
 */
export function findClaimSourceRelationAudit<A extends { claimAtom: string; url: string }>(
  audits: readonly A[],
  claimAtom: string,
  url: string,
  claimAtomKeyFn: (value: string) => string,
): A | undefined {
  const target = normalizeInvestigationSourceUrl(url);
  const sameUrl = audits.filter((audit) => normalizeInvestigationSourceUrl(audit.url) === target);
  const key = claimAtomKeyFn(claimAtom);
  const exact = sameUrl.find((audit) => claimAtomKeyFn(audit.claimAtom) === key);
  if (exact) return exact;
  const own = hanChars(claimAtom);
  let best: A | undefined;
  let bestScore = 0;
  for (const audit of sameUrl) {
    const other = hanChars(audit.claimAtom);
    const shared = [...other].filter((ch) => own.has(ch)).length;
    const score = shared / Math.max(1, Math.min(own.size, other.size));
    if (score > bestScore) {
      best = audit;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.5) return best;
  if (sameUrl.length === 0 && target) console.warn(`[relation-audit] no audit for claimAtom=${JSON.stringify(claimAtom)} url=${target}`);
  return undefined;
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
  if (!Array.isArray(verdicts)) return true;
  for (const item of verdicts) {
    if (!item || typeof item !== "object") continue;
    const verdict = item as VerdictLike;
    const atom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    for (const source of [...sourceList(verdict.supportingSources), ...sourceList(verdict.contradictingSources)]) {
      const url = normalizedUrl(source.url);
      if (url && !findClaimSourceRelationAudit(rows, atom, url, claimAtomKeyFn)) return false;
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

  return verdicts.map((verdict) => {
    const claimAtom = typeof verdict.claimAtom === "string" ? verdict.claimAtom : "";
    const support: SourceLike[] = [];
    const contradict: SourceLike[] = [];
    let changed = false;
    let hadDirectional = false;

    const place = (source: SourceLike, original: "support" | "contradict") => {
      const url = normalizedUrl(source.url);
      if (!url) return;
      hadDirectional = true;
      const audit = findClaimSourceRelationAudit(audits, claimAtom, url, claimAtomKeyFn);
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
    const relationGap = "来源与这条命题的方向关系尚未通过独立核验，暂不作为支持或反驳";
    const gaps = shouldDemote && !oldGaps.includes(relationGap) ? [relationGap, ...oldGaps].slice(0, 3) : oldGaps;

    return {
      ...verdict,
      supportingSources: support,
      contradictingSources: contradict,
      evidence: changed ? stripCitationMarkers(typeof verdict.evidence === "string" ? verdict.evidence : "") : verdict.evidence,
      evidenceGaps: gaps,
      sourcesRelatedOnly: support.length + contradict.length === 0 && hadDirectional ? true : verdict.sourcesRelatedOnly === true,
      ...(shouldDemote ? { verdict: "unverified", demotedFrom: String(verdict.verdict ?? "") } : {}),
    } as T;
  });
}
