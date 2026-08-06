import { describe, expect, it } from "vitest";
import {
  buildReactTrace,
  buildSecondaryCounterSearchNote,
  buildSecondPassCounterSearchHint,
  computeShouldSecondPassCounterSearch,
  SECOND_PASS_COUNTER_SEARCH_HINT,
  shouldInjectReactTrace,
} from "./reactObserve";
import type { Search360Response } from "../schemas";

function makeSearch(overrides: Partial<Search360Response> = {}): Search360Response {
  return {
    answer: "检索摘要：事件尚无官方确认。",
    sources: [{ title: "A", url: "https://a.example", snippet: "s" }],
    supportingEvidence: [{ title: "S", url: "https://s.example", snippet: "support" }],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: ["缺官方通报", "缺原始数据"],
    relatedQuestions: [],
    _source: "360-ai-search",
    ...overrides,
  };
}

describe("buildReactTrace", () => {
  it("fact_checker: builds thoughtHint + search/upstream observations + nextActionHint", () => {
    const trace = buildReactTrace({
      agentId: "fact_checker",
      claim: "某地发生食品安全事件",
      searchResult: makeSearch(),
      previousSteps: [
        {
          agent: "rumor_detector",
          status: "completed",
          output: {
            claimAtoms: ["某地发生食品安全事件"],
            neededEvidence: ["卫健委通报", "检测报告"],
            rumorTypes: ["社会"],
          },
        },
      ],
    });

    expect(trace).not.toBeNull();
    expect(trace!.thoughtHint).toMatch(/Think/);
    expect(trace!.nextActionHint).toMatch(/Act/);
    expect(trace!.observations.length).toBeGreaterThanOrEqual(2);

    const kinds = trace!.observations.map((o) => o.kind);
    expect(kinds).toContain("upstream");
    expect(kinds).toContain("search");
    expect(kinds).toContain("gap");

    const searchObs = trace!.observations.find((o) => o.kind === "search");
    expect(searchObs?.summary).toMatch(/support=1/);
    expect(searchObs?.summary).toMatch(/contradict=0/);
    // 反证为空 → nextAction 应提示反证缺口
    expect(trace!.nextActionHint).toMatch(/反证/);
    // search gaps≥2 + empty contradict → shouldSecondPassCounterSearch
    expect(trace!.shouldSecondPassCounterSearch).toBe(true);
  });

  it("source_validator: includes fact_checker upstream + search observations", () => {
    const trace = buildReactTrace({
      agentId: "source_validator",
      searchResult: makeSearch({
        contradictingEvidence: [{ title: "C", url: "https://c.example", snippet: "c" }],
        unresolvedEvidenceGaps: [],
      }),
      previousSteps: [
        {
          agent: "fact_checker",
          output: {
            factCheckResult: "partial",
            confidence: "medium",
            unresolvedEvidenceGaps: ["缺原始研究"],
          },
        },
      ],
    });

    expect(trace).not.toBeNull();
    expect(trace!.thoughtHint).toMatch(/来源|信源|可追溯/);
    const upstream = trace!.observations.filter((o) => o.source?.startsWith("upstream:fact_checker"));
    expect(upstream.length).toBeGreaterThanOrEqual(1);
    expect(upstream.some((o) => /partial/.test(o.summary))).toBe(true);
    expect(trace!.observations.some((o) => o.kind === "search")).toBe(true);
  });

  it("handles missing searchResult without throwing", () => {
    const trace = buildReactTrace({
      agentId: "fact_checker",
      previousSteps: [],
    });
    expect(trace).not.toBeNull();
    expect(trace!.observations.some((o) => /尚未就绪|无检索/.test(o.summary))).toBe(true);
    expect(trace!.nextActionHint).toMatch(/无检索|降低置信/);
  });

  it("flags tool-error search quality", () => {
    const trace = buildReactTrace({
      agentId: "fact_checker",
      searchResult: makeSearch({
        _source: "tool-error",
        supportingEvidence: [],
        sources: [],
        unresolvedEvidenceGaps: ["调用失败"],
        traceText: "timeout",
      }),
    });
    expect(trace!.observations.some((o) => o.kind === "quality" && /tool-error/.test(o.summary))).toBe(
      true
    );
  });

  it("includes memory observation when memoryHitCount > 0", () => {
    const trace = buildReactTrace({
      agentId: "fact_checker",
      searchResult: makeSearch(),
      memoryHitCount: 2,
    });
    expect(trace!.observations.some((o) => o.kind === "memory" && /2/.test(o.summary))).toBe(true);
  });

  it("returns null for agents outside whitelist", () => {
    expect(buildReactTrace({ agentId: "report_composer" })).toBeNull();
    expect(buildReactTrace({ agentId: "rumor_detector" })).toBeNull();
  });
});

