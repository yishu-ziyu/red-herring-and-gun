/**
 * handoffPacket.ts — AI Agent Book Ch.10 explicit handoff packets
 *
 * Between agents: pass a compact structured packet with only fields the
 * receiver needs. Not a full trajectory dump of previous step outputs.
 */

export interface HandoffPacket {
  from: string;
  to: string;
  /** Receiver-scoped compact fields only */
  payload: Record<string, unknown>;
}

/** Default max length for a single string field in a packet. */
const DEFAULT_STR_MAX = 260;
/** Default max items for string arrays. */
const DEFAULT_ARR_LIMIT = 6;

type PacketBuilder = (output: Record<string, unknown>) => Record<string, unknown>;

/**
 * Route table: only known producer→consumer pairs emit packets.
 * Keys are `${from}->${to}`.
 *
 * Core (Ch.10):
 * - rumor_detector→fact_checker: claimAtoms, neededEvidence, rumorTypes, severity
 * - rumor_detector→source_validator: claimAtoms, rumorIndicators, neededEvidence
 * - fact_checker→report_composer: factCheckResult, keyFindings, gaps, counterEvidence
 * - source_validator→report_composer: reliability, verified, questionable, missing
 */
const PACKET_ROUTES: Record<string, PacketBuilder> = {
  "rumor_detector->fact_checker": (o) => ({
    claimAtoms: compactStrings(o.claimAtoms, DEFAULT_ARR_LIMIT, 180),
    neededEvidence: compactStrings(o.neededEvidence, 5, 180),
    rumorTypes: compactStrings(o.rumorTypes, 4, 80),
    severity: compactSeverity(o.severity),
  }),

  "rumor_detector->source_validator": (o) => ({
    claimAtoms: compactStrings(o.claimAtoms, DEFAULT_ARR_LIMIT, 180),
    rumorIndicators: compactStrings(o.rumorIndicators, 5, 120),
    neededEvidence: compactStrings(o.neededEvidence, 5, 180),
  }),

  "fact_checker->report_composer": (o) => ({
    factCheckResult: compactText(o.factCheckResult, 40) || "unverified",
    keyFindings: compactStrings(o.keyFindings, 5, DEFAULT_STR_MAX),
    gaps: compactStrings(o.unresolvedEvidenceGaps ?? o.gaps, 4, 240),
    counterEvidence: compactStrings(o.counterEvidence, 5, 240),
  }),

  "source_validator->report_composer": (o) => ({
    reliability: compactText(o.sourceReliability ?? o.reliability, 40) || "unverified",
    verified: compactStrings(o.verifiedSources ?? o.verified, 4, 220),
    questionable: compactStrings(o.questionableSources ?? o.questionable, 4, 220),
    missing: compactStrings(o.missingSources ?? o.missing, 4, 220),
  }),

  // Optional causal-path packets (same compact principle)
  "fact_checker->counter_evidence_grader": (o) => ({
    factCheckResult: compactText(o.factCheckResult, 40) || "unverified",
    confidence: compactText(o.confidence, 40) || "low",
    counterEvidence: compactStrings(o.counterEvidence, 5, 200),
    gaps: compactStrings(o.unresolvedEvidenceGaps ?? o.gaps, 4, 200),
  }),

  "alternative_explanation_searcher->report_composer": (o) => ({
    conclusion: compactText(o.conclusion, 280),
    alternativeExplanations: Array.isArray(o.alternativeExplanations)
      ? o.alternativeExplanations.slice(0, 3)
      : [],
  }),

  "counter_evidence_grader->report_composer": (o) => ({
    overallConfidenceAdjustment: o.overallConfidenceAdjustment,
    recommendation: o.recommendation,
    breakdown: o.breakdown,
  }),
};

/**
 * Build one compact handoff packet for a known from→to route.
 * Returns null when the route is not defined (no packet for that pair).
 */
export function buildHandoffPacket(
  fromAgent: string,
  toAgent: string,
  stepOutput: Record<string, unknown> | null | undefined
): HandoffPacket | null {
  const key = `${fromAgent}->${toAgent}`;
  const builder = PACKET_ROUTES[key];
  if (!builder) return null;
  const output = stepOutput && typeof stepOutput === "object" ? stepOutput : {};
  return {
    from: fromAgent,
    to: toAgent,
    payload: builder(output),
  };
}

export interface HandoffStepLike {
  agent: string;
  output?: Record<string, unknown> | null;
  status?: string;
}

/**
 * Collect handoff packets for `toAgent` from previous completed steps.
 * Skips failed steps and unknown routes.
 */
export function buildHandoffPacketsFromSteps(
  toAgent: string,
  previousSteps: HandoffStepLike[] | undefined | null
): HandoffPacket[] {
  if (!previousSteps?.length) return [];
  const packets: HandoffPacket[] = [];
  for (const step of previousSteps) {
    if (step.status && step.status !== "completed") continue;
    const packet = buildHandoffPacket(step.agent, toAgent, step.output ?? undefined);
    if (packet) packets.push(packet);
  }
  return packets;
}

/** Alias used by AgentRuntime (same behavior as buildHandoffPacketsFromSteps). */
export function collectHandoffPacketsForAgent(
  agentId: string,
  previousSteps: Array<{ agent: string; output?: Record<string, unknown> | null; status?: string }>
): HandoffPacket[] {
  return buildHandoffPacketsFromSteps(agentId, previousSteps);
}

// ─── compact helpers ───────────────────────────────────────────

function compactStrings(value: unknown, limit = DEFAULT_ARR_LIMIT, maxLength = DEFAULT_STR_MAX): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, limit)
    .map((item) => truncateString(item.trim(), maxLength));
}

function compactText(value: unknown, maxLength = DEFAULT_STR_MAX): string {
  if (typeof value !== "string") return "";
  return truncateString(value.trim(), maxLength);
}

function compactSeverity(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "low";
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}
