import { directionalSources } from "./agents/sourceValidator.js";
import { stripCitationMarkers } from "./citationBinding.js";
import { findClaimSourceRelationAudit, oneRelationPerPart } from "../../../shared/investigation/sourceIdentity.js";

type ClaimSourceRelation = "support" | "contradict" | "conditional" | "context-only" | "unverified";

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
    if (relation !== "support" && relation !== "contradict" && relation !== "conditional" && relation !== "context-only" && relation !== "unverified") continue;
    out.push({
      claimAtom,
      url,
      relation,
      reason: typeof rec.reason === "string" ? rec.reason.trim().slice(0, 320) : "",
      ...(typeof rec.quote === "string" && rec.quote.trim() ? { quote: rec.quote.trim() } : {}),
    });
  }
  return oneRelationPerPart(out);
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
    for (const { url } of directionalSources(verdict)) {
      if (!findClaimSourceRelationAudit(rows, atom, url)) return false;
    }
  }
  return true;
}

type AuditLabel = "true" | "false" | "exaggerated";

function currentLabel(verdict: VerdictLike): unknown {
  return verdict.label ?? verdict.verdict;
}

/**
 * 规则表：这一点的标签由审核后的来源决定，不由核查模型和审核模型各判一次。
 * - 多数来源说「取决于条件」→ 夸大了
 * - 来源只有反驳（对一般人不会发生）→ 不属实
 * - 来源只有支持 → 属实；模型已经判得更轻的不抬高
 * - 没有来源直接谈到，或支持和反驳并存而模型没判成部分属实 / 说法不一 → null（还查不清）
 * 模型判「还查不清」或「说法不一」不改：这两种的判断在于来源之间，不在单个来源。
 */
function labelFromAudit(verdict: VerdictLike, counts: { support: number; contradict: number; conditional: number }): unknown {
  const { support, contradict, conditional } = counts;
  const model = String(verdict.verdict ?? "").trim().toLowerCase();
  if (model === "unverified" || model === "disputed") return currentLabel(verdict);
  if (conditional > 0 && conditional >= contradict && conditional >= support) return "exaggerated";
  if (contradict > 0 && support === 0) return "false";
  if (model === "partial" || model === "exaggerated") return support > 0 ? currentLabel(verdict) : null;
  if (support > 0 && contradict === 0) return model === "true" ? currentLabel(verdict) : null;
  return null;
}

/** 标签被规则表改了：模型那句理由说的是别的标签，换成审核写的理由；真假反转时模型的边界也不再成立。 */
function relabelled(verdict: VerdictLike, label: AuditLabel, firstReason: { support?: string; contradict?: string; conditional?: string }) {
  const model = String(verdict.verdict ?? "").trim().toLowerCase();
  const reason = label === "exaggerated" ? firstReason.conditional : label === "false" ? firstReason.contradict : firstReason.support;
  return {
    label,
    verdict: label,
    ...(reason ? { reason } : {}),
    ...(model === "true" && label === "false" ? { reversedFrom: "true", boundary: "" } : {}),
  };
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
    const counts = { support: 0, contradict: 0, conditional: 0 };
    const firstReason: Partial<Record<keyof typeof counts, string>> = {};

    const candidates = directionalSources(verdict);
    const seenUrls = new Set<string>();
    for (const candidate of candidates) {
      const { url } = candidate;
      // 同一来源被放进两个桶时只算一次，用方向和审核一致的那一行（它的摘句才对得上）。
      if (seenUrls.has(url)) {
        changed = true;
        continue;
      }
      seenUrls.add(url);
      const audit = findClaimSourceRelationAudit(audits, claimAtom, url);
      const { source, relation: original } = candidates.find((c) => c.url === url && c.relation === audit?.relation) ?? candidate;
      hadDirectional = true;
      if (source.fetchStatus === "truncated") {
        // 未读部分可能含否定或适用条件，局部正文不能作为这条命题的方向性依据。
        hadTruncated = true;
        changed = true;
        continue;
      }
      // 只记方向性候选（支持 / 反驳）没有核验结果的情况：这些来源会被降为只作背景。
      if (!audit && audits.length > 0) console.warn(`[relation-audit] directional source has no audit claimAtom=${JSON.stringify(claimAtom)} url=${url}`);
      if (!audit || audit.relation === "context-only" || audit.relation === "unverified") {
        changed = true;
        continue;
      }
      // The quoted sentence was picked for the other direction; it does not belong to the moved row.
      const placed = audit.relation === original ? source : { ...source, quote: "" };
      // 有条件成立的来源证实了内核，和支持放在一起；显示时按审核结果标成「有条件成立」。
      if (audit.relation === "support" || audit.relation === "conditional") support.push(placed);
      else contradict.push(placed);
      counts[audit.relation] += 1;
      firstReason[audit.relation] ??= audit.reason;
      if (audit.relation !== original) changed = true;
    }

    const decided = hadDirectional ? labelFromAudit(verdict, counts) : verdict.label ?? null;
    const shouldDemote = hadDirectional && decided === null;
    const oldGaps = Array.isArray(verdict.evidenceGaps)
      ? verdict.evidenceGaps.filter((gap): gap is string => typeof gap === "string")
      : [];
    const relationGap = hadTruncated
      ? "部分材料只读到了开头，后面可能还有限定条件，暂不用来下判断"
      : "找到的材料还没确认能说明这一点，暂不用来下判断";
    const gaps = (shouldDemote || hadTruncated) && !oldGaps.includes(relationGap) ? [relationGap, ...oldGaps].slice(0, 3) : oldGaps;

    return {
      ...verdict,
      supportingSources: support,
      contradictingSources: contradict,
      evidence: changed ? stripCitationMarkers(typeof verdict.evidence === "string" ? verdict.evidence : "") : verdict.evidence,
      evidenceGaps: gaps,
      sourcesRelatedOnly: support.length + contradict.length === 0 && hadDirectional ? true : verdict.sourcesRelatedOnly === true,
      ...(!shouldDemote && hadDirectional && decided !== currentLabel(verdict) ? relabelled(verdict, decided as AuditLabel, firstReason) : {}),
      ...(shouldDemote ? {
        verdict: "unverified",
        label: "unresolved",
        reason: `${relationGap}。`,
        // 这两句是按被撤销的判断写的，没有依据撑着，不能留在页面上。
        evidence: "",
        boundary: "",
        demotedFrom: String(verdict.verdict ?? ""),
      } : {}),
    } as T;
  });
}
