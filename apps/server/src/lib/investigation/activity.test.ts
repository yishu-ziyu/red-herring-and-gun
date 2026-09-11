import { describe, expect, it } from "vitest";
import { buildInvestigationSnapshot } from "./build.js";
import {
  ACTIVITY_KINDS,
  ACTIVITY_PAYLOAD_KEYS,
  createActivityLog,
  isPublicActivity,
  sanitizeActivityPayload,
  validatePublicActivity,
} from "./activity.js";
import type { InvestigationSnapshotV1 } from "./schema.js";

const keyFn = (s: string) => s.replace(/\u3000/g, " ").trim();
const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });

const ATOM_A = "微波炉加热食物会致癌";
const URL_A = "https://example.org/microwave";
const URL_B = "https://example.net/retort";

function snapshot(input: {
  phase: InvestigationSnapshotV1["phase"];
  extraAtom?: string;
  support?: boolean;
  contradict?: boolean;
  judgment?: "supported" | "refuted" | null;
  gap?: boolean;
  conflict?: boolean;
  /** 有检索结果但还没判词：证据只能是 unassessed 暂态。 */
  noVerdict?: boolean;
}): InvestigationSnapshotV1 {
  const atoms = [ATOM_A, ...(input.extraAtom ? [input.extraAtom] : [])];
  // 判词只在核查开始后才存在：分解阶段还没判，不去造一份。
  const hasVerdict = !input.noVerdict && input.phase !== "received" && input.phase !== "decomposed";
  const verdicts = hasVerdict
    ? atoms.map((atom) => ({
    claimAtom: atom,
    verdict: input.judgment === "supported" ? "true" : input.judgment === "refuted" ? "false" : "unverified",
    evidence: "",
    boundary: "",
    supportingSources: input.support ? [src(URL_A, "国家标准说明", "不涉及致癌")] : [],
    contradictingSources: input.contradict ? [src(URL_B, "辟谣平台", "无此结论")] : [],
    evidenceGaps: input.gap ? ["没有找到针对该型号的实测数据"] : [],
    }))
    : [];
  const byAtomKey: Record<string, unknown[]> = {};
  for (const atom of atoms) {
    byAtomKey[atom] = [
      ...(input.support ? [src(URL_A, "国家标准说明", "不涉及致癌")] : []),
      ...(input.contradict ? [src(URL_B, "辟谣平台", "无此结论")] : []),
    ];
  }
  return buildInvestigationSnapshot(
    {
      originalClaim: "微波炉加热食物会致癌",
      phase: input.phase,
      claimAtoms: atoms,
      claimAtomTypes: atoms.map((text) => ({ text, verifiable: true, type: "causal" })),
      atomSearchBundle: { atomsSearched: atoms, byAtomKey },
      subclaimVerdicts: verdicts,
      crossExam: input.conflict
        ? { ran: true, atoms: [{ atom: ATOM_A, status: "answered", response: "分歧在适用范围" }] }
        : undefined,
      report:
        input.phase === "complete"
          ? { conclusion: "只涉及特定型号，不是全部微波炉。", verdictType: "unverified" }
          : undefined,
    },
    { claimAtomKeyFn: keyFn }
  );
}

const RUN = "run-fixed-1";
const log = () => createActivityLog({ runId: RUN, now: () => new Date("2026-09-11T10:00:00.000Z") });

function baseActivity(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: `${RUN}:1`,
    runId: RUN,
    seq: 1,
    occurredAt: "2026-09-11T10:00:00.000Z",
    kind: "search_started",
    role: "source",
    claimIds: [],
    sourceIds: [],
    snapshotRevision: 1,
    payload: { query: "微波炉致癌" },
    ...overrides,
  };
}

describe("PublicActivity 契约", () => {
  it("C7 拒绝未知 kind、version≠1、缺 seq、缺 runId", () => {
    const good = baseActivity();
    expect(isPublicActivity(good)).toBe(true);
    expect(isPublicActivity({ ...good, kind: "agent_thought" })).toBe(false);
    expect(isPublicActivity({ ...good, version: 2 })).toBe(false);
    expect(isPublicActivity({ ...good, seq: undefined })).toBe(false);
    expect(isPublicActivity({ ...good, runId: undefined })).toBe(false);
    expect(() => validatePublicActivity({ ...good, kind: "nope" })).toThrow();
  });

  it("C6 payload 白名单丢弃白名单外的键，值截断", () => {
    const payload = sanitizeActivityPayload("source_found", {
      title: "标准说明",
      domain: "example.org",
      rawProviderError: "ECONNREFUSED 10.0.0.1",
      agent_thought: "内部推理",
      systemPrompt: "你是核查员",
      apiKey: "sk-live-xxx",
      nested: { deep: "value" },
    });
    expect(Object.keys(payload).sort()).toEqual(["domain", "title"]);
    const long = sanitizeActivityPayload("claim_decomposed", { claimText: "字".repeat(500) });
    expect(long.claimText.length).toBe(160);
  });

  it("每个 kind 都有角色与 payload 白名单，且清单与 schema 一致", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(ACTIVITY_PAYLOAD_KEYS[kind].length).toBeGreaterThan(0);
      expect(isPublicActivity({ ...baseActivity(), kind })).toBe(true);
    }
    expect(Object.keys(ACTIVITY_PAYLOAD_KEYS).sort()).toEqual([...ACTIVITY_KINDS].sort());
  });
});

