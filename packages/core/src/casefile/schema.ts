import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const closed = { additionalProperties: false } as const;

function event<T extends string, P extends { readonly [key: string]: TSchema }>(type: T, props: P) {
  return Type.Object(
    {
      type: Type.Literal(type),
      seq: Type.Integer({ minimum: 1 }),
      at: Type.String(),
      turnId: Type.Optional(Type.String()),
      ...props,
    },
    closed,
  );
}

function errorLines(schema: TSchema, input: unknown): string {
  return (
    Value.Errors(schema, input)
      .map((err) => `${err.instancePath || "/"}: ${err.message}`)
      .join("\n") || "invalid"
  );
}

export const CaseInputSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    at: Type.Optional(Type.String()),
  },
  closed,
);
export type CaseInput = Static<typeof CaseInputSchema>;

export const TierSchema = Type.Union([
  Type.Literal("A"),
  Type.Literal("B"),
  Type.Literal("C"),
  Type.Literal("unknown"),
]);
export type Tier = Static<typeof TierSchema>;

export const ProvenanceSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("search"),
      query: Type.String(),
      provider: Type.Optional(Type.String()),
      claimId: Type.Optional(Type.String()),
    },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("pivot"),
      fromEvidenceId: Type.String(),
      pivotId: Type.String(),
    },
    closed,
  ),
  Type.Object({ kind: Type.Literal("user") }, closed),
  Type.Object(
    {
      kind: Type.Literal("memory"),
      recallId: Type.Optional(Type.String()),
    },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("reverse-image"),
      imageUrl: Type.String(),
    },
    closed,
  ),
]);
export type Provenance = Static<typeof ProvenanceSchema>;

export const EvidenceSchema = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    canonicalUrl: Type.String(),
    host: Type.String(),
    title: Type.Optional(Type.String()),
    excerpt: Type.String({ maxLength: 320 }),
    text: Type.Optional(Type.String()),
    publishedAt: Type.Optional(Type.String()),
    retrievedAt: Type.String(),
    tier: TierSchema,
    clusterId: Type.Optional(Type.String()),
    reachable: Type.Optional(Type.Boolean()),
    provenance: ProvenanceSchema,
  },
  closed,
);
export type Evidence = Static<typeof EvidenceSchema>;

export const PivotSchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.Union([
      Type.Literal("link"),
      Type.Literal("doc_number"),
      Type.Literal("date"),
      Type.Literal("image"),
      Type.Literal("entity"),
      Type.Literal("query"),
    ]),
    value: Type.String(),
    why: Type.String(),
    expectedValue: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
    fromEvidenceId: Type.Optional(Type.String()),
    depth: Type.Integer({ minimum: 0 }),
  },
  closed,
);
export type Pivot = Static<typeof PivotSchema>;

export const ClaimAtomTypeSchema = Type.Union([
  Type.Literal("fact"),
  Type.Literal("causal"),
  Type.Literal("comparison"),
  Type.Literal("concept"),
  Type.Literal("value"),
  Type.Literal("prediction"),
  Type.Literal("normative"),
  Type.Literal("personal"),
]);
export type ClaimAtomType = Static<typeof ClaimAtomTypeSchema>;

export const ClaimSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    type: ClaimAtomTypeSchema,
    checkable: Type.Boolean(),
    span: Type.Optional(
      Type.Object(
        {
          start: Type.Integer({ minimum: 0 }),
          end: Type.Integer({ minimum: 0 }),
        },
        closed,
      ),
    ),
    order: Type.Integer({ minimum: 0 }),
  },
  closed,
);
export type Claim = Static<typeof ClaimSchema>;

export const StanceSchema = Type.Object(
  {
    id: Type.String(),
    claimId: Type.String(),
    evidenceId: Type.String(),
    stance: Type.Union([
      Type.Literal("supports"),
      Type.Literal("refutes"),
      Type.Literal("partial"),
      Type.Literal("contextual"),
    ]),
    quote: Type.String(),
    confidence: Type.Number(),
    quoteFidelity: Type.Boolean(),
    by: Type.Union([Type.Literal("main"), Type.Literal("prosecutor"), Type.Literal("defender")]),
  },
  closed,
);
export type Stance = Static<typeof StanceSchema>;

