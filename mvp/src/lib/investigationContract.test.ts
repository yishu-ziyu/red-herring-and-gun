import { describe, expect, it } from "vitest";
import {
  buildInvestigationSnapshot,
  assertInvestigationInvariants,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "@rhg/core/investigation";

/**
 * Issue #51 web 侧契约测试：前端经 `@rhg/core/investigation` 消费与 server
 * 完全相同的 versioned schema/type 与校验函数（不存在两份漂移 interface）。
 * #52 的 Golden Path UI 只依赖本契约 + 连接状态，不读 raw Agent/tool 事件。
 */
const CLAIM = "某市地铁昨天发生设备故障并全线停运。";
const ATOM_A = "某市地铁昨天发生设备故障";
const ATOM_B = "地铁全线停运持续到今天";

describe("web 消费 InvestigationSnapshotV1 契约", () => {
  it("生产形状数据可构建并通过 schema + 不变量校验", () => {
    const snapshot: InvestigationSnapshotV1 = buildInvestigationSnapshot({
      originalClaim: CLAIM,
      phase: "complete",
      claimAtoms: [ATOM_A, ATOM_B],
      claimAtomTypes: [
        { text: ATOM_A, verifiable: true, type: "fact" },
        { text: ATOM_B, verifiable: true, type: "fact" },
      ],
      atomSearchBundle: {
        atomsSearched: [ATOM_A, ATOM_B],
        byAtomKey: {
          [ATOM_A]: [{ url: "https://t.test/metro-notice", title: "运营公告", snippet: "设备故障部分停运" }],
          [ATOM_B]: [{ url: "https://t.test/metro-notice", title: "运营公告", snippet: "设备故障部分停运" }],
        },
      },
      subclaimVerdicts: [
        {
          claimAtom: ATOM_A,
          verdict: "true",
          evidence: "运营公告确认设备故障[1]。",
          boundary: "以公告发布时点为准",
          supportingSources: [{ url: "https://t.test/metro-notice", title: "运营公告", snippet: "设备故障部分停运" }],
          contradictingSources: [],
          evidenceGaps: [],
        },
        {
          claimAtom: ATOM_B,
          verdict: "unverified",
          evidence: "公告只提到部分停运。",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["待补证"],
        },
      ],
      report: {
        conclusion: "设备故障属实；全线停运的持续说法尚无依据。",
        verdictType: "mixed_misleading",
        citationSources: [{ url: "https://t.test/metro-notice", title: "运营公告", snippet: "" }],
        checkedAt: "2026-09-06T09:00:00.000Z",
      },
      checkedAt: "2026-09-06T09:00:00.000Z",
    });

    const validated = validateInvestigationSnapshot(snapshot);
    assertInvestigationInvariants(validated);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.phase).toBe("complete");
    expect(validated.claims[0]!.judgment).toBe("supported");
    expect(validated.claims[1]!.judgment).toBe("unresolved");
    expect(validated.conclusion?.directAnswer).toContain("设备故障属实");
    // 原句可对照：逐字命题保留真实 span
    expect(validated.claims[0]!.originalSpan).toEqual({
      start: CLAIM.indexOf(ATOM_A),
      end: CLAIM.indexOf(ATOM_A) + ATOM_A.length,
    });
  });

  it("中断帧可直接被前端消费", () => {
    const interrupted = validateInvestigationSnapshot({
      schemaVersion: 1,
      originalClaim: CLAIM,
      phase: "interrupted",
      claims: [],
      sources: [],
      conflicts: [],
    });
    expect(interrupted.conclusion).toBeUndefined();
  });
});
