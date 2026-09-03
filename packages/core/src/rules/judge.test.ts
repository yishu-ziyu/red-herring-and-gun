import { describe, expect, it } from "vitest";
import type { Evidence, Stance, Tier } from "../casefile/schema.js";
import { judge } from "./judge.js";

const AT = "2026-09-03T08:00:00.000Z";

function evidence(
  id: string,
  opts: { tier?: Tier; clusterId?: string; reachable?: boolean; host?: string } = {},
): Evidence {
  const host = opts.host ?? `${id}.example.com`;
  return {
    id,
    url: `https://${host}/${id}`,
    canonicalUrl: `https://${host}/${id}`,
    host,
    excerpt: "摘要",
    retrievedAt: AT,
    tier: opts.tier ?? "C",
    provenance: { kind: "user" },
    ...(opts.clusterId !== undefined ? { clusterId: opts.clusterId } : {}),
    ...(opts.reachable !== undefined ? { reachable: opts.reachable } : {}),
  };
}

function stance(
  id: string,
  evidenceId: string,
  kind: Stance["stance"],
  opts: { confidence?: number; quoteFidelity?: boolean; claimId?: string } = {},
): Stance {
  return {
    id,
    claimId: opts.claimId ?? "c1",
    evidenceId,
    stance: kind,
    quote: "摘要",
    confidence: opts.confidence ?? 0.9,
    quoteFidelity: opts.quoteFidelity ?? true,
    by: "main",
  };
}

type Row = {
  name: string;
  evidence: Evidence[];
  stances: Stance[];
  verdict: "true" | "false" | "partial" | "unverified" | "contested";
  rule: string;
};

const ROWS: Row[] = [
  {
    name: "无立场 → unverified / no-evidence",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [],
    verdict: "unverified",
    rule: "no-evidence",
  },
  {
    name: "单 C 支持 → unverified / insufficient",
    evidence: [evidence("e1", { tier: "C" })],
    stances: [stance("s1", "e1", "supports")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "一 A 反驳 → false",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "refutes")],
    verdict: "false",
    rule: "false",
  },
  {
    name: "两独立 B 支持 → true",
    evidence: [evidence("e1", { tier: "B" }), evidence("e2", { tier: "B" })],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports")],
    verdict: "true",
    rule: "true",
  },
  {
    name: "同簇三 C 支持 → unverified（只算一次）",
    evidence: [
      evidence("e1", { tier: "C", clusterId: "k1" }),
      evidence("e2", { tier: "C", clusterId: "k1" }),
      evidence("e3", { tier: "C", clusterId: "k1" }),
    ],
    stances: [
      stance("s1", "e1", "supports"),
      stance("s2", "e2", "supports"),
      stance("s3", "e3", "supports"),
    ],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "A 支持 + A 反驳 → contested",
    evidence: [evidence("e1", { tier: "A" }), evidence("e2", { tier: "A" })],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "refutes")],
    verdict: "contested",
    rule: "contested",
  },
  {
    name: "partial 主导 → partial",
    evidence: [evidence("e1", { tier: "C" }), evidence("e2", { tier: "C" })],
    stances: [stance("s1", "e1", "partial"), stance("s2", "e2", "partial")],
    verdict: "partial",
    rule: "partial",
  },
  {
    name: "不可达证据不计",
    evidence: [evidence("e1", { tier: "A", reachable: false })],
    stances: [stance("s1", "e1", "refutes")],
    verdict: "unverified",
    rule: "no-evidence",
  },
  {
    name: "低 confidence 不计",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "refutes", { confidence: 0.49 })],
    verdict: "unverified",
    rule: "no-evidence",
  },
  {
    name: "quoteFidelity=false 不计",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "refutes", { quoteFidelity: false })],
    verdict: "unverified",
    rule: "no-evidence",
  },
  {
    name: "unknown tier 按 C：一 unknown 反驳不够 false",
    evidence: [evidence("e1", { tier: "unknown" })],
    stances: [stance("s1", "e1", "refutes")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "同簇 A+C 同向只算 A（3<4 → insufficient）",
    evidence: [
      evidence("e1", { tier: "A", clusterId: "k1" }),
      evidence("e2", { tier: "C", clusterId: "k1" }),
    ],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "跨簇同 host 不同 clusterId 按两簇（两 B → true）",
    evidence: [
      evidence("e1", { tier: "B", host: "news.example.com", clusterId: "k1" }),
      evidence("e2", { tier: "B", host: "news.example.com", clusterId: "k2" }),
    ],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports")],
    verdict: "true",
    rule: "true",
  },
  {
    name: "ref = sup 且未达 contested → unverified",
    evidence: [evidence("e1", { tier: "B" }), evidence("e2", { tier: "B" })],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "refutes")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "一 A 支持 + 一独立 C 支持 → true",
    evidence: [evidence("e1", { tier: "A" }), evidence("e2", { tier: "C" })],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports")],
    verdict: "true",
    rule: "true",
  },
  {
    name: "一 A 支持单独 → unverified（孤证）",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "supports")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "两独立 C 反驳不够 false",
    evidence: [evidence("e1", { tier: "C" }), evidence("e2", { tier: "C" })],
    stances: [stance("s1", "e1", "refutes"), stance("s2", "e2", "refutes")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "两 B 支持 + 一 A 反驳 → contested（先于 true/false）",
    evidence: [
      evidence("e1", { tier: "B" }),
      evidence("e2", { tier: "B" }),
      evidence("e3", { tier: "A" }),
    ],
    stances: [
      stance("s1", "e1", "supports"),
      stance("s2", "e2", "supports"),
      stance("s3", "e3", "refutes"),
    ],
    verdict: "contested",
    rule: "contested",
  },
  {
    name: "confidence 恰为 0.5 计入",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "refutes", { confidence: 0.5 })],
    verdict: "false",
    rule: "false",
  },
  {
    name: "reachable 未标的 A 反驳计入",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "refutes")],
    verdict: "false",
    rule: "false",
  },
  {
    name: "仅 contextual 有效 → insufficient",
    evidence: [evidence("e1", { tier: "A" })],
    stances: [stance("s1", "e1", "contextual")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "一条 C partial 不够（par<2）",
    evidence: [evidence("e1", { tier: "C" })],
    stances: [stance("s1", "e1", "partial")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "A 支持 + B 反驳 → unverified（未达 contested / true / false）",
    evidence: [evidence("e1", { tier: "A" }), evidence("e2", { tier: "B" })],
    stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "refutes")],
    verdict: "unverified",
    rule: "insufficient",
  },
  {
    name: "低 confidence 的 A 反驳被滤掉后两 B 支持仍 true",
    evidence: [
      evidence("e1", { tier: "B" }),
      evidence("e2", { tier: "B" }),
      evidence("e3", { tier: "A" }),
    ],
    stances: [
      stance("s1", "e1", "supports"),
      stance("s2", "e2", "supports"),
      stance("s3", "e3", "refutes", { confidence: 0.1 }),
    ],
    verdict: "true",
    rule: "true",
  },
];

