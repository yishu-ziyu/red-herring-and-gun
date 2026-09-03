import type { Case, CaseEvent, CaseInput, Evidence } from "./schema.js";

function emptyCase(): Case {
  return {
    id: "",
    text: "",
    createdAt: "",
    seq: 0,
    claims: [],
    evidence: [],
    stances: [],
    verdicts: [],
    cites: [],
    frontier: [],
    consumedPivotIds: [],
    investigatorSteps: [],
    investigatorStops: [],
    llmCalls: [],
    stages: [],
    turns: [],
    messages: [],
    errors: [],
    droppedClaims: [],
  };
}

function patchEvidence(current: Evidence, event: Extract<CaseEvent, { type: "evidence.updated" }>): Evidence {
  const next: Evidence = { ...current };
  if (event.clusterId !== undefined) next.clusterId = event.clusterId;
  if (event.text !== undefined) next.text = event.text;
  if (event.reachable !== undefined) next.reachable = event.reachable;
  if (event.title !== undefined) next.title = event.title;
  if (event.excerpt !== undefined) next.excerpt = event.excerpt;
  if (event.tier !== undefined) next.tier = event.tier;
  if (event.publishedAt !== undefined) next.publishedAt = event.publishedAt;
  if (event.host !== undefined) next.host = event.host;
  if (event.canonicalUrl !== undefined) next.canonicalUrl = event.canonicalUrl;
  return next;
}

export function reduce(c: Case, event: CaseEvent): Case {
  switch (event.type) {
    case "case.created":
      return {
        ...emptyCase(),
        id: event.id,
        text: event.text,
        createdAt: event.at,
        seq: event.seq,
      };
    case "message.added":
      return { ...c, seq: event.seq, messages: [...c.messages, { ...event.message }] };
    case "turn.started":
      return {
        ...c,
        seq: event.seq,
        turns: [...c.turns, { id: event.turnId, startedAt: event.at }],
      };
    case "turn.finished": {
      let match = -1;
      for (let i = c.turns.length - 1; i >= 0; i -= 1) {
        const turn = c.turns[i]!;
        if (turn.finishedAt !== undefined) continue;
        if (turn.id !== event.turnId) continue;
        match = i;
        break;
      }
      const turns =
        match === -1
          ? [
              ...c.turns,
              {
                id: event.turnId,
                startedAt: event.at,
                finishedAt: event.at,
                reason: event.reason,
              },
            ]
          : c.turns.map((turn, index) =>
              index === match
                ? { ...turn, finishedAt: event.at, reason: event.reason }
                : turn,
            );
      return { ...c, seq: event.seq, turns };
    }
    case "stage.started":
      return {
        ...c,
        seq: event.seq,
        stages: [
          ...c.stages,
          {
            stage: event.stage,
            ...(event.claimId !== undefined ? { claimId: event.claimId } : {}),
            startedAt: event.at,
            seq: event.seq,
          },
        ],
      };
    case "stage.finished": {
      // close the latest unfinished stage with the same name and claimId
      let match = -1;
      for (let i = c.stages.length - 1; i >= 0; i -= 1) {
        const stage = c.stages[i]!;
        if (stage.finishedAt !== undefined) continue;
        if (stage.stage !== event.stage) continue;
        if (stage.claimId !== event.claimId) continue;
        match = i;
        break;
      }
      const stages =
        match === -1
          ? [
              ...c.stages,
              {
                stage: event.stage,
                ...(event.claimId !== undefined ? { claimId: event.claimId } : {}),
                startedAt: event.at,
                finishedAt: event.at,
                ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
                seq: event.seq,
              },
            ]
          : c.stages.map((stage, index) =>
              index === match
                ? {
                    ...stage,
                    finishedAt: event.at,
                    ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
                  }
                : stage,
            );
      return { ...c, seq: event.seq, stages };
    }
    case "claims.added":
      return { ...c, seq: event.seq, claims: [...c.claims, ...event.claims.map((claim) => ({ ...claim }))] };
    case "claims.dropped": {
      const droppedIds = new Set(event.dropped.map((item) => item.id));
      return {
        ...c,
        seq: event.seq,
        claims: c.claims.filter((claim) => !droppedIds.has(claim.id)),
        droppedClaims: [
          ...c.droppedClaims,
          ...event.dropped.map((item) => ({
            id: item.id,
            text: item.text,
            reason: item.reason,
            seq: event.seq,
          })),
        ],
      };
    }
    case "evidence.added":
      return { ...c, seq: event.seq, evidence: [...c.evidence, { ...event.evidence }] };
    case "evidence.updated":
      return {
        ...c,
        seq: event.seq,
        evidence: c.evidence.map((item) => (item.id === event.id ? patchEvidence(item, event) : item)),
      };
    case "evidence.cites":
      return { ...c, seq: event.seq, cites: [...c.cites, { from: event.from, to: event.to }] };
    case "stance.added":
      return { ...c, seq: event.seq, stances: [...c.stances, { ...event.stance }] };
    case "verdict.updated":
      return {
        ...c,
        seq: event.seq,
        verdicts: [...c.verdicts.filter((item) => item.claimId !== event.verdict.claimId), { ...event.verdict }],
      };
    case "overall.updated":
      return { ...c, seq: event.seq, overall: { ...event.overall, breakdown: event.overall.breakdown.map((row) => ({ ...row })) } };
    case "frontier.added":
      return { ...c, seq: event.seq, frontier: [...c.frontier, ...event.pivots.map((pivot) => ({ ...pivot }))] };
    case "frontier.consumed":
      return {
        ...c,
        seq: event.seq,
        frontier: c.frontier.filter((pivot) => pivot.id !== event.pivotId),
        consumedPivotIds: [...c.consumedPivotIds, event.pivotId],
      };
    case "investigator.step":
      return {
        ...c,
        seq: event.seq,
        investigatorSteps: [
          ...c.investigatorSteps,
          {
            n: event.n,
            role: event.role,
            goal: event.goal,
            gap: event.gap,
            action: { ...event.action },
            why: event.why,
            result: event.result,
            gain: event.gain,
            seq: event.seq,
            at: event.at,
          },
        ],
      };
    case "investigator.stopped":
      return {
        ...c,
        seq: event.seq,
        investigatorStops: [
          ...c.investigatorStops,
          { role: event.role, reason: event.reason, seq: event.seq, at: event.at },
        ],
      };
    case "llm.called":
      return {
        ...c,
        seq: event.seq,
        llmCalls: [
          ...c.llmCalls,
          {
            job: event.job,
            model: event.model,
            latencyMs: event.latencyMs,
            ok: event.ok,
            seq: event.seq,
            at: event.at,
          },
        ],
      };
    case "report.finalized":
      return {
        ...c,
        seq: event.seq,
        report: {
          ...event.report,
          claimItems: event.report.claimItems.map((item) => ({ ...item, citations: [...item.citations] })),
          citations: event.report.citations.map((item) => ({ ...item })),
        },
      };
    case "error":
      return {
        ...c,
        seq: event.seq,
        errors: [
          ...c.errors,
          {
            message: event.message,
            seq: event.seq,
            at: event.at,
            ...(event.stage !== undefined ? { stage: event.stage } : {}),
          },
        ],
      };
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function replay(events: readonly CaseEvent[]): Case {
  return events.reduce(reduce, emptyCase());
}

export function createCase(input: CaseInput): { case: Case; events: CaseEvent[] } {
  const events: CaseEvent[] = [
    {
      type: "case.created",
      seq: 1,
      at: input.at ?? new Date().toISOString(),
      id: input.id,
      text: input.text,
    },
  ];
  return { case: replay(events), events };
}
