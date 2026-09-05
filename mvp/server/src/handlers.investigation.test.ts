import { describe, expect, it } from "vitest";
import {
  interruptedInvestigationSnapshot,
} from "./handlers.js";
import {
  buildInvestigationSnapshot,
  validateInvestigationSnapshot,
} from "./lib/investigation/index.js";

/**
 * Issue #51：中断帧保留已真实获得的 claims/sources/gaps，不补造 conclusion。
 */
describe("interruptedInvestigationSnapshot", () => {
  it("从最新帧构造：phase=interrupted、无 conclusion、进行中命题标 interrupted", () => {
    const last = buildInvestigationSnapshot(
      {
        originalClaim: "某说法",
        phase: "judging",
        claimAtoms: ["命题A", "命题B"],
        atomSearchBundle: {
          atomsSearched: ["命题A"],
          byAtomKey: { 命题A: [{ url: "https://t.test/a", title: "a", snippet: "s" }] },
        },
        subclaimVerdicts: [
          {
            claimAtom: "命题A",
            verdict: "unverified",
            evidence: "e",
            supportingSources: [{ url: "https://t.test/a", title: "a", snippet: "s" }],
            contradictingSources: [],
            evidenceGaps: ["待补证"],
          },
        ],
      },
      { claimAtomKeyFn: (s) => s.trim() }
    );
    const interrupted = interruptedInvestigationSnapshot(last, "某说法");
    expect(interrupted.phase).toBe("interrupted");
    expect(interrupted.conclusion).toBeUndefined();
    expect(interrupted.claims[0]!.progress).toBe("interrupted");
    expect(interrupted.claims[0]!.gaps.length).toBe(1);
    expect(interrupted.claims[1]!.progress).toBe("interrupted");
    expect(interrupted.claims[1]!.judgment).toBeNull();
    expect(interrupted.sources.length).toBe(1);
    validateInvestigationSnapshot(interrupted);
  });

  it("无历史帧：最小诚实空帧", () => {
    const interrupted = interruptedInvestigationSnapshot(undefined, "另一句");
    expect(interrupted).toEqual({
      schemaVersion: 1,
      originalClaim: "另一句",
      phase: "interrupted",
      claims: [],
      sources: [],
      conflicts: [],
    });
    validateInvestigationSnapshot(interrupted);
  });

  it("已完成帧被打断时剥掉 conclusion（不冒充未发生的结论）", () => {
    const complete = buildInvestigationSnapshot(
      {
        originalClaim: "x",
        phase: "complete",
        claimAtoms: ["x"],
        subclaimVerdicts: [
          { claimAtom: "x", verdict: "unverified", evidence: "", supportingSources: [], contradictingSources: [], evidenceGaps: [] },
        ],
        report: { conclusion: "c", verdictType: "unverified" },
      },
      { claimAtomKeyFn: (s) => s.trim() }
    );
    const interrupted = interruptedInvestigationSnapshot(complete, "x");
    expect(interrupted.conclusion).toBeUndefined();
    expect(interrupted.phase).toBe("interrupted");
  });
});
