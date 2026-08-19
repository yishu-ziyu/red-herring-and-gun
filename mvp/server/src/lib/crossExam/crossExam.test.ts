import { describe, expect, it, vi } from "vitest";
import {
  buildCrossExamUserContent,
  compareVerdicts,
  crossExamConfidenceAdjustment,
  findCrossExamTargets,
  makeSecondOpinionCall,
  parseSecondOpinion,
  runCrossExam,
  type CrossExamAtomResult,
} from "./crossExam";
import type { AtomSearchBundle, AtomSearchSource } from "../atomSearch";
import { claimAtomKey } from "../claimAtom/index.js";

function mkBundle(atoms: string[], byAtomKey: Record<string, AtomSearchSource[]>): AtomSearchBundle {
  return {
    atomsSearched: atoms,
    byAtomKey,
    aggregate: {
      answer: "",
      sources: [],
      relatedQuestions: [],
      model: "m",
      traceText: "",
      _source: "test",
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: [],
    },
    forAgent: atoms.map((a) => ({ claimAtom: a, sources: byAtomKey[claimAtomKey(a)] ?? [] })),
  };
}

const atom = "某说法既有支撑也有反证";

describe("findCrossExamTargets", () => {
  it("支撑与反证同时非空才触发，上限 2", () => {
    const bundle = mkBundle(["原子一", "原子二", "原子三"], {});
    const verdicts = [
      { claimAtom: "原子一", verdict: "true", supportingSources: [{ url: "a" }], contradictingSources: [{ url: "b" }] },
      { claimAtom: "原子二", verdict: "true", supportingSources: [{ url: "a" }] },
      { claimAtom: "原子三", verdict: "partial", supportingSources: [{ url: "a" }], contradictingSources: [{ url: "b" }] },
    ];
    const targets = findCrossExamTargets({ verdicts, bundle, claimAtomKeyFn: claimAtomKey });
    expect(targets.map((t) => t.atom)).toEqual(["原子一", "原子三"]);
  });

  it("判词带证据但 bundle 无该原子 → 仍触发（证据列表留空）", () => {
    const bundle = mkBundle([atom], {});
    const targets = findCrossExamTargets({
      verdicts: [
        { claimAtom: atom, verdict: "false", supportingSources: [{ url: "a" }], contradictingSources: [{ url: "b" }] },
      ],
      bundle,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].primaryVerdict).toBe("false");
  });
});

describe("parseSecondOpinion", () => {
  it("非法判词归 unverified（宁谨慎不站队）", () => {
    expect(parseSecondOpinion({ verdict: "definitely-true" }).verdict).toBe("unverified");
    expect(parseSecondOpinion({}).verdict).toBe("unverified");
    expect(parseSecondOpinion({ verdict: "false", reason: "官方通报否认" }).verdict).toBe("false");
  });
});

describe("compareVerdicts", () => {
  it("相同 → agree；相反 → disagree；第二意见 unverified → inconclusive", () => {
    expect(compareVerdicts("false", "false")).toBe("agree");
    expect(compareVerdicts("true", "false")).toBe("disagree");
    expect(compareVerdicts("false", "unverified")).toBe("inconclusive");
    // partial 主判词与确定第二意见不算硬分歧
    expect(compareVerdicts("partial", "false")).toBe("inconclusive");
  });
});

describe("crossExamConfidenceAdjustment", () => {
  it("每次分歧 -10 封顶 -20；一致为 0", () => {
    const mk = (relation: string): CrossExamAtomResult =>
      ({ atom: "a", primaryVerdict: "true", secondVerdict: "false", secondReason: "", secondModel: "m", relation }) as CrossExamAtomResult;
    expect(crossExamConfidenceAdjustment([mk("agree")])).toBe(0);
    expect(crossExamConfidenceAdjustment([mk("disagree")])).toBe(-10);
    expect(crossExamConfidenceAdjustment([mk("disagree"), mk("disagree"), mk("disagree")])).toBe(-20);
  });
});

describe("runCrossExam", () => {
  it("第二意见与主判一致 → agree、adjustment 0", async () => {
    const bundle = mkBundle([atom], {
      [claimAtomKey(atom)]: [
        { url: "https://s/1", title: "支撑", snippet: "支撑摘要" },
        { url: "https://c/1", title: "反证", snippet: "反证摘要" },
      ],
    });
    const targets = findCrossExamTargets({
      verdicts: [
        { claimAtom: atom, verdict: "false", supportingSources: [{ url: "https://s/1" }], contradictingSources: [{ url: "https://c/1" }] },
      ],
      bundle,
      claimAtomKeyFn: claimAtomKey,
    });
    const callRaw = vi.fn(async () => ({
      output: { verdict: "false", reason: "反证证据来自官方通报", boundary: "仅能支持局部表述" },
      model: "MiniMax-M3",
    }));
    const outcome = await runCrossExam({
      claim: "原句",
      targets,
      callSecondOpinion: makeSecondOpinionCall(callRaw),
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.atoms[0].relation).toBe("agree");
    expect(outcome.confidenceAdjustment).toBe(0);
    expect(outcome.model).toBe("MiniMax-M3");
    // 证据清单进入 prompt
    const userContent = callRaw.mock.calls[0][0].userContent;
    expect(userContent).toContain("支撑证据");
    expect(userContent).toContain("https://s/1");
  });

  it("第二意见分歧 → disagree、-10；失败 → inconclusive 不阻断", async () => {
    const bundle = mkBundle([atom, "原子二"], {});
    const targets = [
      { atom, atomKey: claimAtomKey(atom), primaryVerdict: "true", supporting: [], contradicting: [] },
      { atom: "原子二", atomKey: claimAtomKey("原子二"), primaryVerdict: "true", supporting: [], contradicting: [] },
    ] as ReturnType<typeof findCrossExamTargets>;
    let calls = 0;
    const callSecondOpinion = async () => {
      calls += 1;
      if (calls === 1) return { verdict: "false", reason: "证据相反", boundary: "", model: "m2" };
      throw new Error("quota");
    };
    const outcome = await runCrossExam({ claim: "原句", targets, callSecondOpinion });
    expect(outcome.atoms[0].relation).toBe("disagree");
    expect(outcome.atoms[1].relation).toBe("inconclusive");
    expect(outcome.atoms[1].secondReason).toContain("复核失败");
    expect(outcome.confidenceAdjustment).toBe(-10);
  });
});

describe("buildCrossExamUserContent", () => {
  it("含原句、待复核说法与两侧证据", () => {
    const content = buildCrossExamUserContent({
      claim: "原句X",
      target: {
        atom: "说法Y",
        atomKey: "k",
        primaryVerdict: "true",
        supporting: [{ url: "https://s", title: "S", snippet: "ss" }],
        contradicting: [],
      },
    });
    expect(content).toContain("原句：原句X");
    expect(content).toContain("待复核说法：说法Y");
    expect(content).toContain("https://s");
    expect(content).toContain("（无）");
  });
});
