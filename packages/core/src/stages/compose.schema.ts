import { Type, type Static } from "typebox";

const closed = { additionalProperties: false } as const;

export const ComposeClaimItemSchema = Type.Object(
  {
    claimId: Type.String(),
    line: Type.String(),
  },
  closed,
);

export const ComposeOutputSchema = Type.Object(
  {
    conclusion: Type.String(),
    claimItems: Type.Array(ComposeClaimItemSchema),
  },
  closed,
);

export type ComposeClaimItem = Static<typeof ComposeClaimItemSchema>;
export type ComposeDraft = Static<typeof ComposeOutputSchema>;
