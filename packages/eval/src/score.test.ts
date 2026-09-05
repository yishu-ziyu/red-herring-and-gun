import { describe, expect, it } from "vitest";
import type { Case, CaseEvent, Claim, ClaimVerdict, Evidence, Overall, Report, Stance } from "@rhg/core";
import type { ScoreCaseGolden } from "./golden.js";
import {
  classifyAttemptKind,
  classifyCaseProgress,
  collectRunFaults,
  credibilityAccuracy,
  entryAccuracy,
  failureReasonOf,
  groundingRate,
  citationIntegrityErrorRate,
  judgeRanOf,
  latencyP50,
  latencyP95,
  provenanceDepth,
  qualificationOf,
  quoteFidelity,
  reportContractPassRate,
  routingAccuracy,
  scoreCase,
  scoreCaseWithOutcome,
  searchHealthOf,
  searchHealthReport,
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

function enterGolden(over: Partial<ScoreCaseGolden> = {}): ScoreCaseGolden {
  return golden({ expectsEnterCheck: true, ...over });
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

function qualifyOkEvent(): CaseEvent {
  return { type: "stage.finished", seq: 1, at: AT, stage: "qualify", outcome: "ok" };
}

function retrieveStartEvent(): CaseEvent {
  return { type: "stage.started", seq: 2, at: AT, stage: "retrieve" };
}

function llmFailEvent(job = "qualify"): CaseEvent {
  return {
    type: "llm.called",
    seq: 2,
    at: AT,
    job,
    model: "fake",
    latencyMs: 10,
    ok: false,
    error: "down",
  };
}

function llmOkAfterFallback(job: string, failedError: string): CaseEvent {
  return {
    type: "llm.called",
    seq: 3,
    at: AT,
    job,
    model: "fake",
    latencyMs: 20,
    ok: true,
    attempts: [
      { provider: "minimax", model: "M3", ok: false, latencyMs: 8, error: failedError },
      { provider: "stepfun", model: "flash", ok: true, latencyMs: 12 },
    ],
  };
}

function reportFinalizedEvent(): CaseEvent {
  return { type: "report.finalized", seq: 9, at: AT, report: report() };
}

describe("verdictAccuracy", () => {
  it("returns 1 when verdictType matches and not contested", () => {
    expect(
      verdictAccuracy(
        enterGolden(),
        input({ case: emptyCase({ overall: overall({ verdictType: "false", contested: false }) }) }),
      ),
    ).toBe(1);
  });

  it("returns 0 when verdictType mismatches", () => {
    expect(
      verdictAccuracy(
        enterGolden({ expectedVerdictType: "false" }),
        input({ case: emptyCase({ overall: overall({ verdictType: "true", contested: false }) }) }),
      ),
    ).toBe(0);
  });

  it("returns 0 when contested is true even if verdictType matches", () => {
    expect(
      verdictAccuracy(
        enterGolden({ expectedVerdictType: "false" }),
        input({ case: emptyCase({ overall: overall({ verdictType: "false", contested: true }) }) }),
      ),
    ).toBe(0);
  });

  it("returns 0 not null when the case should enter check but has no overall", () => {
    expect(verdictAccuracy(enterGolden(), input({ case: emptyCase() }))).toBe(0);
  });

  it("returns null when early stop is expected and there is no overall", () => {
    expect(verdictAccuracy(golden({ expectsEarlyStop: true }), input({ case: emptyCase() }))).toBeNull();
  });
});

describe("qualificationOf", () => {
  it("marks a case unlabeled when neither enter nor early-stop is declared", () => {
    expect(qualificationOf(golden())).toBe("unlabeled");
    expect(qualificationOf(enterGolden())).toBe("enter_check");
    expect(qualificationOf(golden({ expectsEarlyStop: true }))).toBe("early_stop");
  });

  it("does not default unlabeled to proceed: missing overall stays null and does not enter the denominator", () => {
    expect(verdictAccuracy(golden(), input({ case: emptyCase() }))).toBeNull();
    expect(citationIntegrityErrorRate(golden(), input({ report: null }))).toBeNull();
  });
});

describe("entryAccuracy", () => {
  it("is 1 when a should-enter case was checked", () => {
    expect(entryAccuracy(enterGolden(), "checked")).toBe(1);
  });

  it("is 0 when a should-enter case stopped early", () => {
    expect(entryAccuracy(enterGolden(), "early_stop")).toBe(0);
  });

  it("is 1 when a should-enter case entered but has no final judgment", () => {
    expect(entryAccuracy(enterGolden(), "entered_no_final")).toBe(1);
  });

  it("is 1 when a stop-expected case stopped early", () => {
    expect(entryAccuracy(golden({ expectsEarlyStop: true }), "early_stop")).toBe(1);
  });

  it("is null when qualification is unlabeled", () => {
    expect(entryAccuracy(golden(), "checked")).toBeNull();
  });
});

describe("classifyCaseProgress", () => {
  it("labels qualify-ok without retrieve as early_stop, and does not fold faults into progress", () => {
    expect(classifyCaseProgress([qualifyOkEvent()], "done")).toBe("early_stop");
    expect(classifyCaseProgress([qualifyOkEvent(), llmFailEvent()], "error")).toBe("early_stop");
    expect(classifyCaseProgress([retrieveStartEvent()], "timeout")).toBe("entered_no_final");
    expect(
      classifyCaseProgress(
        [retrieveStartEvent(), { type: "error", seq: 3, at: AT, stage: "retrieve", message: "search down" }],
        "error",
      ),
    ).toBe("entered_no_final");
  });

  it("keeps a finalized report as checked even if an earlier llm.called failed", () => {
    const events: CaseEvent[] = [
      retrieveStartEvent(),
      llmFailEvent("assess"),
      llmOkAfterFallback("compose", "内容审查"),
      reportFinalizedEvent(),
    ];
    expect(classifyCaseProgress(events, "done", { hasOverall: true, hasReport: true })).toBe("checked");
    const faults = collectRunFaults(events, "done");
    expect(faults.some((fault) => fault.kind === "model_failure")).toBe(true);
    expect(faults.some((fault) => fault.kind === "content_review")).toBe(true);
  });
});

describe("collectRunFaults", () => {
  it("keeps model_failure, search_failure, timeout, and aborted as coexisting faults", () => {
    const events: CaseEvent[] = [
      retrieveStartEvent(),
      llmFailEvent("assess"),
      { type: "error", seq: 3, at: AT, stage: "retrieve", message: "search down" },
    ];
    const kinds = new Set(collectRunFaults(events, "timeout").map((fault) => fault.kind));
    expect(kinds.has("model_failure")).toBe(true);
    expect(kinds.has("search_failure")).toBe(true);
    expect(kinds.has("timeout")).toBe(true);
    expect(collectRunFaults([], "aborted").some((fault) => fault.kind === "aborted")).toBe(true);
  });

  it("preserves 内容审查 and 无正文 from llm.called.attempts instead of collapsing them", () => {
    const event: CaseEvent = {
      type: "llm.called",
      seq: 1,
      at: AT,
      job: "assess",
      model: "fake",
      latencyMs: 30,
      ok: true,
      attempts: [
        { provider: "minimax", model: "M3", ok: false, latencyMs: 10, error: "触发内容审查" },
        { provider: "stepfun", model: "flash", ok: false, latencyMs: 10, error: "MiniMax API 没有返回可解析文本。" },
        { provider: "deepseek", model: "v4", ok: true, latencyMs: 10 },
      ],
    };
    expect(classifyAttemptKind("触发内容审查")).toBe("content_review");
    expect(classifyAttemptKind("MiniMax API 没有返回可解析文本。")).toBe("empty_body");
    const kinds = collectRunFaults([event], "done").map((fault) => fault.kind);
    expect(kinds).toContain("content_review");
    expect(kinds).toContain("empty_body");
    expect(kinds).not.toContain("timeout");
  });

  it("does not treat hedge-loser abort as model_failure when the llm.called already succeeded", () => {
    const qualify: CaseEvent = {
      type: "llm.called",
      seq: 1,
      at: AT,
      job: "qualify",
      model: "minimax:MiniMax-M3",
      latencyMs: 40,
      ok: true,
      attempts: [
        { provider: "minimax", model: "MiniMax-M3", ok: true, latencyMs: 38 },
        { provider: "stepfun", model: "step-3.7-flash", ok: false, latencyMs: 12, error: "This operation was aborted" },
      ],
    };
    const assess: CaseEvent = {
      type: "llm.called",
      seq: 2,
      at: AT,
      job: "assess",
      model: "minimax:MiniMax-M3",
      latencyMs: 50,
      ok: true,
      attempts: [
        { provider: "minimax", model: "MiniMax-M3", ok: true, latencyMs: 48 },
        { provider: "stepfun", model: "step-3.7-flash", ok: false, latencyMs: 9, error: "This operation was aborted" },
      ],
    };
    const faults = collectRunFaults([qualify, assess], "done");
    expect(qualify.ok).toBe(true);
    expect(assess.attempts?.some((row) => row.error === "This operation was aborted")).toBe(true);
    expect(faults).toEqual([]);
  });

  it("keeps abort as a fault when the whole llm.called failed or the turn aborted", () => {
    const failedCall: CaseEvent = {
      type: "llm.called",
      seq: 1,
      at: AT,
      job: "qualify",
      model: "",
      latencyMs: 20,
      ok: false,
      error: "aborted",
      attempts: [
        { provider: "minimax", model: "MiniMax-M3", ok: false, latencyMs: 10, error: "This operation was aborted" },
        { provider: "stepfun", model: "step-3.7-flash", ok: false, latencyMs: 10, error: "This operation was aborted" },
      ],
    };
    const failedKinds = collectRunFaults([failedCall], "done").map((fault) => fault.kind);
    expect(failedKinds.length).toBeGreaterThan(0);
    expect(failedKinds.every((kind) => kind === "aborted")).toBe(true);
    expect(failedKinds).not.toContain("model_failure");
    expect(collectRunFaults([failedCall], "aborted").some((fault) => fault.kind === "aborted")).toBe(true);
    expect(collectRunFaults([failedCall], "timeout").some((fault) => fault.kind === "timeout")).toBe(true);
  });
});

function searchStarted(
  over: Partial<{ seq: number; provider: string; query: string; claimId: string }> = {},
): CaseEvent {
  return {
    type: "search.source.started",
    seq: over.seq ?? 2,
    at: AT,
    provider: over.provider ?? "keep",
    query: over.query ?? "官方通报",
    claimId: over.claimId ?? "c1",
  };
}

function searchFinished(
  over: Partial<{
    seq: number;
    provider: string;
    outcome: "ok" | "failed" | "cancelled";
    hitCount: number;
    errorCategory: string;
  }> = {},
): CaseEvent {
  return {
    type: "search.source.finished",
    seq: over.seq ?? 3,
    at: AT,
    provider: over.provider ?? "keep",
    query: "官方通报",
    claimId: "c1",
    outcome: over.outcome ?? "ok",
    hitCount: over.hitCount ?? 1,
    latencyMs: 5,
    ...(over.errorCategory !== undefined ? { errorCategory: over.errorCategory } : {}),
  };
}

describe("searchHealthOf", () => {
  it("outputs unknown when events cannot show search-source health, and does not infer ok from evidence", () => {
    expect(searchHealthOf([qualifyOkEvent(), retrieveStartEvent()])).toBe("unknown");
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        {
          type: "evidence.added",
          seq: 3,
          at: AT,
          evidence: evidence(),
        },
      ]),
    ).toBe("unknown");
  });

  it("is healthy when every observed source succeeded", () => {
    expect(searchHealthOf([retrieveStartEvent(), searchFinished({ outcome: "ok", hitCount: 1 })])).toBe("healthy");
  });

  it("is empty when every source completed ok with zero hits, not unknown or failed", () => {
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        searchStarted(),
        searchFinished({ outcome: "ok", hitCount: 0 }),
      ]),
    ).toBe("empty");
  });

  it("is degraded when an ok source with zero hits sits beside a failed source", () => {
    const report = searchHealthReport([
      retrieveStartEvent(),
      searchStarted({ provider: "keep" }),
      searchStarted({ seq: 3, provider: "boom" }),
      searchFinished({ seq: 4, provider: "keep", outcome: "ok", hitCount: 0 }),
      searchFinished({ seq: 5, provider: "boom", outcome: "failed", hitCount: 0, errorCategory: "unknown" }),
    ]);
    expect(report.health).toBe("degraded");
    expect(report.failedSources).toEqual(["boom"]);
  });

  it("is degraded when some sources fail and some succeed, and keeps the failed source", () => {
    const report = searchHealthReport([
      retrieveStartEvent(),
      searchFinished({ provider: "boom", outcome: "failed", hitCount: 0, errorCategory: "unknown" }),
      searchFinished({ seq: 4, provider: "keep", outcome: "ok", hitCount: 2 }),
    ]);
    expect(report.health).toBe("degraded");
    expect(report.failedSources).toEqual(["boom"]);
  });

  it("is failed when every source is cancelled", () => {
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        searchStarted({ provider: "keep" }),
        searchStarted({ seq: 3, provider: "boom" }),
        searchFinished({ seq: 4, provider: "keep", outcome: "cancelled", hitCount: 0, errorCategory: "aborted" }),
        searchFinished({ seq: 5, provider: "boom", outcome: "cancelled", hitCount: 0, errorCategory: "aborted" }),
      ]),
    ).toBe("failed");
  });

  it("is failed when terminals are failed plus cancelled and none completed ok", () => {
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        searchStarted({ provider: "keep" }),
        searchStarted({ seq: 3, provider: "boom" }),
        searchFinished({ seq: 4, provider: "keep", outcome: "failed", hitCount: 0, errorCategory: "network" }),
        searchFinished({ seq: 5, provider: "boom", outcome: "cancelled", hitCount: 0, errorCategory: "aborted" }),
      ]),
    ).toBe("failed");
  });

  it("is unknown when a started source has no matching terminal", () => {
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        searchStarted({ provider: "keep" }),
        searchStarted({ seq: 3, provider: "boom" }),
        searchFinished({ seq: 4, provider: "keep", outcome: "ok", hitCount: 2 }),
      ]),
    ).toBe("unknown");
  });

  it("is failed when every observed source failed", () => {
    expect(
      searchHealthOf([
        retrieveStartEvent(),
        searchFinished({ outcome: "failed", hitCount: 0, errorCategory: "network" }),
      ]),
    ).toBe("failed");
  });
});