describe("buildSecondaryCounterSearchNote", () => {
  it("returns 应触发二次反证检索 when fact gaps>=2 and no contradicting evidence", () => {
    const note = buildSecondaryCounterSearchNote({
      searchResult: makeSearch({ contradictingEvidence: [], unresolvedEvidenceGaps: [] }),
      previousSteps: [
        {
          agent: "fact_checker",
          output: {
            unresolvedEvidenceGaps: ["缺官方确认", "缺检测报告", "缺时间线"],
          },
        },
      ],
    });
    expect(note).toBe("应触发二次反证检索");
  });

  it("returns null when gaps < 2 or contradicting evidence exists", () => {
    expect(
      buildSecondaryCounterSearchNote({
        searchResult: makeSearch({ contradictingEvidence: [] }),
        previousSteps: [
          { agent: "fact_checker", output: { unresolvedEvidenceGaps: ["仅一项"] } },
        ],
      })
    ).toBeNull();

    expect(
      buildSecondaryCounterSearchNote({
        searchResult: makeSearch({
          contradictingEvidence: [{ title: "C", url: "https://c.example", snippet: "x" }],
        }),
        previousSteps: [
          {
            agent: "fact_checker",
            output: { unresolvedEvidenceGaps: ["a", "b"] },
          },
        ],
      })
    ).toBeNull();
  });
});

describe("computeShouldSecondPassCounterSearch", () => {
  it("true when gaps>=2 and contradictingEvidence empty", () => {
    expect(
      computeShouldSecondPassCounterSearch({
        searchResult: makeSearch({ contradictingEvidence: [] }),
        unresolvedEvidenceGaps: ["a", "b"],
      })
    ).toBe(true);
  });

  it("false when contradictingEvidence present or gaps < 2", () => {
    expect(
      computeShouldSecondPassCounterSearch({
        searchResult: makeSearch({
          contradictingEvidence: [{ title: "C", url: "https://c.example", snippet: "x" }],
        }),
        unresolvedEvidenceGaps: ["a", "b", "c"],
      })
    ).toBe(false);
    expect(
      computeShouldSecondPassCounterSearch({
        searchResult: makeSearch({ contradictingEvidence: [] }),
        unresolvedEvidenceGaps: ["only-one"],
      })
    ).toBe(false);
  });
});

describe("buildSecondPassCounterSearchHint", () => {
  it("returns 建议二次反证检索 when fact gaps>=2 and no contradict", () => {
    const hint = buildSecondPassCounterSearchHint({
      searchResult: makeSearch({ contradictingEvidence: [] }),
      previousSteps: [
        {
          agent: "fact_checker",
          output: { unresolvedEvidenceGaps: ["缺官方", "缺检测"] },
        },
      ],
    });
    expect(hint).toBe(SECOND_PASS_COUNTER_SEARCH_HINT);
  });

  it("returns hint when fact counterEvidence is empty array", () => {
    const hint = buildSecondPassCounterSearchHint({
      searchResult: makeSearch({
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }),
      previousSteps: [
        {
          agent: "fact_checker",
          output: { counterEvidence: [], unresolvedEvidenceGaps: [] },
        },
      ],
    });
    expect(hint).toBe(SECOND_PASS_COUNTER_SEARCH_HINT);
  });

  it("returns null without fact_checker step or when contradict exists", () => {
    expect(
      buildSecondPassCounterSearchHint({
        searchResult: makeSearch({ contradictingEvidence: [] }),
        previousSteps: [],
      })
    ).toBeNull();
    expect(
      buildSecondPassCounterSearchHint({
        searchResult: makeSearch({
          contradictingEvidence: [{ title: "C", url: "https://c.example", snippet: "x" }],
        }),
        previousSteps: [
          { agent: "fact_checker", output: { unresolvedEvidenceGaps: ["a", "b"] } },
        ],
      })
    ).toBeNull();
  });
});

describe("shouldInjectReactTrace", () => {
  it("only fact_checker and source_validator", () => {
    expect(shouldInjectReactTrace("fact_checker")).toBe(true);
    expect(shouldInjectReactTrace("source_validator")).toBe(true);
    expect(shouldInjectReactTrace("report_composer")).toBe(false);
    expect(shouldInjectReactTrace("rumor_detector")).toBe(false);
  });
});