describe("judge", () => {
  it.each(ROWS)("$name", (row) => {
    const got = judge({
      claimId: "c1",
      stances: row.stances,
      evidence: row.evidence,
      updatedAt: AT,
    });
    expect(got.verdict).toBe(row.verdict);
    expect(got.rule).toBe(row.rule);
    expect(got.claimId).toBe("c1");
    expect(got.updatedAt).toBe(AT);
    if (got.verdict === "true" || got.verdict === "false" || got.verdict === "partial") {
      expect(got.basis.length).toBeGreaterThan(0);
    }
  });

  it("同簇 A+C 同向的 basis 只含最高 tier 的 stance", () => {
    const got = judge({
      claimId: "c1",
      stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports")],
      evidence: [
        evidence("e1", { tier: "A", clusterId: "k1" }),
        evidence("e2", { tier: "C", clusterId: "k1" }),
      ],
      updatedAt: AT,
    });
    expect(got.basis).toEqual(["s1"]);
  });

  it("同证据两条 stance 只算最后一条", () => {
    const got = judge({
      claimId: "c1",
      stances: [stance("s1", "e1", "supports"), stance("s2", "e1", "refutes")],
      evidence: [evidence("e1", { tier: "A" })],
      updatedAt: AT,
    });
    expect(got.verdict).toBe("false");
    expect(got.rule).toBe("false");
    expect(got.basis).toEqual(["s2"]);
  });

  it("tally 记各方向簇权重和；无有效立场时不带 tally", () => {
    const got = judge({
      claimId: "c1",
      stances: [stance("s1", "e1", "supports"), stance("s2", "e2", "supports"), stance("s3", "e3", "refutes")],
      evidence: [
        evidence("e1", { tier: "B" }),
        evidence("e2", { tier: "B" }),
        evidence("e3", { tier: "C" }),
      ],
      updatedAt: AT,
    });
    expect(got.tally).toEqual({ sup: 4, ref: 1, par: 0 });
    expect(judge({ claimId: "c1", stances: [], evidence: [], updatedAt: AT }).tally).toBeUndefined();
  });
});
