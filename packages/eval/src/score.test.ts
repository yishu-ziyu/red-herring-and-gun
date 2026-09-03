import { describe, expect, it } from "vitest";
import type { Case, CaseEvent, Claim, ClaimVerdict, Evidence, Overall, Report, Stance } from "@rhg/core";
import type { ScoreCaseGolden } from "./golden.js";
import {
  credibilityAccuracy,
  groundingRate,
  hallucinationRate,
  judgeRanOf,
  latencyP50,
  latencyP95,
  provenanceDepth,
  quoteFidelity,
  reportContractPassRate,
  routingAccuracy,
  summarize,
  summarizeRun,
  verdictAccuracy,
  type ScoreInput,
} from "./score.js";

const AT = "2026-01-01T00:00:00.000Z";

function golden(over: Partial<ScoreCaseGolden> = {}): ScoreCaseGolden {
  return {
    id: "T",
    claim: "x",
    category: "event",
    difficulty: "easy",
    domain: "social",
    expectedVerdictType: "false",
    expectedCredibilityRange: [0, 20],
    traps: ["t"],
    ...over,
  };
}

function claim(over: Partial<Claim> = {}): Claim {
  return { id: "c1", text: "x", type: "fact", checkable: true, order: 0, ...over };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  const id = over.id ?? "e1";
  return {
    id,
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    host: "example.com",
    excerpt: "official notice says no",
    retrievedAt: AT,
    tier: "C",
    provenance: { kind: "user" },
    ...over,
  };
}

function stance(over: Partial<Stance> = {}): Stance {
  return {
    id: "s1",
    claimId: "c1",
    evidenceId: "e1",
    stance: "refutes",
    quote: "official notice says no",
    confidence: 1,
    quoteFidelity: true,
    by: "main",
    ...over,
  };
}

function verdict(over: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claimId: "c1",
    verdict: "false",
    basis: ["s1"],
    rule: "A_REFUTES",
    tally: { sup: 0, ref: 3, par: 0 },
    updatedAt: AT,
    ...over,
  };
}

function overall(over: Partial<Overall> = {}): Overall {
  return {
    verdictType: "false",
    contested: false,
    score: 10,
    breakdown: [],
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    conclusion: "公开材料不支持这条说法。[1]",
    claimItems: [{ claimId: "c1", line: "与依据相反。[1]", citations: [1] }],
    citations: [{ n: 1, evidenceId: "e1" }],
    finalizedAt: AT,
    ...over,
  };
}

function emptyCase(over: Partial<Case> = {}): Case {
  return {
    id: "case",
    text: "x",
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

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    case: emptyCase(),
    events: [],
    report: null,
    elapsedMs: 100,
    ...over,
  };
}

function stepEvent(): CaseEvent {
  return {
    type: "investigator.step",
    seq: 1,
    at: AT,
    n: 1,
    role: "main",
    goal: "g",
    gap: "gap",
    action: { kind: "search", target: "q" },
    why: "why",
    result: "r",
    gain: 1,
  };
}

describe("verdictAccuracy", () => {
  it("returns 1 when verdictType matches and not contested", () => {
    expect(
      verdictAccuracy(
        golden(),
        input({ case: emptyCase({ overall: overall({ verdictType: "false", contested: false }) }) }),
      ),
    ).toBe(1);
  });

  it("returns 0 when verdictType mismatches", () => {
    expect(
      verdictAccuracy(
        golden({ expectedVerdictType: "false" }),
        input({ case: emptyCase({ overall: overall({ verdictType: "true", contested: false }) }) }),
      ),
    ).toBe(0);
  });

  it("returns 0 when contested is true even if verdictType matches", () => {
    expect(
      verdictAccuracy(
        golden({ expectedVerdictType: "false" }),
        input({ case: emptyCase({ overall: overall({ verdictType: "false", contested: true }) }) }),
      ),
    ).toBe(0);
  });
});

describe("credibilityAccuracy", () => {
  it("returns 1 when score is inside the closed range", () => {
    expect(
      credibilityAccuracy(golden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 0 }) }) })),
    ).toBe(1);
    expect(
      credibilityAccuracy(golden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 20 }) }) })),
    ).toBe(1);
  });

  it("returns 0 when score is outside the closed range", () => {
    expect(
      credibilityAccuracy(golden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 21 }) }) })),
    ).toBe(0);
  });
});

