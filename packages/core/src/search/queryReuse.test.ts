// searchAccepted 集成用例随 memoryCandidateStore 由 T05 搬回。
/**
 * queryReuse: accepted 问法进首轮实搜；旧案 URL / 判词不得进种子或引用。
 */

import { describe, expect, it } from "vitest";
import { buildAtomSearchQueries } from "./atomSearchQuery";
import type { MemoryCandidate, MemoryCandidateHit } from "../text/memoryCandidateTypes";
import { buildQueriesWithReuse, extractReusableQueries, mergeReuseSeeds } from "./queryReuse";

const HISTORICAL_QUERY = "电瓶车被偷至境外 非洲 P图 辟谣 警方通报";
const OLD_CASE_URL = "https://old-case.example/africa-ev";
const SYNONYM_ATOM = "我说我的电动车叫谁偷走了，原来送到非洲去了";

function makeHit(overrides: Partial<MemoryCandidate> = {}): MemoryCandidateHit {
  return {
    score: 0.9,
    matchedTerms: ["电动", "非洲"],
    candidate: {
      id: "mc-search",
      kind: "search_strategy",
      status: "accepted",
      title: "搜索策略：电瓶车境外失窃",
      summary: "下次优先复用境外 P 图通报问法",
      confidence: 80,
      tags: ["search"],
      proposedByAgent: "FactChecker",
      provenance: {
        runId: "run-old",
        claim: "我说我的电瓶车叫谁偷走了，原来送到非洲去了",
        normalizedClaim: "我说我的电瓶车叫谁偷走了原来送到非洲去了",
        createdAt: 1_700_000_000_000,
        sourceUrls: [OLD_CASE_URL],
        unresolvedQuestions: [],
      },
      payload: {
        rumorType: "fact",
        effectiveQueries: [HISTORICAL_QUERY],
        ineffectiveQueries: [],
        sourceDomains: ["old-case.example"],
        stopRules: ["没有独立反证时不能直接判真"],
        verdictType: "false",
        conclusion: "不能信",
      },
      ...overrides,
    },
  };
}

describe("extractReusableQueries", () => {
  it("只从 accepted search_strategy 抽出问法", () => {
    expect(extractReusableQueries([makeHit()])).toEqual([HISTORICAL_QUERY]);
  });

  it("proposed 不进种子", () => {
    expect(extractReusableQueries([makeHit({ status: "proposed" })])).toEqual([]);
  });

  it("旧案 URL 与判词不得进种子", () => {
    const hits = [
      makeHit({
        payload: {
          rumorType: "fact",
          effectiveQueries: [
            HISTORICAL_QUERY,
            OLD_CASE_URL,
            "https://old-case.example/africa-ev?utm=1",
            "www.old-case.example/x",
            "false",
            "不能信",
            "unverified",
            "mixed_misleading",
          ],
          ineffectiveQueries: [],
          sourceDomains: ["old-case.example"],
          stopRules: ["不能信"],
        },
      }),
      makeHit({
        id: "mc-case",
        kind: "case_pattern",
        payload: {
          verdictType: "false",
          conclusion: "不能信",
          credibilityScore: 12,
        },
      }),
    ];
    expect(extractReusableQueries(hits)).toEqual([HISTORICAL_QUERY]);
  });

  it("无命中时为空", () => {
    expect(extractReusableQueries([])).toEqual([]);
  });
});

describe("mergeReuseSeeds", () => {
  it("无种子时输出等于配方", () => {
    const recipe = buildAtomSearchQueries(SYNONYM_ATOM);
    expect(mergeReuseSeeds(recipe, [])).toEqual(recipe);
  });

  it("先插入历史问法且长度不超过 3", () => {
    const recipe = ["电动车 非洲", "电动车 非洲 辟谣", "第三路"];
    expect(mergeReuseSeeds(recipe, [HISTORICAL_QUERY, "另一条不该挤进来"])).toEqual([
      HISTORICAL_QUERY,
      "电动车 非洲",
      "电动车 非洲 辟谣",
    ]);
  });
});

describe("buildQueriesWithReuse", () => {
  it("accepted 历史问法在同义改写上插入，长度 ≤ 3", () => {
    const recipe = buildAtomSearchQueries(SYNONYM_ATOM);
    expect(recipe).not.toContain(HISTORICAL_QUERY);

    const reused = buildQueriesWithReuse(SYNONYM_ATOM, [makeHit()]);
    expect(reused).toContain(HISTORICAL_QUERY);
    expect(reused.length).toBeGreaterThan(0);
    expect(reused.length).toBeLessThanOrEqual(3);
    expect(reused[0]).toBe(HISTORICAL_QUERY);
  });

  it("无命中时输出等于配方", () => {
    expect(buildQueriesWithReuse(SYNONYM_ATOM, [])).toEqual(buildAtomSearchQueries(SYNONYM_ATOM));
  });

  it("proposed 不改变配方", () => {
    expect(buildQueriesWithReuse(SYNONYM_ATOM, [makeHit({ status: "proposed" })])).toEqual(
      buildAtomSearchQueries(SYNONYM_ATOM)
    );
  });
});