export const ClaimVerdictSchema = Type.Object(
  {
    claimId: Type.String(),
    verdict: Type.Union([
      Type.Literal("true"),
      Type.Literal("false"),
      Type.Literal("partial"),
      Type.Literal("unverified"),
      Type.Literal("contested"),
    ]),
    basis: Type.Array(Type.String()),
    rule: Type.String(),
    /** 各方向的簇权重和，judge 的中间量；界面解释「为什么」时不用重跑规则。 */
    tally: Type.Optional(
      Type.Object(
        {
          sup: Type.Number(),
          ref: Type.Number(),
          par: Type.Number(),
        },
        closed,
      ),
    ),
    updatedAt: Type.String(),
  },
  closed,
);
export type ClaimVerdict = Static<typeof ClaimVerdictSchema>;

export const OverallSchema = Type.Object(
  {
    verdictType: Type.Union([
      Type.Literal("true"),
      Type.Literal("false"),
      Type.Literal("mixed_misleading"),
      Type.Literal("unverified"),
    ]),
    contested: Type.Boolean(),
    score: Type.Number(),
    breakdown: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          label: Type.String(),
          value: Type.Number(),
        },
        closed,
      ),
    ),
  },
  closed,
);
export type Overall = Static<typeof OverallSchema>;

export const ReportSchema = Type.Object(
  {
    conclusion: Type.String(),
    claimItems: Type.Array(
      Type.Object(
        {
          claimId: Type.String(),
          line: Type.String(),
          citations: Type.Array(Type.Integer()),
        },
        closed,
      ),
    ),
    citations: Type.Array(
      Type.Object(
        {
          n: Type.Integer(),
          evidenceId: Type.String(),
        },
        closed,
      ),
    ),
    finalizedAt: Type.String(),
  },
  closed,
);
export type Report = Static<typeof ReportSchema>;

export const MessageSchema = Type.Object(
  {
    id: Type.String(),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    text: Type.String(),
    at: Type.String(),
    route: Type.Optional(
      Type.Union([
        Type.Literal("new_claim"),
        Type.Literal("pursue_frontier"),
        Type.Literal("ask_case"),
        Type.Literal("challenge"),
        Type.Literal("off_topic"),
      ]),
    ),
    attachments: Type.Optional(
      Type.Array(
        Type.Object(
          {
            kind: Type.Union([Type.Literal("url"), Type.Literal("image")]),
            value: Type.String(),
          },
          closed,
        ),
      ),
    ),
  },
  closed,
);
export type Message = Static<typeof MessageSchema>;

export const StageOutcomeSchema = Type.Union([
  Type.Literal("ok"),
  Type.Literal("failed-open"),
  Type.Literal("skipped"),
]);

export const TurnReasonSchema = Type.Union([
  Type.Literal("done"),
  Type.Literal("timeout"),
  Type.Literal("aborted"),
  Type.Literal("error"),
]);

export const InvestigatorRoleSchema = Type.Union([
  Type.Literal("main"),
  Type.Literal("prosecutor"),
  Type.Literal("defender"),
]);

export const InvestigatorStopReasonSchema = Type.Union([
  Type.Literal("budget"),
  Type.Literal("no-gain"),
  Type.Literal("resolved"),
  Type.Literal("time"),
  Type.Literal("tool-failed"),
]);

const investigatorStepFields = {
  n: Type.Integer({ minimum: 1 }),
  role: InvestigatorRoleSchema,
  goal: Type.String(),
  gap: Type.String(),
  action: Type.Object(
    {
      kind: Type.Union([
        Type.Literal("search"),
        Type.Literal("fetch"),
        Type.Literal("reverse_image"),
        Type.Literal("recall"),
        Type.Literal("stop"),
      ]),
      target: Type.String(),
    },
    closed,
  ),
  why: Type.String(),
  result: Type.String(),
  gain: Type.Number(),
};

export const InvestigatorStepRecordSchema = Type.Object(
  {
    ...investigatorStepFields,
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
  },
  closed,
);

export const LlmCallRecordSchema = Type.Object(
  {
    job: Type.String(),
    model: Type.String(),
    latencyMs: Type.Number(),
    ok: Type.Boolean(),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
  },
  closed,
);

