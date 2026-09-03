import { Type, type Static } from "typebox";
import { ClaimAtomTypeSchema } from "../casefile/schema.js";

const closed = { additionalProperties: false } as const;

export const DecomposeOutputSchema = Type.Object(
  {
    claims: Type.Array(
      Type.Object(
        {
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
        },
        closed,
      ),
    ),
  },
  closed,
);

export type DecomposeOutput = Static<typeof DecomposeOutputSchema>;
