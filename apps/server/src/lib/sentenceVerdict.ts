/**
 * 用例：给一份核查报告下整句结论。
 *
 * 读取报告里各命题的证据 → 交给 domain/verdict 的规则表 → 把结论与首句写回报告。
 * 这是整句判定的唯一决定点；此前各道关卡改过的 verdictType 在这里被规则表的结果取代。
 */
import { decideSentenceVerdict, type AssessedClaim, type ClaimStanding, type SentenceVerdict } from "../domain/verdict.js";
import { listAtomsForSearch } from "./atomSearch.js";
import { claimAtomKey } from "./claimAtom/index.js";
import { hasDirectionalBoundHttpUrl } from "./citationBinding.js";
import { renderVerdictConclusion } from "./wholeClaimAudit/conclusionGate.js";

type Report = Record<string, unknown>;
type Source = { url?: unknown; title?: unknown; snippet?: unknown };

export type SentenceVerdictInput = {
  claimAtoms: unknown;
  claimAtomTypes: unknown;
  /** 拆题给出的主次顺序；第一条可核查的就是主要主张。 */
  priorityClaimAtoms?: unknown;
};

const VERDICT_TYPE: Record<SentenceVerdict, string> = {
  "cannot-believe": "false",
  "can-believe": "true",
  "part-true-part-false": "mixed_misleading",
  "not-enough-evidence": "unverified",
};

function records(value: unknown): Report[] {
  return Array.isArray(value) ? value.filter((v): v is Report => Boolean(v && typeof v === "object")) : [];
}

function findVerdict(report: Report, atom: string): Report | undefined {
  const key = claimAtomKey(atom);
  return records(report.subclaimVerdicts).find((v) => claimAtomKey(String(v.claimAtom ?? "")) === key);
}

function standingOf(verdict: Report | undefined): ClaimStanding {
  if (!verdict) return "unresolved";
  const v = String(verdict.verdict ?? "").trim().toLowerCase();
  const bound = (direction: string) =>
    hasDirectionalBoundHttpUrl({
      verdict: direction,
      supportingSources: verdict.supportingSources,
      contradictingSources: verdict.contradictingSources,
      sourcesRelatedOnly: verdict.sourcesRelatedOnly,
    });
  if (v === "false") return bound("false") ? "refuted" : "unresolved";
  if (v === "true") return bound("true") ? "supported" : "unresolved";
  if (v === "partial" || v === "exaggerated" || v === "mixed" || v === "mixed_misleading") return bound(v) ? "mixed" : "unresolved";
  return "unresolved";
}

/** 可核查命题及其角色：拆题排序里第一条可核查的是主要主张，其余是次要部分。 */
export function listAssessedClaims(report: Report, input: SentenceVerdictInput): AssessedClaim[] {
  const { verifiable } = listAtomsForSearch(input.claimAtoms, input.claimAtomTypes);
  if (verifiable.length === 0) return [];
  const verifiableKeys = new Map(verifiable.map((atom) => [claimAtomKey(atom), atom]));
  const priority = Array.isArray(input.priorityClaimAtoms)
    ? input.priorityClaimAtoms.map((atom) => verifiableKeys.get(claimAtomKey(String(atom)))).find(Boolean)
    : undefined;
  const primary = priority ?? verifiable[0];
  return verifiable.map((atom) => ({
    text: atom,
    role: atom === primary ? "primary" : "secondary",
    standing: standingOf(findVerdict(report, atom)),
  }));
}

/**
 * 证据关系的降级手段：没有模型判定时，检索里明确辟谣这句话、又没有对题支持的材料，
 * 作为主要主张的反驳出处（标明依据来自标题摘要，不是逐篇审核）。
 * 只在模型没有判定主要主张时使用（兜底报告里的「模型未覆盖」）。
 */
export function bindDebunksToPrimaryClaim(report: Report, primary: AssessedClaim | undefined, debunks: readonly Source[]): boolean {
  if (!primary || primary.standing !== "unresolved") return false;
  // 模型明确判了「查不清」就不用关键词覆盖它。只补两种空白：模型根本没判；
  // 模型判了站不住，但出处没通过关系审核或绑定而被降级（方向与辟谣材料一致）。
  const existing = findVerdict(report, primary.text);
  if (existing && existing.notJudgedByModel !== true && existing.demotedFrom !== "false") return false;
  const links = debunks
    .filter((s) => typeof s.url === "string" && /^https?:\/\//i.test(s.url))
    .slice(0, 5)
    .map((s) => ({ url: String(s.url), title: String(s.title ?? ""), snippet: String(s.snippet ?? "") }));
  if (links.length === 0) return false;
  const verdicts = records(report.subclaimVerdicts);
  let entry = findVerdict(report, primary.text);
  if (!entry) {
    entry = { claimAtom: primary.text };
    verdicts.push(entry);
  }
  const urls = new Set(links.map((s) => s.url));
  const keep = (list: unknown) => records(list).filter((s) => !urls.has(String(s.url ?? "")));
  entry.verdict = "false";
  entry.evidence = "检索到针对这句话的辟谣材料，未见对题的支持材料。";
  entry.boundary = "依据是标题或摘要明确辟谣这句话的材料，没有逐篇核对原文论证。";
  // related-only 的支持桶只是检索填充（兜底报告会把辟谣也放进去），不能留作「支持」。
  entry.supportingSources = entry.sourcesRelatedOnly === true ? [] : keep(entry.supportingSources);
  entry.contradictingSources = [...keep(entry.contradictingSources), ...links];
  entry.relationBasis = "debunk-title";
  delete entry.sourcesRelatedOnly;
  delete entry.notJudgedByModel;
  delete entry.demotedFrom;
  report.subclaimVerdicts = verdicts;
  primary.standing = "refuted";
  return true;
}

/** 下整句结论并写回报告。返回规则表的决定，供调用方记录。 */
export function applySentenceVerdict(
  report: Report,
  claims: AssessedClaim[],
  context: { nonVerifiableAtoms?: unknown; auditUnresolvedGaps?: readonly string[]; debunkBound?: boolean } = {}
) {
  const decision = decideSentenceVerdict(claims);
  const before = String(report.verdictType ?? "");
  const verdictType = VERDICT_TYPE[decision.verdict];
  const primary = claims.find((claim) => claim.role === "primary");
  report.verdictType = verdictType;
  report._verdictDecision = { rule: decision.rule, primary: primary?.text ?? null, from: before };

  // 模型写的正文与规则结论一致、且没有被任何关卡重写或降级时，保留模型的文字。
  const repaired = Boolean((report._conclusionGate as Record<string, unknown> | undefined)?.repaired);
  const needsRewrite =
    before !== verdictType ||
    decision.boundaryClaims.length > 0 ||
    repaired ||
    Boolean(context.debunkBound) ||
    typeof report._fallbackReason === "string";
  if (needsRewrite) {
    renderVerdictConclusion(report, verdictType, {
      nonVerifiableAtoms: context.nonVerifiableAtoms ?? report.nonVerifiableAtoms,
      subclaimVerdicts: report.subclaimVerdicts,
      auditUnresolvedGaps: context.auditUnresolvedGaps,
    });
  }
  return decision;
}