export const StageRecordSchema = Type.Object(
  {
    stage: Type.String(),
    claimId: Type.Optional(Type.String()),
    startedAt: Type.String(),
    finishedAt: Type.Optional(Type.String()),
    outcome: Type.Optional(StageOutcomeSchema),
    seq: Type.Integer({ minimum: 1 }),
  },
  closed,
);

export const ErrorRecordSchema = Type.Object(
  {
    message: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
    stage: Type.Optional(Type.String()),
  },
  closed,
);

export const TurnRecordSchema = Type.Object(
  {
    id: Type.String(),
    startedAt: Type.String(),
    finishedAt: Type.Optional(Type.String()),
    reason: Type.Optional(TurnReasonSchema),
  },
  closed,
);

export const InvestigatorStopRecordSchema = Type.Object(
  {
    role: InvestigatorRoleSchema,
    reason: InvestigatorStopReasonSchema,
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
  },
  closed,
);

export const DroppedClaimRecordSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    reason: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
  },
  closed,
);

export const CiteSchema = Type.Object(
  {
    from: Type.String(),
    to: Type.String(),
  },
  closed,
);

export const CaseSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    createdAt: Type.String(),
    seq: Type.Integer({ minimum: 0 }),
    claims: Type.Array(ClaimSchema),
    evidence: Type.Array(EvidenceSchema),
    stances: Type.Array(StanceSchema),
    verdicts: Type.Array(ClaimVerdictSchema),
    cites: Type.Array(CiteSchema),
    frontier: Type.Array(PivotSchema),
    consumedPivotIds: Type.Array(Type.String()),
    investigatorSteps: Type.Array(InvestigatorStepRecordSchema),
    investigatorStops: Type.Array(InvestigatorStopRecordSchema),
    llmCalls: Type.Array(LlmCallRecordSchema),
    stages: Type.Array(StageRecordSchema),
    turns: Type.Array(TurnRecordSchema),
    messages: Type.Array(MessageSchema),
    errors: Type.Array(ErrorRecordSchema),
    droppedClaims: Type.Array(DroppedClaimRecordSchema),
    overall: Type.Optional(OverallSchema),
    report: Type.Optional(ReportSchema),
  },
  closed,
);
export type Case = Static<typeof CaseSchema>;

export const CaseCreatedSchema = event("case.created", {
  id: Type.String(),
  text: Type.String(),
});
export const MessageAddedSchema = event("message.added", {
  message: MessageSchema,
});
export const TurnStartedSchema = Type.Object(
  {
    type: Type.Literal("turn.started"),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
    turnId: Type.String(),
  },
  closed,
);
export const TurnFinishedSchema = Type.Object(
  {
    type: Type.Literal("turn.finished"),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
    turnId: Type.String(),
    reason: TurnReasonSchema,
  },
  closed,
);
export const StageStartedSchema = event("stage.started", {
  stage: Type.String(),
  claimId: Type.Optional(Type.String()),
});
export const StageFinishedSchema = event("stage.finished", {
  stage: Type.String(),
  claimId: Type.Optional(Type.String()),
  outcome: Type.Optional(StageOutcomeSchema),
});
export const ClaimsAddedSchema = event("claims.added", {
  claims: Type.Array(ClaimSchema),
});
export const ClaimsDroppedSchema = event("claims.dropped", {
  dropped: Type.Array(
    Type.Object(
      {
        id: Type.String(),
        text: Type.String(),
        reason: Type.String(),
      },
      closed,
    ),
  ),
});
export const EvidenceAddedSchema = event("evidence.added", {
  evidence: EvidenceSchema,
});
export const EvidenceUpdatedSchema = event("evidence.updated", {
  id: Type.String(),
  clusterId: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  reachable: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String()),
  excerpt: Type.Optional(Type.String()),
  tier: Type.Optional(TierSchema),
  publishedAt: Type.Optional(Type.String()),
  host: Type.Optional(Type.String()),
  canonicalUrl: Type.Optional(Type.String()),
});
export const EvidenceCitesSchema = event("evidence.cites", {
  from: Type.String(),
  to: Type.String(),
});
export const StanceAddedSchema = event("stance.added", {
  stance: StanceSchema,
});
export const VerdictUpdatedSchema = event("verdict.updated", {
  verdict: ClaimVerdictSchema,
});
export const OverallUpdatedSchema = event("overall.updated", {
  overall: OverallSchema,
});
export const FrontierAddedSchema = event("frontier.added", {
  pivots: Type.Array(PivotSchema),
});
export const FrontierConsumedSchema = event("frontier.consumed", {
  pivotId: Type.String(),
});
export const InvestigatorStepSchema = event("investigator.step", investigatorStepFields);
export const InvestigatorStoppedSchema = event("investigator.stopped", {
  role: InvestigatorRoleSchema,
  reason: InvestigatorStopReasonSchema,
});
export const LlmCalledSchema = event("llm.called", {
  job: Type.String(),
  model: Type.String(),
  latencyMs: Type.Number(),
  ok: Type.Boolean(),
  /** ok=false 时的错误摘要（截断），供排障；不含密钥。 */
  error: Type.Optional(Type.String()),
  attempts: Type.Optional(
    Type.Array(
      Type.Object(
        {
          provider: Type.String(),
          model: Type.String(),
          ok: Type.Boolean(),
          latencyMs: Type.Number(),
          error: Type.Optional(Type.String()),
        },
        closed,
      ),
    ),
  ),
});
export const ReportFinalizedSchema = event("report.finalized", {
  report: ReportSchema,
});
export const ErrorEventSchema = event("error", {
  message: Type.String(),
  stage: Type.Optional(Type.String()),
});

