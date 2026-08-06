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
  verdict: "true" | "false" | "partial" | "unverified" | "exaggerated";
  evidence: string;
  boundary: string;
  supportingSources?: VerdictSource[];
  contradictingSources?: VerdictSource[];
  evidenceGaps?: string[];
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
