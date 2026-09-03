import type { Case, Claim, ClaimVerdict } from '@rhg/core/casefile';
import { faceWord } from '@rhg/core/publicCopy';
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { STANCE_TYPE } from "../lib/copy.js";
import { ClaimList } from "./ClaimList.js";

const AT = "2026-09-03T12:00:00.000Z";

function claim(id: string, checkable: boolean, text: string): Claim {
  return { id, text, type: checkable ? "fact" : "value", checkable, order: 0 };
}

function verdict(claimId: string, value: ClaimVerdict["verdict"], tally = { sup: 2, ref: 1, par: 0 }): ClaimVerdict {
  return { claimId, verdict: value, basis: ["s1"], rule: "test", tally, updatedAt: AT };
}

function blank(over: Partial<Case>): Case {
  return {
    id: "c",
    text: "原句",
    createdAt: AT,
    seq: 1,
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
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("ClaimList", () => {
  it("四种判决芯片文案来自 face 词表且带对应色类", () => {
    const current = blank({
      claims: [
        claim("c1", true, "一"),
        claim("c2", true, "二"),
        claim("c3", true, "三"),
        claim("c4", true, "四"),
      ],
      verdicts: [
        verdict("c1", "true"),
        verdict("c2", "false"),
        verdict("c3", "partial"),
        verdict("c4", "unverified"),
      ],
    });
    const { container } = render(<ClaimList current={current} onFocus={() => undefined} />);
    const chips = [...container.querySelectorAll(".chip")];
    expect(chips[0]?.textContent).toBe(faceWord("true"));
    expect(chips[0]?.className).toContain("true");
    expect(chips[1]?.textContent).toBe(faceWord("false"));
    expect(chips[1]?.className).toContain("false");
    expect(chips[2]?.textContent).toBe(faceWord("partial"));
    expect(chips[2]?.className).toContain("unclear");
    expect(chips[3]?.textContent).toBe(faceWord("unverified"));
    expect(chips[3]?.className).toContain("unclear");
  });

  it("立场型命题文案含立场型且用中性类", () => {
    const current = blank({
      claims: [claim("c9", false, "这届专家")],
    });
    const { container } = render(<ClaimList current={current} onFocus={() => undefined} />);
    const chip = container.querySelector(".chip");
    expect(chip?.textContent).toContain("立场型");
    expect(chip?.textContent).toBe(STANCE_TYPE);
    expect(chip?.className).toContain("muted");
  });

  it("tally 渲染为规定格式", () => {
    const current = blank({
      claims: [claim("c1", true, "一")],
      verdicts: [verdict("c1", "true", { sup: 3, ref: 1, par: 2 })],
    });
    render(<ClaimList current={current} onFocus={() => undefined} />);
    expect(document.querySelector(".tally")?.textContent).toBe("＋3 －1 ±2");
  });
});
