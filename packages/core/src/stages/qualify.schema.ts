import { Type, type Static } from "typebox";

export type TextSpan = { start: number; end: number };

export const QualifyStopReasonSchema = Type.Union([
  Type.Literal("missing_object"),
  Type.Literal("missing_context"),
  Type.Literal("no_claim"),
  Type.Literal("stance_only"),
]);
export type QualifyStopReasonModel = Static<typeof QualifyStopReasonSchema>;

/** 固定字段，全部始终出现。stop 时主体/说法/先行词为空字符串。 */
export const QualifyOutputSchema = Type.Object(
  {
    ready: Type.Boolean(),
    reason: Type.String(),
    subjectText: Type.String(),
    claimText: Type.String(),
    gap: Type.String(),
    antecedentText: Type.String(),
  },
  { additionalProperties: true },
);
export type QualifyOutput = Static<typeof QualifyOutputSchema>;
export type QualifyReason = "ready" | QualifyStopReasonModel;

export const QualifyReviewSchema = Type.Object(
  {
    subjectLanded: Type.Boolean(),
  },
  { additionalProperties: true },
);
export type QualifyReview = Static<typeof QualifyReviewSchema>;
