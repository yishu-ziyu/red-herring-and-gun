import { Type, type Static } from "typebox";

const closed = { additionalProperties: false } as const;

export const AssessStanceSchema = Type.Object(
  {
    evidenceId: Type.String(),
    stance: Type.Union([
      Type.Literal("supports"),
      Type.Literal("refutes"),
      Type.Literal("partial"),
      Type.Literal("contextual"),
    ]),
    quote: Type.String(),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  closed,
);

export const AssessOutputSchema = Type.Object(
  {
    stances: Type.Array(AssessStanceSchema),
  },
  closed,
);

export type AssessStance = Static<typeof AssessStanceSchema>;
export type AssessOutput = Static<typeof AssessOutputSchema>;
