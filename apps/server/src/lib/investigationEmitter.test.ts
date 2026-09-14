import { describe, expect, it } from "vitest";
import { createInvestigationEmitter } from "./investigationEmitter.js";
import { buildInvestigationSnapshot } from "./investigation/index.js";
import type { InvestigationSnapshotV1 } from "./investigation/index.js";

const keyFn = (s: string) => s.trim();
const ATOM = "微波炉加热食物会致癌";
const URL_A = "https://example.org/microwave";

function snapshot(phase: InvestigationSnapshotV1["phase"], withSource = false): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: ATOM,
      phase,
      claimAtoms: [ATOM],
      claimAtomTypes: [{ text: ATOM, verifiable: true, type: "causal" }],
      atomSearchBundle: {
        atomsSearched: [ATOM],
        byAtomKey: { [ATOM]: withSource ? [{ url: URL_A, title: "国家标准说明", snippet: "不涉及致癌" }] : [] },
      },
      subclaimVerdicts:
        phase === "received" || phase === "decomposed"
          ? []
          : [
              {
                claimAtom: ATOM,
                verdict: "unverified",
                evidence: "",
                boundary: "",
                supportingSources: withSource ? [{ url: URL_A, title: "国家标准说明", snippet: "不涉及致癌" }] : [],
                contradictingSources: [],
                evidenceGaps: [],
              },
            ],
      report: phase === "complete" ? { conclusion: "没有这回事。", verdictType: "unverified" } : undefined,
    },
    { claimAtomKeyFn: keyFn }
  );
}

function harness() {
  const frames: Record<string, unknown>[] = [];
  const emitter = createInvestigationEmitter({
    runId: "run-fixed",
    send: (event) => frames.push(event),
    now: () => new Date("2026-09-11T10:00:00.000Z"),
    timestamp: () => 1_760_000_000_000,
  });
  return { frames, emitter };
}

describe("C12 快照先落、活动后发", () => {
  it("每条活动都排在同一 revision 快照之后", () => {
    const { frames, emitter } = harness();
    emitter.emitSnapshot(snapshot("decomposed"));
    emitter.emitSearchStarted(ATOM);
    emitter.emitSnapshot(snapshot("investigating", true));

    const kinds = frames.map((frame) => frame.type);
    expect(kinds[0]).toBe("investigation_snapshot");
    expect(kinds).toContain("investigation_activity");

    // 每一条活动前面至少出现过一份快照
    const firstSnapshot = kinds.indexOf("investigation_snapshot");
    const firstActivity = kinds.indexOf("investigation_activity");
    expect(firstSnapshot).toBeGreaterThanOrEqual(0);
    expect(firstActivity).toBeGreaterThan(firstSnapshot);
  });

  it("动作事件没有可归属对象", () => {
    const { frames, emitter } = harness();
    emitter.emitSearchStarted(ATOM);
    const activity = frames[0]!.activity as { kind: string; claimIds: string[]; sourceIds: string[] };
    expect(activity.kind).toBe("search_started");
    expect(activity.claimIds).toEqual([]);
    expect(activity.sourceIds).toEqual([]);
  });

  it("同一份快照重发不产生新活动", () => {
    const { frames, emitter } = harness();
    const same = snapshot("investigating", true);
    emitter.emitSnapshot(same);
    const afterFirst = frames.length;
    emitter.emitSnapshot(same);
    expect(frames.length - afterFirst).toBe(1); // 只多了一份快照帧
    expect(emitter.activities().length).toBeGreaterThan(0);
  });

  it("活动帧不携带供应商字段或密钥", () => {
    const { frames, emitter } = harness();
    emitter.emitSnapshot(snapshot("decomposed"));
    emitter.emitSearchStarted(ATOM);
    const activityFrames = frames.filter((frame) => frame.type === "investigation_activity");
    const dumped = JSON.stringify(activityFrames);
    for (const forbidden of ["providerErrors", "systemPrompt", "apiKey", "agent_thought", "traceText"]) {
      expect(dumped).not.toContain(forbidden);
    }
  });
});

describe("命中知识库的活动行（Part 1）", () => {
  it("发出 knowledge_hit：动作类（引用留空）、日期走 payload、角色是 source", () => {
    const { frames, emitter } = harness();
    emitter.emitKnowledgeHit("2026-09-11");

    const frame = frames.find((item) => item.type === "investigation_activity")!;
    const activity = frame.activity as {
      kind: string;
      role: string;
      claimIds: string[];
      sourceIds: string[];
      payload: Record<string, string>;
    };
    expect(activity.kind).toBe("knowledge_hit");
    expect(activity.role).toBe("source");
    expect(activity.claimIds).toEqual([]);
    expect(activity.sourceIds).toEqual([]);
    expect(activity.payload).toEqual({ originDate: "2026-09-11" });
  });

  it("没有日期不发（不编一个日期出来）", () => {
    const { frames, emitter } = harness();
    emitter.emitKnowledgeHit("");
    expect(frames).toEqual([]);
  });

  it("发出 prior_round_reuse：动作类、引用留空；没有日期也发（不编日期）", () => {
    const { frames, emitter } = harness();
    emitter.emitPriorRoundReuse("");
    const activity = (frames.find((item) => item.type === "investigation_activity") as {
      activity: { kind: string; payload: Record<string, string>; claimIds: string[] };
    }).activity;
    expect(activity.kind).toBe("prior_round_reuse");
    expect(activity.claimIds).toEqual([]);
    expect(activity.payload).toEqual({});
  });
});