export const CaseEventSchema = Type.Union([
  CaseCreatedSchema,
  MessageAddedSchema,
  TurnStartedSchema,
  TurnFinishedSchema,
  StageStartedSchema,
  StageFinishedSchema,
  ClaimsAddedSchema,
  ClaimsDroppedSchema,
  EvidenceAddedSchema,
  EvidenceUpdatedSchema,
  EvidenceCitesSchema,
  StanceAddedSchema,
  VerdictUpdatedSchema,
  OverallUpdatedSchema,
  FrontierAddedSchema,
  FrontierConsumedSchema,
  InvestigatorStepSchema,
  InvestigatorStoppedSchema,
  LlmCalledSchema,
  ReportFinalizedSchema,
  ErrorEventSchema,
]);
export type CaseEvent = Static<typeof CaseEventSchema>;

const EVENT_BY_TYPE = {
  "case.created": CaseCreatedSchema,
  "message.added": MessageAddedSchema,
  "turn.started": TurnStartedSchema,
  "turn.finished": TurnFinishedSchema,
  "stage.started": StageStartedSchema,
  "stage.finished": StageFinishedSchema,
  "claims.added": ClaimsAddedSchema,
  "claims.dropped": ClaimsDroppedSchema,
  "evidence.added": EvidenceAddedSchema,
  "evidence.updated": EvidenceUpdatedSchema,
  "evidence.cites": EvidenceCitesSchema,
  "stance.added": StanceAddedSchema,
  "verdict.updated": VerdictUpdatedSchema,
  "overall.updated": OverallUpdatedSchema,
  "frontier.added": FrontierAddedSchema,
  "frontier.consumed": FrontierConsumedSchema,
  "investigator.step": InvestigatorStepSchema,
  "investigator.stopped": InvestigatorStoppedSchema,
  "llm.called": LlmCalledSchema,
  "report.finalized": ReportFinalizedSchema,
  error: ErrorEventSchema,
} as const;

export function validateEvent(input: unknown): CaseEvent {
  const type =
    input !== null && typeof input === "object" && "type" in input && typeof input.type === "string"
      ? input.type
      : undefined;
  if (type === undefined) {
    throw new Error("/: missing event type");
  }
  if (type in EVENT_BY_TYPE) {
    const schema = EVENT_BY_TYPE[type as keyof typeof EVENT_BY_TYPE];
    if (Value.Check(schema, input)) return input as CaseEvent;
    throw new Error(errorLines(schema, input));
  }
  throw new Error(`/: unknown event type ${type}`);
}

export function validateCase(input: unknown): Case {
  if (Value.Check(CaseSchema, input)) return input;
  throw new Error(errorLines(CaseSchema, input));
}