describe("hallucinationRate", () => {
  it("returns 0 when citations and URLs resolve inside the case", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(hallucinationRate(golden(), input({ case: c, report: report() }))).toBe(0);
  });

  it("returns 1 when a [n] marker is missing from citations", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(
      hallucinationRate(
        golden(),
        input({
          case: c,
          report: report({ conclusion: "见 [2]", claimItems: [{ claimId: "c1", line: "x", citations: [1] }] }),
        }),
      ),
    ).toBe(1);
  });

  it("returns 1 when a citation evidenceId is not in the case", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(
      hallucinationRate(
        golden(),
        input({ case: c, report: report({ citations: [{ n: 1, evidenceId: "e99" }] }) }),
      ),
    ).toBe(1);
  });

  it("returns 1 when the report text has a URL outside case evidence", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(
      hallucinationRate(
        golden(),
        input({
          case: c,
          report: report({ conclusion: "见 https://evil.example/x [1]" }),
        }),
      ),
    ).toBe(1);
  });
});

describe("reportContractPassRate", () => {
  it("returns 1 when conclusion, one line per checkable claim, citations, and scrub hold", () => {
    const c = emptyCase({ claims: [claim()] });
    expect(reportContractPassRate(golden(), input({ case: c, report: report({ conclusion: "公开材料不支持这条说法。" }) }))).toBe(1);
  });

  it("returns 0 when jargon leaks through conclusion", () => {
    const c = emptyCase({ claims: [claim()] });
    expect(
      reportContractPassRate(golden(), input({ case: c, report: report({ conclusion: "web_search 查过了。" }) })),
    ).toBe(0);
  });

  it("unverified 命题行无引用不扣分", () => {
    const c = emptyCase({
      claims: [claim()],
      verdicts: [verdict({ verdict: "unverified", rule: "no-evidence" })],
    });
    const r = report({ claimItems: [{ claimId: "c1", line: "没找到可以直接证实的依据。", citations: [] }] });
    expect(reportContractPassRate(golden(), input({ case: c, report: r }))).toBe(1);
  });

  it("立场型命题行无引用不扣分", () => {
    const c = emptyCase({ claims: [claim({ checkable: false, type: "value" })] });
    const r = report({ claimItems: [{ claimId: "c1", line: "这是评价或立场，不做真假判断。", citations: [] }] });
    expect(reportContractPassRate(golden(), input({ case: c, report: r }))).toBe(1);
  });

  it("下了判断的命题行无引用仍不通过", () => {
    const c = emptyCase({ claims: [claim()], verdicts: [verdict()] });
    const r = report({ claimItems: [{ claimId: "c1", line: "与依据相反。", citations: [] }] });
    expect(reportContractPassRate(golden(), input({ case: c, report: r }))).toBe(0);
  });
});

describe("routingAccuracy", () => {
  it("returns 1 when expectsEvidenceLoop and an investigator.step exists", () => {
    expect(routingAccuracy(golden({ expectsEvidenceLoop: true }), input({ events: [stepEvent()] }))).toBe(1);
  });

  it("returns 0 when expectsEvidenceLoop but no investigator.step", () => {
    expect(routingAccuracy(golden({ expectsEvidenceLoop: true }), input({ events: [] }))).toBe(0);
  });

  it("returns null when expectsEvidenceLoop is not declared", () => {
    expect(routingAccuracy(golden(), input({ events: [stepEvent()] }))).toBeNull();
  });
});

describe("groundingRate", () => {
  it("returns 1 when every checkable claim is verified with tally weight", () => {
    expect(
      groundingRate(
        golden(),
        input({
          case: emptyCase({
            claims: [claim()],
            verdicts: [verdict({ verdict: "false", tally: { sup: 0, ref: 3, par: 0 } })],
          }),
        }),
      ),
    ).toBe(1);
  });

  it("returns 0 when checkable claims stay unverified or have no tally", () => {
    expect(
      groundingRate(
        golden(),
        input({
          case: emptyCase({
            claims: [claim()],
            verdicts: [verdict({ verdict: "unverified", tally: { sup: 0, ref: 0, par: 0 } })],
          }),
        }),
      ),
    ).toBe(0);
  });
});