describe("failureReasonOf", () => {
  it("keeps a clusterable reason when a should-enter case stops early", () => {
    expect(
      failureReasonOf(enterGolden(), "early_stop", { ...blankMetrics(), verdictAccuracy: 0 }, { hasOverall: false }),
    ).toBe("unexpected_early_stop");
  });

  it("returns null when a stop-expected case stops early", () => {
    expect(
      failureReasonOf(golden({ expectsEarlyStop: true }), "early_stop", blankMetrics(), { hasOverall: false }),
    ).toBeNull();
  });

  it("splits missing final judgment from a wrong judgment", () => {
    expect(
      failureReasonOf(enterGolden(), "entered_no_final", { ...blankMetrics(), verdictAccuracy: 0 }, { hasOverall: false }),
    ).toBe("missing_verdict");
    expect(
      failureReasonOf(enterGolden(), "checked", { ...blankMetrics(), verdictAccuracy: 0 }, { hasOverall: true }),
    ).toBe("verdict_mismatch");
  });

  it("marks unlabeled qualification as unlabeled_qualification", () => {
    expect(failureReasonOf(golden(), "checked", blankMetrics(), { hasOverall: true })).toBe("unlabeled_qualification");
  });
});

describe("credibilityAccuracy", () => {
  it("returns 1 when score is inside the closed range", () => {
    expect(
      credibilityAccuracy(enterGolden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 0 }) }) })),
    ).toBe(1);
    expect(
      credibilityAccuracy(enterGolden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 20 }) }) })),
    ).toBe(1);
  });

  it("returns 0 when score is outside the closed range", () => {
    expect(
      credibilityAccuracy(enterGolden({ expectedCredibilityRange: [0, 20] }), input({ case: emptyCase({ overall: overall({ score: 21 }) }) })),
    ).toBe(0);
  });

  it("returns 0 not null when the case should enter check but has no overall", () => {
    expect(credibilityAccuracy(enterGolden(), input({ case: emptyCase() }))).toBe(0);
  });

  it("returns null when early stop is expected and there is no overall", () => {
    expect(credibilityAccuracy(golden({ expectsEarlyStop: true }), input({ case: emptyCase() }))).toBeNull();
  });
});

