import type { Case, Evidence } from "@rhg/core/casefile";
import { describe, expect, it } from "vitest";
import { SEARCH_LABEL } from "./copy.js";
import { providerLabel, radarFromCase, stageOpen } from "./searchInstrument.js";

const AT = "2026-09-03T12:00:00.000Z";

function evidence(over: Partial<Evidence> & Pick<Evidence, "id">): Evidence {
  return {
    url: `https://example.com/${over.id}`,
    canonicalUrl: `https://example.com/${over.id}`,
    host: "example.com",
    excerpt: over.id,
    retrievedAt: AT,
    tier: "C",
    provenance: { kind: "search", query: "q", provider: "any_search" },
    ...over,
  };
}

function blank(over: Partial<Case> = {}): Case {
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

describe("searchInstrument", () => {
  it("未知 provider 不泄漏内部 id，并合成一路", () => {
    expect(providerLabel("fixtureSearch")).toBe(SEARCH_LABEL);
    expect(providerLabel("any_search")).toBe("AnySearch");
    expect(providerLabel("minimax_search")).toBe("MiniMax Token Plan");
    expect(providerLabel("stepfun_search")).toBe("阶跃 Step Plan");
    const model = radarFromCase(
      blank({
        evidence: [
          evidence({ id: "e1", provenance: { kind: "search", query: "q", provider: "fixtureSearch" } }),
          evidence({ id: "e2", provenance: { kind: "search", query: "q" } }),
        ],
        stages: [{ stage: "retrieve", startedAt: AT, finishedAt: AT, outcome: "ok", seq: 1 }],
      }),
      false,
    );
    expect(model.providers).toHaveLength(1);
    expect(model.providers[0]?.id).toBe("search");
    expect(model.providers[0]?.resultCount).toBe(2);
  });

  it("retrieve 未结束且无材料时给一路检索中，不带 0 条", () => {
    const model = radarFromCase(
      blank({
        stages: [{ stage: "retrieve", startedAt: AT, seq: 1 }],
      }),
      true,
    );
    expect(stageOpen(blank({ stages: [{ stage: "retrieve", startedAt: AT, seq: 1 }] }), "retrieve")).toBe(true);
    expect(model.phase).toBe("started");
    expect(model.providers).toEqual([{ id: "search", label: SEARCH_LABEL, status: "running", resultCount: 0 }]);
    expect(model.stats).toBeUndefined();
  });

  it("有检索材料且 retrieve 已结束才出统计", () => {
    const current = blank({
      evidence: [evidence({ id: "e1" }), evidence({ id: "e2", canonicalUrl: "https://example.com/e1" })],
      stages: [{ stage: "retrieve", startedAt: AT, finishedAt: AT, outcome: "ok", seq: 1 }],
    });
    const model = radarFromCase(current, false);
    expect(model.phase).toBe("completed");
    expect(model.providers[0]?.label).toBe("AnySearch");
    const mixed = radarFromCase(
      blank({
        evidence: [
          evidence({
            id: "e-mm",
            provenance: { kind: "search", query: "q", provider: "minimax_search" },
          }),
          evidence({
            id: "e-st",
            provenance: { kind: "search", query: "q", provider: "stepfun_search" },
          }),
        ],
        stages: [{ stage: "retrieve", startedAt: AT, finishedAt: AT, outcome: "ok", seq: 1 }],
      }),
      false,
    );
    expect(mixed.providers.map((p) => `${p.id}:${p.label}`).sort()).toEqual([
      "minimax_search:MiniMax Token Plan",
      "stepfun_search:阶跃 Step Plan",
    ]);
    expect(model.providers[0]?.status).toBe("completed");
    expect(model.stats?.rawResultCount).toBe(2);
    expect(model.stats?.uniqueSourceCount).toBe(1);
  });
});
