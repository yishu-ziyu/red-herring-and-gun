import type { Case, Evidence, Pivot } from '@rhg/core/casefile';
import { describe, expect, it } from "vitest";
import { IMAGE_ORIGIN, STATUS } from "./copy.js";
import {
  clusterGroups,
  graphElements,
  latestStatus,
  openFrontier,
  parseCiteMarks,
  pivotLabel,
} from "./select.js";

const AT = "2026-09-03T12:00:00.000Z";

function evidence(id: string, tier: Evidence["tier"], clusterId?: string): Evidence {
  return {
    id,
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    host: "example.com",
    excerpt: id,
    retrievedAt: AT,
    tier,
    provenance: { kind: "user" },
    ...(clusterId ? { clusterId } : {}),
  };
}

function blank(over: Partial<Case> = {}): Case {
  return {
    id: "case-1",
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

function pivot(id: string, expectedValue: 1 | 2 | 3, kind: Pivot["kind"] = "entity"): Pivot {
  return { id, kind, value: id, why: "x", expectedValue, depth: 1 };
}

describe("clusterGroups", () => {
  it("有 cites 时簇根是被引最多者", () => {
    const items = [
      evidence("e1", "C", "k1"),
      evidence("e2", "A", "k1"),
      evidence("e3", "B", "k1"),
    ];
    const groups = clusterGroups(items, [
      { from: "e1", to: "e3" },
      { from: "e2", to: "e3" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((row) => row.id)).toEqual(["e3", "e1", "e2"]);
  });

  it("无 cites 时簇根取层级最高者，无簇的各自成组", () => {
    const items = [evidence("e1", "C", "k1"), evidence("e2", "A", "k1"), evidence("e3", "B")];
    const groups = clusterGroups(items, []);
    const clustered = groups.find((row) => row.id === "k1");
    const solo = groups.find((row) => row.id === "solo:e3");
    expect(clustered?.items.map((row) => row.id)).toEqual(["e2", "e1"]);
    expect(solo?.items.map((row) => row.id)).toEqual(["e3"]);
  });
});

describe("openFrontier", () => {
  it("过滤已消费并按 expectedValue 降序取前 6", () => {
    const current = blank({
      frontier: [
        pivot("p1", 1),
        pivot("p2", 3),
        pivot("p3", 2),
        pivot("p4", 3),
        pivot("p5", 1),
        pivot("p6", 2),
        pivot("p7", 3),
        pivot("p8", 2),
      ],
      consumedPivotIds: ["p2", "p8"],
    });
    expect(openFrontier(current).map((row) => row.id)).toEqual(["p4", "p7", "p3", "p6", "p1", "p5"]);
  });
});

describe("parseCiteMarks", () => {
  it("连写 [1][2] 拆成两条引用", () => {
    const parts = parseCiteMarks("见[1][2]完", new Set([1, 2]));
    expect(parts).toEqual([
      { type: "text", value: "见" },
      { type: "cite", n: 1 },
      { type: "cite", n: 2 },
      { type: "text", value: "完" },
    ]);
  });

  it("悬空 [99] 保留原文不成链接", () => {
    const parts = parseCiteMarks("见[99]完", new Set([1]));
    expect(parts).toEqual([{ type: "text", value: "见[99]完" }]);
  });
});

describe("latestStatus", () => {
  it("最近 stage.started 映射到状态词", () => {
    const current = blank({
      stages: [{ stage: "retrieve", startedAt: AT, seq: 1 }],
      turns: [{ id: "t1", startedAt: AT }],
    });
    expect(latestStatus(current, true)).toBe(STATUS.retrieving);
  });

  it("turn.finished 后为已完成", () => {
    const current = blank({
      stages: [{ stage: "finalize", startedAt: AT, finishedAt: AT, seq: 1 }],
      turns: [{ id: "t1", startedAt: AT, finishedAt: AT, reason: "done" }],
    });
    expect(latestStatus(current, false)).toBe(STATUS.done);
  });

  it("turn.finished 后为已中止", () => {
    const current = blank({
      stages: [{ stage: "assess", startedAt: AT, seq: 1 }],
      turns: [{ id: "t1", startedAt: AT, finishedAt: AT, reason: "aborted" }],
    });
    expect(latestStatus(current, false)).toBe(STATUS.aborted);
    expect(latestStatus(current, true, true)).toBe(STATUS.aborted);
  });
});

describe("pivotLabel", () => {
  it("link / entity / image 各用规定文案", () => {
    expect(pivotLabel(pivot("人社部", 2, "entity"))).toBe("人社部");
    expect(pivotLabel({ ...pivot("img", 1, "image"), value: "https://x.com/a.png" })).toBe(IMAGE_ORIGIN);
    expect(pivotLabel({ ...pivot("link", 3, "link"), value: "https://www.gov.cn/zhengce/allowance" })).toBe(
      "www.gov.cn/zhengce/allowance",
    );
  });
});

describe("graphElements", () => {
  it("无边时返回 null", () => {
    expect(graphElements(blank({ evidence: [evidence("e1", "A")] }))).toBeNull();
  });

  it("节点 = 引用证据 ∪ 它们 cites 到的证据", () => {
    const current = blank({
      evidence: [evidence("e1", "A"), evidence("e2", "C"), evidence("e3", "B")],
      cites: [
        { from: "e1", to: "e2" },
        { from: "e3", to: "e2" },
      ],
      report: {
        conclusion: "x",
        claimItems: [],
        citations: [{ n: 1, evidenceId: "e1" }],
        finalizedAt: AT,
      },
    });
    const graph = graphElements(current);
    expect(graph?.nodeIds.sort()).toEqual(["e1", "e2"]);
    expect(graph?.edges).toEqual([{ from: "e1", to: "e2" }]);
  });
});