describe("citationIntegrityErrorRate", () => {
  it("returns 0 when citations and URLs resolve inside the case", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(citationIntegrityErrorRate(enterGolden(), input({ case: c, report: report() }))).toBe(0);
  });

  it("returns 1 when a [n] marker is missing from citations", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(
      citationIntegrityErrorRate(
        enterGolden(),
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
      citationIntegrityErrorRate(
        enterGolden(),
        input({ case: c, report: report({ citations: [{ n: 1, evidenceId: "e99" }] }) }),
      ),
    ).toBe(1);
  });

  it("returns 1 when the report text has a URL outside case evidence", () => {
    const c = emptyCase({ evidence: [evidence()] });
    expect(
      citationIntegrityErrorRate(
        enterGolden(),
        input({
          case: c,
          report: report({ conclusion: "见 https://evil.example/x [1]" }),
        }),
      ),
    ).toBe(1);
  });

  it("returns 1 not null when the case should enter check but has no report", () => {
    expect(citationIntegrityErrorRate(enterGolden(), input({ report: null }))).toBe(1);
  });

  it("returns null when early stop is expected and there is no report", () => {
    expect(citationIntegrityErrorRate(golden({ expectsEarlyStop: true }), input({ report: null }))).toBeNull();
  });
});

describe("reportContractPassRate", () => {
  it("returns 1 when conclusion, one line per checkable claim, citations, and scrub hold", () => {
    const c = emptyCase({ claims: [claim()] });
    expect(reportContractPassRate(enterGolden(), input({ case: c, report: report({ conclusion: "公开材料不支持这条说法。" }) }))).toBe(1);
  });

  it("returns 0 when jargon leaks through conclusion", () => {
    const c = emptyCase({ claims: [claim()] });
    expect(
      reportContractPassRate(enterGolden(), input({ case: c, report: report({ conclusion: "web_search 查过了。" }) })),
    ).toBe(0);
  });

  it("unverified 命题行无引用不扣分", () => {
    const c = emptyCase({
      claims: [claim()],
      verdicts: [verdict({ verdict: "unverified", rule: "no-evidence" })],
    });
    const r = report({ claimItems: [{ claimId: "c1", line: "没找到可以直接证实的依据。", citations: [] }] });
    expect(reportContractPassRate(enterGolden(), input({ case: c, report: r }))).toBe(1);
  });

  it("立场型命题行无引用不扣分", () => {
    const c = emptyCase({ claims: [claim({ checkable: false, type: "value" })] });
    const r = report({ claimItems: [{ claimId: "c1", line: "这是评价或立场，不做真假判断。", citations: [] }] });
    expect(reportContractPassRate(enterGolden(), input({ case: c, report: r }))).toBe(1);
  });

  it("下了判断的命题行无引用仍不通过", () => {
    const c = emptyCase({ claims: [claim()], verdicts: [verdict()] });
    const r = report({ claimItems: [{ claimId: "c1", line: "与依据相反。", citations: [] }] });
    expect(reportContractPassRate(enterGolden(), input({ case: c, report: r }))).toBe(0);
  });

  it("returns 0 not null when the case should enter check but has no report", () => {
    expect(reportContractPassRate(enterGolden(), input({ report: null }))).toBe(0);
  });

  it("returns null when early stop is expected and there is no report", () => {
    expect(reportContractPassRate(golden({ expectsEarlyStop: true }), input({ report: null }))).toBeNull();
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
    expect(routingAccuracy(enterGolden(), input({ events: [stepEvent()] }))).toBeNull();
  });
});

