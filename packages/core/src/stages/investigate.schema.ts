import { Type, type Static } from "typebox";

const closed = { additionalProperties: false } as const;

export const InvestigateActionKindSchema = Type.Union([
  Type.Literal("search"),
  Type.Literal("fetch"),
  Type.Literal("reverse_image"),
  Type.Literal("recall"),
  Type.Literal("stop"),
]);

export const InvestigateActionSchema = Type.Object(
  {
    kind: InvestigateActionKindSchema,
    target: Type.String(),
    why: Type.String(),
  },
  closed,
);

export const InvestigateOutputSchema = Type.Object(
  {
    action: InvestigateActionSchema,
  },
  closed,
);

export const CitesPrimaryLinkSchema = Type.Object(
  {
    url: Type.String(),
    why: Type.String(),
  },
  closed,
);

export const CitesOutputSchema = Type.Object(
  {
    primaryLinks: Type.Array(CitesPrimaryLinkSchema),
    citesEvidenceIds: Type.Array(Type.String()),
  },
  closed,
);

export type InvestigateActionKind = Static<typeof InvestigateActionKindSchema>;
export type InvestigateAction = Static<typeof InvestigateActionSchema>;
export type InvestigateOutput = Static<typeof InvestigateOutputSchema>;
export type CitesPrimaryLink = Static<typeof CitesPrimaryLinkSchema>;
export type CitesOutput = Static<typeof CitesOutputSchema>;
