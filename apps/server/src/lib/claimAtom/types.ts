/**
 * Claim-atom domain types (deep module surface for atom keys, exclusion, verdicts).
 */

export interface VerdictSource {
  url: string;
  title: string;
  snippet: string;
}

export interface SubclaimVerdict {
  claimAtom: string;
  verdict: "true" | "false" | "partial" | "unverified" | "exaggerated" | "disputed";
  evidence: string;
  boundary: string;
  /** verdict=partial 时：来源明确反驳的原句里那个具体要素，逐字取自命题原文。 */
  contradictedElement?: string;
  supportingSources?: VerdictSource[];
  contradictingSources?: VerdictSource[];
  evidenceGaps?: string[];
  /** supportingSources auto-filled from retrieval; not model-cited → no [n] binding */
  sourcesRelatedOnly?: boolean;
  /** 没有任何模型判定这条命题（区别于模型明确判了 unverified）。 */
  notJudgedByModel?: boolean;
  /** 模型原本的判定（true/false），被证据关系审核或出处绑定降成 unverified 时记下。 */
  demotedFrom?: string;
}

export type ClaimAtomType =
  | "fact"
  | "causal"
  | "comparison"
  | "concept"
  | "value"
  | "prediction"
  | "normative"
  | "personal";

export interface ClaimAtomDropped {
  text: string;
  reason: string;
}

export type NonVerifiableAtom = { text: string; type: string };

export type ClaimReportItem = {
  text: string;
  verifiable: boolean;
  type: string;
  verdict?: Record<string, unknown>;
};
