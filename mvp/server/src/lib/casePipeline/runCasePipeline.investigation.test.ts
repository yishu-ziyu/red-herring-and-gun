import { describe, expect, it, vi } from "vitest";
import { runCasePipeline } from "./runCasePipeline";
import type { PipelineStep } from "./runCasePipeline";
import {
  assertInvestigationInvariants,
  validateInvestigationSnapshot,
} from "../investigation/index.js";

/**
 * Issue #51 契约验收（生产接线）：
 * runCasePipeline 在语义里程碑发完整 InvestigationSnapshotV1；
 * 完成态 finalReport.investigation 与最后一帧一致；
 * unassessed 只出现在检索返回后、核查前的暂态。
 */
describe("runCasePipeline investigation snapshots", () => {
  const ATOM_TRUE = "某款电芯会自燃";
  const ATOM_FALSE = "厂商已召回该批次";
  const ATOM_CONFLICT = "召回范围覆盖全部批次";
  const ATOM_VALUE = "这次召回很让人失望";

  const SUPPORT_URL = "https://t.test/support";
  const REFUTE_URL = "https://t.test/refute";
  const CONFLICT_SUPPORT_URL = "https://t.test/c-support";
  const CONFLICT_REFUTE_URL = "https://t.test/c-refute";

  const trueSources = [{ url: SUPPORT_URL, title: "检测报告", snippet: "热失控复现" }];
  const falseSources = [{ url: REFUTE_URL, title: "官方公告", snippet: "未发布召回" }];
  const conflictSources = [
    { url: CONFLICT_SUPPORT_URL, title: "地方试点通知", snippet: "试点覆盖全部批次" },
    { url: CONFLICT_REFUTE_URL, title: "全国口径查证", snippet: "无全国统一要求" },
  ];

  const factVerdicts = [
    {
      claimAtom: ATOM_TRUE,
      verdict: "true",
      evidence: "检测报告显示热失控可复现[1]。",
      boundary: "样本为实验室条件",
      supportingSources: trueSources,
      contradictingSources: [],
      evidenceGaps: [],
    },
    {
      claimAtom: ATOM_FALSE,
      verdict: "false",
      evidence: "官方公告未发布召回[1]。",
      boundary: "",
      supportingSources: [],
      contradictingSources: falseSources,
      evidenceGaps: [],
    },
    {
      claimAtom: ATOM_CONFLICT,
      verdict: "unverified",
      evidence: "试点通知与全国口径并存。",
      boundary: "",
      supportingSources: [conflictSources[0]],
      contradictingSources: [conflictSources[1]],
      evidenceGaps: [],
    },
  ];

  it("里程碑序列 + 完成态快照 + unassessed 暂态", async () => {
    const frames: unknown[] = [];
    const phases: string[] = [];

    const searchOne = vi.fn(async (atom: string) => ({
      answer: atom,
      model: "m",
      sources:
        atom === ATOM_TRUE ? trueSources : atom === ATOM_FALSE ? falseSources : conflictSources,
    }));

    const runAgent = vi.fn(async (agentId: string, _steps: PipelineStep[]): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: [ATOM_TRUE, ATOM_FALSE, ATOM_CONFLICT, ATOM_VALUE],
            claimAtomTypes: [
              { text: ATOM_TRUE, verifiable: true, type: "fact" },
              { text: ATOM_FALSE, verifiable: true, type: "fact" },
              { text: ATOM_CONFLICT, verifiable: true, type: "fact" },
              { text: ATOM_VALUE, verifiable: false, type: "value" },
            ],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: { factCheckResult: "partial", subclaimVerdicts: factVerdicts },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      if (agentId === "report_composer") {
        return {
          agent: "report_composer",
          output: {
            verdictType: "mixed_misleading",
            conclusion: "自燃有依据；召回说反了；召回范围两说并存。",
            subclaimVerdicts: factVerdicts,
          },
        };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "某款电芯会自燃，并且厂商已召回该批次，召回范围覆盖全部批次，这次召回很让人失望。",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: {
          results: [
            { atom: ATOM_TRUE, supported: true, reason: "原句直说" },
            { atom: ATOM_FALSE, supported: true, reason: "原句直说" },
            { atom: ATOM_CONFLICT, supported: true, reason: "原句直说" },
            { atom: ATOM_VALUE, supported: true, reason: "立场保留" },
          ],
        },
        model: "selfproof-m",
      }),
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: {
        liveness: new Map([
          [SUPPORT_URL, "alive"],
          [REFUTE_URL, "alive"],
          [CONFLICT_SUPPORT_URL, "alive"],
          [CONFLICT_REFUTE_URL, "alive"],
        ]),
      },
      hooks: {
        searchMode: "sequential",
        onInvestigationSnapshot: (snapshot) => {
          frames.push(snapshot);
          phases.push(snapshot.phase);
        },
      },
    });

    expect(phases[0]).toBe("received");
    expect(phases[1]).toBe("decomposed");
    // 三条可核查原子各一次「检索开始」，随后一次「检索返回」
    expect(phases.slice(2, 6)).toEqual([
      "investigating",
      "investigating",
      "investigating",
      "investigating",
    ]);
    expect(phases.slice(6)).toEqual(["judging", "judging", "judging", "complete"]);

    // 检索返回帧：来源 unassessed（尚未核查）
    const investigatingFrame = frames[5] as Awaited<ReturnType<typeof validateInvestigationSnapshot>>;
    const investigatingClaims = investigatingFrame.claims.filter(
      (c) => c.checkability === "checkable"
    );
    expect(investigatingClaims.length).toBe(3);
    for (const claim of investigatingClaims) {
      const roles = claim.evidence.map((l) => l.role);
      expect(roles.length).toBeGreaterThan(0);
      expect(roles.every((r) => r === "unassessed")).toBe(true);
      expect(claim.judgment).toBeNull();
    }

    // 完成帧：schema 通过、不变量通过、无 unassessed、结论与冲突如实
    const completeFrame = frames[frames.length - 1]! as Awaited<
      ReturnType<typeof validateInvestigationSnapshot>
    >;
    validateInvestigationSnapshot(completeFrame);
    assertInvestigationInvariants(completeFrame);
    expect(completeFrame.schemaVersion).toBe(1);
    const judgments = new Map(completeFrame.claims.map((c) => [c.text, c.judgment]));
    expect(judgments.get(ATOM_TRUE)).toBe("supported");
    expect(judgments.get(ATOM_FALSE)).toBe("refuted");
    expect(judgments.get(ATOM_CONFLICT)).toBe("unresolved");
    expect(judgments.get(ATOM_VALUE)).toBe("not-applicable");
    for (const claim of completeFrame.claims) {
      expect(claim.evidence.map((l) => l.role)).not.toContain("unassessed");
    }
    expect(completeFrame.conclusion?.directAnswer).toContain("自燃有依据");
    expect(completeFrame.conclusion?.judgment).toBe("mixed");
    // 双方证据并存 → 冲突存在；质询未接入 → 原因如实 unknown
    expect(completeFrame.conflicts.length).toBe(1);
    expect(completeFrame.conflicts[0]!.claimId).toBe(
      completeFrame.claims.find((c) => c.text === ATOM_CONFLICT)!.id
    );
    expect(completeFrame.conflicts[0]!.reasonStatus).toBe("unknown");
    expect(completeFrame.conflicts[0]!.reason).toBeUndefined();
    // 立场条不发起检索，不进冲突
    const valueClaim = completeFrame.claims.find((c) => c.text === ATOM_VALUE)!;
    expect(valueClaim.evidence).toEqual([]);

    // 完成态 finalReport.investigation 与最后一帧一致
    expect(result.finalReport.investigation).toEqual(completeFrame);
    expect(result.reportStep.output).toBe(result.finalReport);
  });

  it("拆题失败 fail-open：快照仍按整句可核查继续", async () => {
    const phases: string[] = [];
    const searchOne = vi.fn(async () => ({ answer: "", model: "m", sources: [] }));
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") throw new Error("拆题服务未完成");
      if (agentId === "fact_checker") {
        return { agent: "fact_checker", output: { factCheckResult: "unverified", subclaimVerdicts: [] } };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "unverified" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });
    const result = await runCasePipeline({
      claim: "整句按可核查继续检索",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({ output: { results: [] }, model: "m" }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "unverified", conclusion: "公开材料还撑不住。" },
      }),
      hooks: {
        searchMode: "sequential",
        onInvestigationSnapshot: (snapshot) => phases.push(snapshot.phase),
      },
    });
    expect(phases).toContain("decomposed");
    expect(phases[phases.length - 1]).toBe("complete");
    const snapshot = validateInvestigationSnapshot(result.finalReport.investigation);
    assertInvestigationInvariants(snapshot);
    expect(snapshot.claims[0]!.text).toContain("整句按可核查继续检索");
    expect(snapshot.claims[0]!.judgment).toBe("unresolved");
  });
});