describe("ActivityLog 投影", () => {
  it("C1 快照差分产出对应的 kind", () => {
    const l = log();
    const s1 = snapshot({ phase: "decomposed" });
    expect(l.project(null, s1).map((a) => a.kind)).toEqual(["claim_decomposed"]);

    const s2 = snapshot({ phase: "investigating", support: true, noVerdict: true });
    expect(new Set(l.project(s1, s2).map((a) => a.kind))).toEqual(new Set(["source_found"]));

    const s3 = snapshot({ phase: "investigating", support: true, contradict: true });
    const kinds3 = new Set(l.project(s2, s3).map((a) => a.kind));
    expect(kinds3.has("source_checked")).toBe(true);
    expect(kinds3.has("conflict_detected")).toBe(true);
    expect(kinds3.has("evidence_assessed")).toBe(true);

    const s4 = snapshot({ phase: "judging", support: true, contradict: true, judgment: "refuted" });
    const revised = l.project(s3, s4);
    expect(revised.map((a) => a.kind)).toContain("judgment_revised");
    expect(revised[0]!.payload).toEqual({ from: "unresolved", to: "refuted" });

    const s5 = snapshot({ phase: "complete", support: true, contradict: true, judgment: "refuted" });
    expect(l.project(s4, s5).map((a) => a.kind)).toContain("run_completed");
  });

  it("C1 新缺口产出 gap_identified", () => {
    const l = log();
    const s1 = snapshot({ phase: "investigating", support: true });
    l.project(null, s1);
    const s2 = snapshot({ phase: "investigating", support: true, gap: true });
    expect(l.project(s1, s2).map((a) => a.kind)).toContain("gap_identified");
  });

  it("C2 seq 从 1 单调 +1；id = runId:seq，不含时间戳", () => {
    const l = log();
    l.project(null, snapshot({ phase: "decomposed" }));
    l.recordSearchStarted("微波炉致癌");
    const all = l.all();
    expect(all.map((a) => a.seq)).toEqual([1, 2]);
    expect(all[0]!.id).toBe(`${RUN}:1`);
    expect(all[1]!.id).toBe(`${RUN}:2`);
    for (const activity of all) {
      expect(activity.id).not.toContain("2026");
      expect(validatePublicActivity(activity)).toBe(activity);
    }
  });

  it("C2 同输入跨实例得到同一个 id 序列", () => {
    const a = log();
    const b = log();
    const s = snapshot({ phase: "decomposed" });
    expect(a.project(null, s).map((x) => x.id)).toEqual(b.project(null, s).map((x) => x.id));
  });

  it("C3 同一快照重复投影不产生新活动", () => {
    const l = log();
    const s = snapshot({ phase: "investigating", support: true, contradict: true });
    l.project(null, s);
    expect(l.project(s, s)).toEqual([]);
    expect(l.project(s, s)).toEqual([]);
    const before = l.all().length;
    // 同一内容的新对象（快照重建）也只按 key 去重，不重复发
    expect(l.project(s, snapshot({ phase: "investigating", support: true, contradict: true }))).toEqual([]);
    expect(l.all().length).toBe(before);
  });

  it("C4 活动引用的 claim/source 必须存在于同一 revision 的快照里", () => {
    const l = log();
    const s1 = snapshot({ phase: "decomposed" });
    l.project(null, s1);
    const s2 = snapshot({ phase: "investigating", support: true, contradict: true, gap: true });
    l.project(s1, s2);
    const claimIds = new Set(s2.claims.map((c) => c.id));
    const sourceIds = new Set(s2.sources.map((s) => s.id));
    expect(l.all().length).toBeGreaterThan(0);
    for (const activity of l.all()) {
      for (const id of activity.claimIds) expect(claimIds.has(id)).toBe(true);
      for (const id of activity.sourceIds) expect(sourceIds.has(id)).toBe(true);
    }
  });

  it("C5 没有可归属对象的事件只描述动作", () => {
    const l = log();
    const [event] = l.recordSearchStarted("微波炉致癌");
    expect(event!.claimIds).toEqual([]);
    expect(event!.sourceIds).toEqual([]);
    expect(event!.kind).toBe("search_started");
    expect(event!.payload.query).toBe("微波炉致癌");
  });

  it("C6 秘密与内部思考进不了任何活动字段", () => {
    const l = log();
    l.recordSearchStarted("微波炉致癌");
    l.project(null, snapshot({ phase: "investigating", support: true, contradict: true, gap: true }));
    l.project(null, snapshot({ phase: "complete", support: true, contradict: true, judgment: "refuted" }));
    const dump = JSON.stringify(l.all());
    for (const secret of ["sk-live", "systemPrompt", "agent_thought", "apiKey", "ECONNREFUSED", "thought"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("payload 值字段有上限、不塞整篇正文", () => {
    const l = log();
    l.project(null, snapshot({ phase: "decomposed" }));
    for (const activity of l.all()) {
      for (const value of Object.values(activity.payload)) {
        expect(value.length).toBeLessThanOrEqual(160);
      }
    }
  });
});