describe("quoteFidelity", () => {
  it("returns 1 when the folded quote is a substring of text or excerpt", () => {
    expect(
      quoteFidelity(
        golden(),
        input({
          case: emptyCase({
            evidence: [evidence({ text: "The Official Notice Says No today." })],
            stances: [stance({ quote: "official  notice\nSAYS no" })],
          }),
        }),
      ),
    ).toBe(1);
  });

  it("returns 0 when the quote is not in text or excerpt", () => {
    expect(
      quoteFidelity(
        golden(),
        input({
          case: emptyCase({
            evidence: [evidence({ excerpt: "unrelated", text: "also unrelated" })],
            stances: [stance({ quote: "official notice says no" })],
          }),
        }),
      ),
    ).toBe(0);
  });

  it("returns null when no stance carries a quote", () => {
    expect(
      quoteFidelity(
        golden(),
        input({
          case: emptyCase({
            evidence: [evidence()],
            stances: [stance({ quote: "   " })],
          }),
        }),
      ),
    ).toBeNull();
  });
});

describe("provenanceDepth", () => {
  it("returns 1 when every cited evidence is tier A", () => {
    expect(
      provenanceDepth(
        golden(),
        input({
          case: emptyCase({ evidence: [evidence({ tier: "A" })] }),
          report: report(),
        }),
      ),
    ).toBe(1);
  });

  it("returns 0 when cited evidence has no A-tier", () => {
    expect(
      provenanceDepth(
        golden(),
        input({
          case: emptyCase({ evidence: [evidence({ tier: "C" })] }),
          report: report(),
        }),
      ),
    ).toBe(0);
  });
});

describe("latencyP50 / latencyP95", () => {
  it("per-case functions return null; summarize P50 is the best (lowest) mid value", () => {
    const g = golden();
    const r = input({ elapsedMs: 10 });
    expect(latencyP50(g, r)).toBeNull();
    expect(latencyP95(g, r)).toBeNull();
    const summary = summarize([
      { metrics: { ...blankMetrics(), latencyP50: null, latencyP95: null }, elapsedMs: 10 },
      { metrics: { ...blankMetrics() }, elapsedMs: 20 },
      { metrics: { ...blankMetrics() }, elapsedMs: 30 },
    ]);
    expect(summary.latencyP50).toBe(20);
  });

  it("summarize P95 returns the high tail (worst latency)", () => {
    const summary = summarize([
      { metrics: blankMetrics(), elapsedMs: 1000 },
      { metrics: blankMetrics(), elapsedMs: 1000 },
    ]);
    expect(summary.latencyP95).toBe(1000);
  });
});

describe("summarizeRun", () => {
  it("counts turnReasons, judgeRan, llmByJob, errorsByStage", () => {
    const events: CaseEvent[] = [
      {
        type: "stage.finished",
        seq: 1,
        at: AT,
        stage: "judge",
        outcome: "ok",
      },
      {
        type: "llm.called",
        seq: 2,
        at: AT,
        job: "assess",
        model: "fake",
        latencyMs: 10,
        ok: true,
      },
      {
        type: "llm.called",
        seq: 3,
        at: AT,
        job: "assess",
        model: "fake",
        latencyMs: 30,
        ok: false,
      },
      { type: "error", seq: 4, at: AT, stage: "compose", message: "x" },
    ];
    expect(judgeRanOf(events)).toBe(true);
    const summary = summarizeRun(
      [
        { metrics: blankMetrics(), elapsedMs: 100, turnReason: "done", judgeRan: true },
        { metrics: blankMetrics(), elapsedMs: 200, turnReason: "timeout", judgeRan: false },
      ],
      [events, []],
    );
    expect(summary.turnReasons).toEqual({ done: 1, timeout: 1, aborted: 0, error: 0 });
    expect(summary.judgeRan).toEqual({ ok: 1, total: 2 });
    expect(summary.llmByJob.assess).toEqual({ calls: 2, failed: 1, p50Ms: 10 });
    expect(summary.errorsByStage).toEqual({ compose: 1 });
  });
});

function blankMetrics() {
  return {
    verdictAccuracy: null,
    credibilityAccuracy: null,
    hallucinationRate: null,
    reportContractPassRate: null,
    routingAccuracy: null,
    groundingRate: null,
    quoteFidelity: null,
    provenanceDepth: null,
    latencyP50: null,
    latencyP95: null,
  };
}
