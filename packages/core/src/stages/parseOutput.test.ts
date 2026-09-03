import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { parseJobOutput } from "./parseOutput.js";

const SampleSchema = Type.Object(
  {
    stances: Type.Array(
      Type.Object(
        {
          evidenceId: Type.String(),
          confidence: Type.Number(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

describe("parseJobOutput", () => {
  it("多余键被清", () => {
    const parsed = parseJobOutput(SampleSchema, {
      stances: [{ evidenceId: "e1", confidence: 0.9, extra: true }],
      foo: 1,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({ stances: [{ evidenceId: "e1", confidence: 0.9 }] });
  });

  it("字符串数字被转", () => {
    const parsed = parseJobOutput(SampleSchema, {
      stances: [{ evidenceId: "e1", confidence: "0.9" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.stances[0]?.confidence).toBe(0.9);
  });

  it("缺必填键返回 reason 含 path", () => {
    const parsed = parseJobOutput(SampleSchema, {
      stances: [{ evidenceId: "e1" }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/confidence|stances/);
    expect(parsed.reason).toContain("e1");
  });
});
