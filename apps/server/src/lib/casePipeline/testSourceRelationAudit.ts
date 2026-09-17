import type { PipelineStep } from "./runCasePipeline.js";

type Relation = "support" | "contradict" | "context-only";

function sourceRows(value: unknown): Array<{ url?: unknown }> {
  return Array.isArray(value)
    ? value.filter((item): item is { url?: unknown } => Boolean(item) && typeof item === "object")
    : [];
}

/**
 * Test-only fixture helper. Existing pipeline tests already declare the semantic
 * direction in their FactChecker fixture; this mirrors that fixture through the
 * new independent relation-audit contract without weakening production code.
 */
export function confirmedRelationAuditsFromSteps(steps: PipelineStep[]) {
  const fact = [...steps].reverse().find((step) => step.agent === "fact_checker");
  const verdicts = Array.isArray(fact?.relationAuditCandidates)
    ? fact.relationAuditCandidates
    : Array.isArray(fact?.output?.subclaimVerdicts)
      ? fact.output.subclaimVerdicts
      : [];
  const out: Array<{ claimAtom: string; url: string; relation: Relation; reason: string }> = [];
  const seen = new Set<string>();
  for (const raw of verdicts) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const claimAtom = typeof row.claimAtom === "string" ? row.claimAtom : "";
    if (!claimAtom) continue;
    const verdict = typeof row.verdict === "string" ? row.verdict.toLowerCase() : "";
    const relatedOnly = row.sourcesRelatedOnly === true;
    const supportRows = sourceRows(row.supportingSources);
    const contradictRows = sourceRows(row.contradictingSources);
    const add = (source: { url?: unknown }, relation: Relation) => {
      const url = typeof source.url === "string" ? source.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) return;
      const key = `${claimAtom}\u0000${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ claimAtom, url, relation, reason: `test fixture confirms ${relation}` });
    };
    if (relatedOnly) {
      for (const source of [...supportRows, ...contradictRows]) add(source, "context-only");
      continue;
    }
    // Legacy #74 fixture: a false verdict with only a support bucket is aligned
    // to contradict before publication. Confirm the intended semantic direction.
    const supportRelation: Relation = verdict === "false" && contradictRows.length === 0 ? "contradict" : "support";
    for (const source of supportRows) add(source, supportRelation);
    for (const source of contradictRows) add(source, "contradict");
  }
  return out;
}

export function confirmedSourceValidatorStep(
  steps: PipelineStep[],
  sourceReliability: "high" | "medium" | "low" | "unverified" = "medium",
): PipelineStep {
  return {
    agent: "source_validator",
    output: {
      sourceReliability,
      verifiedSources: [],
      questionableSources: [],
      missingSources: [],
      verificationNotes: "test fixture relation audit",
      claimSourceRelations: confirmedRelationAuditsFromSteps(steps),
    },
    status: "completed",
    timestamp: Date.now(),
  };
}
