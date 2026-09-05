import type { Claim, ClaimVerdict, Overall } from "../casefile/schema.js";
import type { CitationTable } from "./compose.js";

export function citationMarks(ns: readonly number[]): string {
  return ns.map((n) => `[${n}]`).join("");
}

export function verdictTail(verdict: string): string {
  switch (verdict) {
    case "true":
      return "有依据。";
    case "false":
      return "与现有依据相反。";
    case "partial":
    case "mixed_misleading":
      return "只有一部分成立。";
    case "contested":
      return "来源之间相互矛盾，两边都有依据。";
    default:
      return "没有找到足够依据。";
  }
}

export function safeClaimLine(input: {
  claimText: string;
  checkable: boolean;
  verdict: ClaimVerdict["verdict"] | string;
  citationNs: readonly number[];
}): string {
  if (!input.checkable) return `${input.claimText}：这是评价或立场，不做真假判断。`;
  const tail = verdictTail(input.verdict);
  const marks = input.verdict === "unverified" ? "" : citationMarks(input.citationNs);
  return `${input.claimText}：${tail}${marks}`;
}

export function safeConclusion(input: {
  sourceText: string;
  verdictType: Overall["verdictType"] | string;
  contested: boolean;
  citationNs: readonly number[];
}): string {
  const type = input.verdictType;
  const tail =
    input.contested && type !== "contested"
      ? `${verdictTail(type)}来源之间相互矛盾，两边都有依据。`
      : verdictTail(type);
  const marks =
    type === "true" || type === "false" || type === "mixed_misleading" ? citationMarks(input.citationNs) : "";
  return `${input.sourceText}：${tail}${marks}`;
}

export function overallCitationNs(table: CitationTable, claims: readonly Claim[], verdictType: string): number[] {
  if (verdictType !== "true" && verdictType !== "false" && verdictType !== "mixed_misleading") return [];
  const ordered = claims.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const out: number[] = [];
  const seen = new Set<number>();
  for (const claim of ordered) {
    for (const n of table.nsByClaim.get(claim.id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function constrainComposeDraft(input: {
  sourceText: string;
  claims: readonly Claim[];
  verdicts: readonly ClaimVerdict[];
  overall?: Overall;
  table: CitationTable;
}): { conclusion: string; claimItems: Array<{ claimId: string; line: string }> } {
  const verdictOf = new Map(input.verdicts.map((item) => [item.claimId, item.verdict]));
  const overallType = input.overall?.verdictType ?? "unverified";
  return {
    conclusion: safeConclusion({
      sourceText: input.sourceText,
      verdictType: overallType,
      contested: input.overall?.contested === true,
      citationNs: overallCitationNs(input.table, input.claims, overallType),
    }),
    claimItems: input.claims.map((claim) => ({
      claimId: claim.id,
      line: safeClaimLine({
        claimText: claim.text,
        checkable: claim.checkable,
        verdict: verdictOf.get(claim.id) ?? "unverified",
        citationNs: input.table.nsByClaim.get(claim.id) ?? [],
      }),
    })),
  };
}
