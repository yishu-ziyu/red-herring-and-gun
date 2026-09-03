import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertInvariants,
  createCase,
  deserialize,
  reduce,
  replay,
  serialize,
  validateEvent,
  type Case,
  type CaseEvent,
  type Claim,
  type ClaimAtomType,
  type Evidence,
  type Pivot,
  type Provenance,
  type Stance,
} from "../index.js";

const AT = "2026-09-03T07:00:00.000Z";

const CLAIM_TYPES: ClaimAtomType[] = [
  "fact",
  "causal",
  "comparison",
  "concept",
  "value",
  "prediction",
  "normative",
  "personal",
];

function sampleClaim(id: string, order: number): Claim {
  return { id, text: `命题${id}`, type: "fact", checkable: true, order };
}

function sampleEvidence(id: string, url: string): Evidence {
  return {
    id,
    url,
    canonicalUrl: url,
    host: new URL(url).hostname,
    excerpt: "摘要",
    retrievedAt: AT,
    tier: "unknown",
    provenance: { kind: "user" },
  };
}

function fullCoverageSequence(): CaseEvent[] {
  const claim1 = sampleClaim("c1", 0);
  const claim2: Claim = { id: "c2", text: "这太离谱", type: "value", checkable: false, order: 1 };
  const ev1: Evidence = {
    id: "e1",
    url: "https://www.gov.cn/a",
    canonicalUrl: "https://www.gov.cn/a",
    host: "www.gov.cn",
    excerpt: "官方通报",
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "search", query: "官方通报" },
  };
  const ev2: Evidence = {
    id: "e2",
    url: "https://news.example.com/b",
    canonicalUrl: "https://news.example.com/b",
    host: "news.example.com",
    excerpt: "转载",
    retrievedAt: AT,
    tier: "C",
    provenance: { kind: "pivot", fromEvidenceId: "e1", pivotId: "p1" },
  };
  const stance: Stance = {
    id: "s1",
    claimId: "c1",
    evidenceId: "e1",
    stance: "refutes",
    quote: "官方通报",
    confidence: 0.9,
    quoteFidelity: true,
    by: "main",
  };
  const pivot: Pivot = {
    id: "p1",
    kind: "link",
    value: "https://www.gov.cn/a",
    why: "原始来源",
    expectedValue: 3,
    fromEvidenceId: "e2",
    depth: 1,
  };
  return [
    { type: "case.created", seq: 1, at: AT, id: "case1", text: "A 发生了，这太离谱" },
    { type: "message.added", seq: 2, at: AT, message: { id: "m1", role: "user", text: "A 发生了，这太离谱", at: AT } },
    { type: "turn.started", seq: 3, at: AT, turnId: "t1" },
    { type: "stage.started", seq: 4, at: AT, turnId: "t1", stage: "decompose" },
    { type: "claims.added", seq: 5, at: AT, turnId: "t1", claims: [claim1, claim2] },
    { type: "claims.dropped", seq: 6, at: AT, turnId: "t1", claimIds: ["c2"], reason: "self-proof" },
    { type: "stage.finished", seq: 7, at: AT, turnId: "t1", stage: "decompose", outcome: "ok" },
    { type: "llm.called", seq: 8, at: AT, turnId: "t1", job: "decompose", model: "fake", latencyMs: 12, ok: true },
    { type: "evidence.added", seq: 9, at: AT, turnId: "t1", evidence: ev1 },
    { type: "evidence.added", seq: 10, at: AT, turnId: "t1", evidence: ev2 },
    { type: "evidence.updated", seq: 11, at: AT, turnId: "t1", id: "e2", clusterId: "k1" },
    { type: "evidence.cites", seq: 12, at: AT, turnId: "t1", from: "e2", to: "e1" },
    { type: "stance.added", seq: 13, at: AT, turnId: "t1", stance },
    {
      type: "verdict.updated",
      seq: 14,
      at: AT,
      turnId: "t1",
      verdict: { claimId: "c1", verdict: "false", basis: ["s1"], rule: "single-A-refute", updatedAt: AT },
    },
    {
      type: "overall.updated",
      seq: 15,
      at: AT,
      turnId: "t1",
      overall: { verdictType: "false", contested: false, score: 80, breakdown: [{ key: "coverage", label: "覆盖", value: 80 }] },
    },
    { type: "frontier.added", seq: 16, at: AT, turnId: "t1", pivots: [pivot] },
    {
      type: "investigator.step",
      seq: 17,
      at: AT,
      turnId: "t1",
      n: 1,
      role: "main",
      goal: "找原始来源",
      gap: "缺官方口径",
      action: { kind: "fetch", target: "https://www.gov.cn/a" },
      why: "expectedValue 3",
      result: "got e1",
      gain: 1,
    },
    { type: "frontier.consumed", seq: 18, at: AT, turnId: "t1", pivotId: "p1" },
    { type: "investigator.stopped", seq: 19, at: AT, turnId: "t1", reason: "resolved", role: "main" },
    {
      type: "report.finalized",
      seq: 20,
      at: AT,
      turnId: "t1",
      report: {
        conclusion: "A 没有发生。",
        claimItems: [{ claimId: "c1", line: "A 没有发生。[1]", citations: [1] }],
        citations: [{ n: 1, evidenceId: "e1" }],
        finalizedAt: AT,
      },
    },
    { type: "error", seq: 21, at: AT, turnId: "t1", message: "ignored noise", stage: "retrieve" },
    { type: "turn.finished", seq: 22, at: AT, turnId: "t1", reason: "done" },
  ];
}

