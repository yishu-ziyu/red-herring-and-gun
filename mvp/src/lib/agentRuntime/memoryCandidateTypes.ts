export type MemoryCandidateKind =
  | "case_pattern"
  | "evidence_item"
  | "search_strategy"
  | "source_reputation"
  | "recursive_path"
  | "reasoning_pattern"
  | "failure_record";

export type MemoryCandidateStatus = "proposed" | "accepted" | "rejected";

export interface MemoryCandidateProvenance {
  runId: string;
  claim: string;
  normalizedClaim: string;
  createdAt: number;
  agentId?: string;
  sourceUrls: string[];
  unresolvedQuestions: string[];
}

export interface MemoryCandidate<TPayload = unknown> {
  id: string;
  kind: MemoryCandidateKind;
  status: MemoryCandidateStatus;
  title: string;
  summary: string;
  confidence: number;
  tags: string[];
  proposedByAgent: string;
  provenance: MemoryCandidateProvenance;
  payload: TPayload;
  statusUpdatedAt?: number;
  statusReason?: string;
}

export interface MemoryCandidateHit {
  candidate: MemoryCandidate;
  score: number;
  matchedTerms: string[];
}

export interface SearchStrategyMemoryPayload {
  rumorType: string;
  effectiveQueries: string[];
  ineffectiveQueries: string[];
  sourceDomains: string[];
  stopRules: string[];
}

export interface SourceReputationMemoryPayload {
  domain: string;
  sourceName?: string;
  observedRoles: string[];
  observedScores: number[];
  posteriorScore: number;
  note: string;
}

export interface RecursivePathMemoryPayload {
  rootClaim: string;
  subquestions: string[];
  effectiveQueries: string[];
  evidenceGaps: string[];
  stopRules: string[];
}

export interface ReasoningPatternMemoryPayload {
  pattern: string;
  whyItMatters: string;
  blockedInference: string[];
  saferRewrite?: string;
}
