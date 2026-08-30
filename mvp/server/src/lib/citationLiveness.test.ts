import { describe, expect, it } from "vitest";
import {
  checkSourceLiveness,
  classifyLivenessStatus,
  pruneDeadCitations,
  type FetchLike,
} from "./citationLiveness";

function fetchReturning(statusByUrl: Record<string, number>): FetchLike {
  return async (url) => ({ status: statusByUrl[String(url)] ?? 200, body: null });
}

function fetchRejecting(): FetchLike {
  return async () => {
    throw new Error("network down");
  };
}

describe("classifyLivenessStatus", () => {
  it("treats 2xx/3xx as alive", () => {
    expect(classifyLivenessStatus(200)).toBe("alive");
    expect(classifyLivenessStatus(301)).toBe("alive");
  });

  it("treats 404/408/410/5xx as dead", () => {
    expect(classifyLivenessStatus(404)).toBe("dead");
    expect(classifyLivenessStatus(408)).toBe("dead");
    expect(classifyLivenessStatus(410)).toBe("dead");
    expect(classifyLivenessStatus(500)).toBe("dead");
    expect(classifyLivenessStatus(503)).toBe("dead");
  });

  it("treats gated pages (401/403/405/429) as alive", () => {
    expect(classifyLivenessStatus(401)).toBe("alive");
    expect(classifyLivenessStatus(403)).toBe("alive");
    expect(classifyLivenessStatus(405)).toBe("alive");
    expect(classifyLivenessStatus(429)).toBe("alive");
  });
});

describe("checkSourceLiveness", () => {
  it("dedupes urls and maps status per url", async () => {
    const fetchImpl = fetchReturning({
      "https://a.example/x": 200,
      "https://dead.example/y": 410,
    });
    const result = await checkSourceLiveness(
      ["https://a.example/x", "https://a.example/x", "https://dead.example/y"],
      { fetchImpl }
    );
    expect(result.get("https://a.example/x")).toBe("alive");
    expect(result.get("https://dead.example/y")).toBe("dead");
  });

  it("maps network failure to dead", async () => {
    const result = await checkSourceLiveness(["https://unreachable.example/"], {
      fetchImpl: fetchRejecting(),
    });
    expect(result.get("https://unreachable.example/")).toBe("dead");
  });
});

describe("pruneDeadCitations", () => {
  function buildReport(): Record<string, unknown> {
    return {
      conclusion: "综合看，A 说法[1]不成立，B 说法[2]存疑。",
      citationSources: [
        { url: "https://dead.example/gone", title: "死链", snippet: "s" },
        { url: "https://alive.example/ok", title: "活链", snippet: "s" },
      ],
      subclaimVerdicts: [
        {
          claimAtom: "原子A",
          evidence: "证据见[1][2]。",
          supportingSources: [
            { url: "https://dead.example/gone", title: "死链", snippet: "s" },
            { url: "https://alive.example/ok", title: "活链", snippet: "s" },
          ],
        },
        {
          claimAtom: "原子B",
          sourcesRelatedOnly: true,
          evidence: "填充证据[1]。",
          supportingSources: [{ url: "https://fill.example/x", title: "填充", snippet: "s" }],
        },
      ],
      claimItems: [
        {
          text: "原子A",
          verdict: {
            claimAtom: "原子A",
            evidence: "旧证据，待同步。",
            supportingSources: [],
          },
        },
      ],
      evidenceChain: [
        {
          layer: "检索",
          finding: "f",
          evidence: "链上[1][2]。",
          sourceRefs: ["https://dead.example/gone", "https://alive.example/ok"],
        },
      ],
    };
  }

  it("drops dead urls and rebinds every [n] marker", async () => {
    const report = buildReport();
    const result = await pruneDeadCitations(report, {
      liveness: new Map([
        ["https://dead.example/gone", "dead"],
        ["https://alive.example/ok", "alive"],
        ["https://fill.example/x", "alive"],
      ]),
    });

    expect(result.pruned).toBe(true);
    expect(result.deadUrls).toEqual(["https://dead.example/gone"]);

    // verdict 层：死链剔除、标记重绑
    const verdicts = report.subclaimVerdicts as Array<Record<string, unknown>>;
    expect((verdicts[0].supportingSources as Array<{ url: string }>).map((s) => s.url)).toEqual([
      "https://alive.example/ok",
    ]);
    expect(verdicts[0].evidence).toBe("证据见[1]。");

    // relatedOnly verdict：剔除死链、无标记
    expect((verdicts[1].supportingSources as Array<{ url: string }>).map((s) => s.url)).toEqual([
      "https://fill.example/x",
    ]);

    // 全局结论与 citationSources 重建
    expect(report.conclusion).toBe("综合看，A 说法[1]不成立，B 说法存疑。");
    const globals = report.citationSources as Array<{ url: string }>;
    expect(globals.map((s) => s.url)).toEqual(["https://alive.example/ok"]);

    // claimItems 内嵌 verdict 同步
    const items = report.claimItems as Array<Record<string, unknown>>;
    const syncedVerdict = items[0].verdict as Record<string, unknown>;
    expect(syncedVerdict.evidence).toBe("证据见[1]。");

    // evidenceChain sourceRefs 过滤死链
    const layers = report.evidenceChain as Array<Record<string, unknown>>;
    expect(layers[0].sourceRefs).toEqual(["https://alive.example/ok"]);
    expect(layers[0].evidence).toBe("链上[1]。");
  });

  it("is a no-op when every url is alive", async () => {
    const report = buildReport();
    const result = await pruneDeadCitations(report, {
      liveness: new Map([
        ["https://dead.example/gone", "alive"],
        ["https://alive.example/ok", "alive"],
        ["https://fill.example/x", "alive"],
      ]),
    });
    expect(result.pruned).toBe(false);
    expect(result.deadUrls).toEqual([]);
    expect(report.subclaimVerdicts).toHaveLength(2);
  });

  it("does nothing when citationSources is empty", async () => {
    const report: Record<string, unknown> = { conclusion: "x", citationSources: [] };
    const result = await pruneDeadCitations(report, { liveness: new Map() });
    expect(result.pruned).toBe(false);
  });
});