describe("groundingRate", () => {
  it("returns 1 when every checkable claim is verified with tally weight", () => {
    expect(
      groundingRate(
        enterGolden(),
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
        enterGolden(),
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
        enterGolden(),
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
        enterGolden(),
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
        enterGolden(),
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
        enterGolden(),
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
        enterGolden(),
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
    const g = enterGolden();
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

describe("scoreCase", () => {
  it("keeps a should-enter retrieve with no overall in the verdict denominator and marks entry as entered_no_final", () => {
    const metrics = scoreCase(
      enterGolden(),
      input({ events: [qualifyOkEvent(), retrieveStartEvent()] }),
      "entered_no_final",
    );
    expect(metrics.verdictAccuracy).toBe(0);
    expect(metrics.entryAccuracy).toBe(1);
  });

  it("marks unexpected early stop as entry 0 with a clusterable reason", () => {
    const metrics = scoreCase(enterGolden(), input({ events: [qualifyOkEvent()] }), "early_stop");
    expect(metrics.entryAccuracy).toBe(0);
    expect(metrics.verdictAccuracy).toBe(0);
    expect(failureReasonOf(enterGolden(), "early_stop", metrics, { hasOverall: false })).toBe("unexpected_early_stop");
  });

  it("keeps progress checked when fallback later produces a report, and retains the earlier model fault", () => {
    const scored = scoreCaseWithOutcome(
      enterGolden(),
      input({
        events: [retrieveStartEvent(), llmFailEvent("assess"), llmOkAfterFallback("compose", "内容审查"), reportFinalizedEvent()],
        case: emptyCase({ overall: overall() }),
        report: report(),
      }),
      "done",
    );
    expect(scored.progress).toBe("checked");
    expect(scored.faults.some((fault) => fault.kind === "model_failure" || fault.kind === "content_review")).toBe(true);
    expect(scored.failureReason).toBeNull();
  });

  it("classifies timeout as a fault, not as the case progress", () => {
    const scored = scoreCaseWithOutcome(enterGolden(), input({ events: [retrieveStartEvent()] }), "timeout");
    expect(scored.progress).toBe("entered_no_final");
    expect(scored.faults.some((fault) => fault.kind === "timeout")).toBe(true);
    expect(scored.failureReason).toBe("missing_verdict");
    expect(scored.metrics.verdictAccuracy).toBe(0);
    expect(scored.searchHealth).toBe("unknown");
  });
});

describe("summarize", () => {
  it("keeps a should-enter miss in the verdictAccuracy denominator instead of dropping null", () => {
    const summary = summarize([
      {
        metrics: { ...blankMetrics(), verdictAccuracy: 1 },
        elapsedMs: 10,
      },
      {
        metrics: { ...blankMetrics(), verdictAccuracy: verdictAccuracy(enterGolden(), input()) },
        elapsedMs: 10,
      },
    ]);
    expect(summary.verdictAccuracy).toBe(0.5);
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
    expect(summary.progress.entered_no_final + summary.progress.checked + summary.progress.early_stop).toBe(2);
    expect(summary.valid).toBe(false);
    expect(summary.invalidReason).toMatch(/unlabeled/);
  });

  it("marks the run invalid when any scored case is unlabeled", () => {
    const summary = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "unlabeled",
          progress: "early_stop",
        },
      ],
      [[]],
    );
    expect(summary.valid).toBe(false);
    expect(summary.invalidReason).toMatch(/unlabeled/);
  });

  it("marks the run invalid on unknown or failed search health, and keeps degraded failed sources", () => {
    const unknownRun = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "enter_check",
          progress: "checked",
          searchHealth: "unknown",
        },
      ],
      [[]],
    );
    expect(unknownRun.valid).toBe(false);
    expect(unknownRun.invalidReason).toMatch(/unknown/);
    const failedRun = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "enter_check",
          progress: "checked",
          searchHealth: "failed",
          failedSearchSources: ["boom"],
        },
      ],
      [[]],
    );
    expect(failedRun.valid).toBe(false);
    expect(failedRun.invalidReason).toMatch(/failed/);
    const degradedRun = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "enter_check",
          progress: "checked",
          searchHealth: "degraded",
          failedSearchSources: ["boom"],
        },
      ],
      [[]],
    );
    expect(degradedRun.valid).toBe(true);
    expect(degradedRun.failedSearchSources).toEqual(["boom"]);
    const emptyRun = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "enter_check",
          progress: "checked",
          searchHealth: "empty",
        },
      ],
      [[]],
    );
    expect(emptyRun.valid).toBe(true);
    expect(emptyRun.searchHealth.empty).toBe(1);
  });

  it("does not invalidate the run when an early_stop case has unknown search health", () => {
    const summary = summarizeRun(
      [
        {
          metrics: blankMetrics(),
          elapsedMs: 10,
          turnReason: "done",
          judgeRan: false,
          qualification: "early_stop",
          progress: "early_stop",
          searchHealth: "unknown",
        },
      ],
      [[]],
    );
    expect(summary.valid).toBe(true);
    expect(summary.invalidReason).toBeUndefined();
  });
});

function blankMetrics() {
  return {
    verdictAccuracy: null,
    credibilityAccuracy: null,
    citationIntegrityErrorRate: null,
    reportContractPassRate: null,
    routingAccuracy: null,
    groundingRate: null,
    quoteFidelity: null,
    provenanceDepth: null,
    latencyP50: null,
    latencyP95: null,
    entryAccuracy: null,
  };
}