// ponytail: LCG is enough for reproducible sequences; use a stronger PRNG if tests need better mixing.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function generateSequence(rng: () => number, length: number): CaseEvent[] {
  const events: CaseEvent[] = [];
  let seq = 0;
  const stamp = (): { seq: number; at: string } => {
    seq += 1;
    return { seq, at: new Date(Date.parse(AT) + seq * 1000).toISOString() };
  };

  events.push({ type: "case.created", ...stamp(), id: `case-${Math.floor(rng() * 1e9)}`, text: "随机原句" });

  const claims: Claim[] = [];
  const evidence: Evidence[] = [];
  const stances: Stance[] = [];
  const frontier: Pivot[] = [];
  let nClaim = 0;
  let nEv = 0;
  let nStance = 0;
  let nPivot = 0;
  let nMsg = 0;
  let nInv = 0;

  const droppable = (): Claim[] => claims.filter((claim) => !stances.some((s) => s.claimId === claim.id));

  const kinds = (): CaseEvent["type"][] => {
    const list: CaseEvent["type"][] = [
      "message.added",
      "turn.started",
      "turn.finished",
      "stage.started",
      "stage.finished",
      "claims.added",
      "evidence.added",
      "overall.updated",
      "frontier.added",
      "investigator.step",
      "investigator.stopped",
      "llm.called",
      "error",
    ];
    if (droppable().length > 0) list.push("claims.dropped");
    if (claims.length > 0) list.push("verdict.updated", "report.finalized");
    if (evidence.length > 0) list.push("evidence.updated");
    if (evidence.length >= 2) list.push("evidence.cites");
    if (claims.length > 0 && evidence.length > 0) list.push("stance.added");
    if (frontier.length > 0) list.push("frontier.consumed");
    return list;
  };

  while (events.length < length) {
    const type = pick(rng, kinds());
    const meta = stamp();
    switch (type) {
      case "message.added": {
        nMsg += 1;
        events.push({
          type,
          ...meta,
          message: {
            id: `m${nMsg}`,
            role: pick(rng, ["user", "assistant"] as const),
            text: "追问",
            at: meta.at,
            ...(rng() < 0.3
              ? { route: pick(rng, ["new_claim", "pursue_frontier", "ask_case", "challenge", "off_topic"] as const) }
              : {}),
          },
        });
        break;
      }
      case "turn.started":
        events.push({ type, ...meta, turnId: `t${seq}` });
        break;
      case "turn.finished":
        events.push({
          type,
          ...meta,
          turnId: `t${seq}`,
          reason: pick(rng, ["done", "timeout", "aborted", "error"] as const),
        });
        break;
      case "stage.started":
        events.push({
          type,
          ...meta,
          stage: pick(rng, ["decompose", "retrieve", "assess", "investigate", "compose", "finalize"]),
          ...(rng() < 0.3 && claims[0] ? { claimId: claims[0].id } : {}),
        });
        break;
      case "stage.finished":
        events.push({
          type,
          ...meta,
          stage: pick(rng, ["decompose", "retrieve", "assess"]),
          outcome: pick(rng, ["ok", "failed-open", "skipped"] as const),
        });
        break;
      case "claims.added": {
        nClaim += 1;
        const claim: Claim = {
          id: `c${nClaim}`,
          text: `命题${nClaim}`,
          type: pick(rng, CLAIM_TYPES),
          checkable: rng() < 0.7,
          order: nClaim - 1,
          ...(rng() < 0.2 ? { span: { start: 0, end: 4 } } : {}),
        };
        claims.push(claim);
        events.push({ type, ...meta, claims: [claim] });
        break;
      }
      case "claims.dropped": {
        const claim = pick(rng, droppable());
        claims.splice(claims.indexOf(claim), 1);
        events.push({ type, ...meta, claimIds: [claim.id], reason: "self-proof" });
        break;
      }
      case "evidence.added": {
        nEv += 1;
        const provenances: Provenance[] = [
          { kind: "search", query: `q${nEv}` },
          { kind: "user" },
          { kind: "memory" },
          { kind: "reverse-image", imageUrl: "https://img.example/x.png" },
        ];
        if (evidence[0] && frontier[0]) {
          provenances.push({ kind: "pivot", fromEvidenceId: evidence[0].id, pivotId: frontier[0].id });
        }
        const item: Evidence = {
          id: `e${nEv}`,
          url: `https://host${nEv}.example/p`,
          canonicalUrl: `https://host${nEv}.example/p`,
          host: `host${nEv}.example`,
          excerpt: "摘",
          retrievedAt: meta.at,
          tier: pick(rng, ["A", "B", "C", "unknown"] as const),
          provenance: pick(rng, provenances),
        };
        evidence.push(item);
        events.push({ type, ...meta, evidence: item });
        break;
      }
      case "evidence.updated": {
        const item = pick(rng, evidence);
        events.push({ type, ...meta, id: item.id, clusterId: `k${item.id}` });
        break;
      }
      case "evidence.cites": {
        const from = pick(rng, evidence);
        const to = pick(
          rng,
          evidence.filter((item) => item.id !== from.id),
        );
        events.push({ type, ...meta, from: from.id, to: to.id });
        break;
      }
      case "stance.added": {
        nStance += 1;
        const stance: Stance = {
          id: `s${nStance}`,
          claimId: pick(rng, claims).id,
          evidenceId: pick(rng, evidence).id,
          stance: pick(rng, ["supports", "refutes", "partial", "contextual"] as const),
          quote: "摘",
          confidence: rng(),
          quoteFidelity: rng() < 0.8,
          by: pick(rng, ["main", "prosecutor", "defender"] as const),
        };
        stances.push(stance);
        events.push({ type, ...meta, stance });
        break;
      }
      case "verdict.updated": {
        const usable = stances.filter(
          (s) =>
            claims.some((claim) => claim.id === s.claimId) &&
            evidence.some((item) => item.id === s.evidenceId && item.reachable !== false),
        );
        if (usable.length > 0 && rng() < 0.6) {
          const s = pick(rng, usable);
          events.push({
            type,
            ...meta,
            verdict: {
              claimId: s.claimId,
              verdict: pick(rng, ["true", "false", "partial"] as const),
              basis: [s.id],
              rule: "gen",
              updatedAt: meta.at,
            },
          });
        } else {
          events.push({
            type,
            ...meta,
            verdict: {
              claimId: pick(rng, claims).id,
              verdict: pick(rng, ["unverified", "contested"] as const),
              basis: [],
              rule: "gen",
              updatedAt: meta.at,
            },
          });
        }
        break;
      }
      case "overall.updated":
        events.push({
          type,
          ...meta,
          overall: {
            verdictType: pick(rng, ["true", "false", "mixed_misleading", "unverified"] as const),
            contested: rng() < 0.2,
            score: Math.floor(rng() * 101),
            breakdown: [{ key: "x", label: "x", value: 1 }],
          },
        });
        break;
      case "frontier.added": {
        nPivot += 1;
        const pivot: Pivot = {
          id: `p${nPivot}`,
          kind: pick(rng, ["link", "doc_number", "date", "image", "entity", "query"] as const),
          value: `v${nPivot}`,
          why: "下一跳",
          expectedValue: pick(rng, [1, 2, 3] as const),
          depth: Math.floor(rng() * 4),
          ...(evidence[0] ? { fromEvidenceId: evidence[0].id } : {}),
        };
        frontier.push(pivot);
        events.push({ type, ...meta, pivots: [pivot] });
        break;
      }
      case "frontier.consumed": {
        const pivot = pick(rng, frontier);
        frontier.splice(frontier.indexOf(pivot), 1);
        events.push({ type, ...meta, pivotId: pivot.id });
        break;
      }
      case "investigator.step": {
        nInv += 1;
        events.push({
          type,
          ...meta,
          n: nInv,
          role: pick(rng, ["main", "prosecutor", "defender"] as const),
          goal: "补证据",
          gap: "缺一手",
          action: { kind: pick(rng, ["search", "fetch", "reverse_image", "recall", "stop"] as const), target: "x" },
          why: "gen",
          result: "ok",
          gain: rng() < 0.5 ? 1 : 0,
        });
        break;
      }
      case "investigator.stopped":
        events.push({
          type,
          ...meta,
          reason: pick(rng, ["resolved", "budget", "no-gain", "time", "tool-failed"]),
          role: pick(rng, ["main", "prosecutor", "defender"] as const),
        });
        break;
      case "llm.called":
        events.push({
          type,
          ...meta,
          job: pick(rng, ["decompose", "stance", "route"]),
          model: "fake",
          latencyMs: Math.floor(rng() * 40),
          ok: rng() < 0.9,
        });
        break;
      case "report.finalized":
        events.push({
          type,
          ...meta,
          report: {
            conclusion: "结论。",
            claimItems: claims.map((claim) => ({
              claimId: claim.id,
              line: claim.text,
              citations: evidence[0] ? [1] : [],
            })),
            citations: evidence[0] ? [{ n: 1, evidenceId: evidence[0].id }] : [],
            finalizedAt: meta.at,
          },
        });
        break;
      case "error":
        events.push({ type, ...meta, message: "boom", stage: "retrieve" });
        break;
      default:
        break;
    }
  }
  return events;
}

