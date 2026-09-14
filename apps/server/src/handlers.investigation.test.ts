import { describe, expect, it } from "vitest";
import {
  interruptedInvestigationSnapshot,
} from "./handlers.js";
import {
  buildInvestigationSnapshot,
  validateInvestigationSnapshot,
} from "./lib/investigation/index.js";

/**
 * Issue #51：中断帧保留已真实获得的 claims/sources/gaps。
 * 已有 conclusion 留下；分条判断齐了才拼有界总答，未齐则不补造。
 */
describe("interruptedInvestigationSnapshot", () => {
  it("从最新帧构造：phase=interrupted、未齐判断则无 conclusion、进行中命题标 interrupted", () => {
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

  it("已有 conclusion 的帧被打断时保留 conclusion，不把已写成的总答清掉", () => {
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
    expect(interrupted.conclusion?.directAnswer).toBe(complete.conclusion?.directAnswer);
    expect(interrupted.conclusion).toEqual(complete.conclusion);
    expect(interrupted.phase).toBe("interrupted");
  });

  it("无 conclusion 但每条可核查命题都有判断：拼出对原句的有界总答", () => {
    const last = buildInvestigationSnapshot(
      {
        originalClaim: "低钠盐能预防中风，肾病患者也能吃。",
        phase: "judging",
        claimAtoms: ["低钠盐能预防中风", "肾病患者也能吃"],
        subclaimVerdicts: [
          {
            claimAtom: "低钠盐能预防中风",
            verdict: "partial",
            evidence: "试验显示降钠有益，但不能推出全民就能预防中风。",
            supportingSources: [{ url: "https://t.test/a", title: "a", snippet: "s" }],
            contradictingSources: [{ url: "https://t.test/b", title: "b", snippet: "t" }],
            evidenceGaps: [],
          },
          {
            claimAtom: "肾病患者也能吃",
            verdict: "false",
            evidence: "肾病是低钠盐禁忌。",
            supportingSources: [],
            contradictingSources: [{ url: "https://t.test/c", title: "c", snippet: "u" }],
            evidenceGaps: [],
          },
        ],
      },
      { claimAtomKeyFn: (s) => s.trim() }
    );
    expect(last.conclusion).toBeUndefined();
    expect(last.claims.every((row) => row.judgment != null)).toBe(true);
    const interrupted = interruptedInvestigationSnapshot(last, "低钠盐能预防中风，肾病患者也能吃。");
    expect(interrupted.phase).toBe("interrupted");
    expect(interrupted.conclusion?.directAnswer).toContain("低钠盐能预防中风");
    expect(interrupted.conclusion?.directAnswer).toContain("肾病患者也能吃");
    expect(interrupted.conclusion?.directAnswer).toMatch(/站得住|站不住|有对有错/);
    expect(interrupted.conclusion?.judgment).toBe("mixed");
    expect(interrupted.claims.every((row) => row.progress === "interrupted")).toBe(true);
    validateInvestigationSnapshot(interrupted);
  });
});