describe("casefile", () => {
  it("reduce does not mutate inputs and is deterministic", () => {
    const { case: start } = createCase({ id: "case1", text: "原句", at: AT });
    const event: CaseEvent = {
      type: "claims.added",
      seq: 2,
      at: AT,
      claims: [sampleClaim("c1", 0)],
    };
    const caseBefore = structuredClone(start);
    const eventBefore = structuredClone(event);
    const first = reduce(start, event);
    const second = reduce(start, event);
    expect(start).toEqual(caseBefore);
    expect(event).toEqual(eventBefore);
    expect(first).toEqual(second);
    expect(first).not.toBe(start);
    expect(first.claims).not.toBe(start.claims);
    start.claims.push(sampleClaim("c-mut", 9));
    expect(first.claims.some((claim) => claim.id === "c-mut")).toBe(false);
  });

  it("replay equals stepwise reduce", () => {
    const events = fullCoverageSequence();
    let stepwise: Case = replay([]);
    for (const event of events) stepwise = reduce(stepwise, event);
    expect(replay(events)).toEqual(stepwise);
  });

  it("createCase replays to the same case", () => {
    const { case: created, events } = createCase({ id: "case1", text: "原句", at: AT });
    expect(replay(events)).toEqual(created);
  });

  it("200 seeded legal sequences satisfy invariants", () => {
    const rng = lcg(20260903);
    const sequences = [
      fullCoverageSequence(),
      ...Array.from({ length: 199 }, () => generateSequence(rng, 8 + Math.floor(rng() * 25))),
    ];
    expect(sequences).toHaveLength(200);
    for (const events of sequences) {
      for (const event of events) validateEvent(event);
      const folded = replay(events);
      expect(() => assertInvariants(folded)).not.toThrow();
    }
  });

  it("rejects evidence without http(s) url", () => {
    const folded = reduce(replay(createCase({ id: "case1", text: "原句", at: AT }).events), {
      type: "evidence.added",
      seq: 2,
      at: AT,
      evidence: sampleEvidence("e1", "ftp://files.example/a"),
    });
    expect(() => assertInvariants(folded)).toThrow(/url is not http\(s\)/);
  });

  it("rejects dangling stance", () => {
    const folded = reduce(replay(createCase({ id: "case1", text: "原句", at: AT }).events), {
      type: "stance.added",
      seq: 2,
      at: AT,
      stance: {
        id: "s1",
        claimId: "missing",
        evidenceId: "missing",
        stance: "supports",
        quote: "x",
        confidence: 1,
        quoteFidelity: true,
        by: "main",
      },
    });
    expect(() => assertInvariants(folded)).toThrow(/does not resolve/);
  });

  it("rejects true verdict with empty basis", () => {
    const created = replay(createCase({ id: "case1", text: "原句", at: AT }).events);
    const withClaim = reduce(created, {
      type: "claims.added",
      seq: 2,
      at: AT,
      claims: [sampleClaim("c1", 0)],
    });
    const folded = reduce(withClaim, {
      type: "verdict.updated",
      seq: 3,
      at: AT,
      verdict: { claimId: "c1", verdict: "true", basis: [], rule: "bad", updatedAt: AT },
    });
    expect(() => assertInvariants(folded)).toThrow(/basis is empty/);
  });

  it("rejects self-loop cite", () => {
    const created = replay(createCase({ id: "case1", text: "原句", at: AT }).events);
    const withEvidence = reduce(created, {
      type: "evidence.added",
      seq: 2,
      at: AT,
      evidence: sampleEvidence("e1", "https://example.com/a"),
    });
    const folded = reduce(withEvidence, {
      type: "evidence.cites",
      seq: 3,
      at: AT,
      from: "e1",
      to: "e1",
    });
    expect(() => assertInvariants(folded)).toThrow(/self-loop/);
  });

  it("serialize then deserialize roundtrips", () => {
    const folded = replay(fullCoverageSequence());
    expect(deserialize(serialize(folded))).toEqual(folded);
  });

  it("validateEvent throws with instance path", () => {
    expect(() => validateEvent({ type: "case.created", seq: 1 })).toThrow(/\//);
  });

  it("production sources do not import node builtins", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    const banned =
      /\bfrom\s+['"](?:node:|fs|path|crypto|os|url|http|https|stream|buffer|util|assert|events|module)(?:\/|['"])/;
    for (const name of files) {
      const src = readFileSync(join(dir, name), "utf8");
      expect(src, name).not.toMatch(banned);
    }
  });
});
