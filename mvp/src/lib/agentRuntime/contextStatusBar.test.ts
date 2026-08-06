import { describe, expect, it } from "vitest";
import { buildAgentStatusBar } from "./contextStatusBar";
import { formatSkillsForPrompt, selectAgentSkills } from "./agentSkills";
import { reviewAndRepairReport } from "./reportReviewer";

describe("buildAgentStatusBar", () => {
  it("builds short stable prefix + dynamic fields", () => {
    const bar = buildAgentStatusBar({
      agentId: "fact_checker",
      agentName: "FactChecker",
      claim: "隔夜菜会致癌吗",
      claimType: "causal",
      stepIndex: 2,
      totalStepsHint: 4,
      tools: [{ id: "search360", name: "360 Search" }],
      memoryHitCount: 1,
      acceptedCandidateCount: 0,
      searchReady: true,
      now: new Date("2026-08-06T10:30:00+08:00"),
    });

    expect(bar.prefix).toContain("role=FactChecker(fact_checker)");
    expect(bar.dynamic).toContain("claimType=causal");
    expect(bar.dynamic).toContain("memoryHits=1");
    expect(bar.dynamic).toContain("searchReady=yes");
    expect(bar.fields.toolCount).toBe(1);
  });
});

describe("selectAgentSkills", () => {
  it("loads agent-specific + safety skill", () => {
    const skills = selectAgentSkills({ agentId: "rumor_detector" });
    expect(skills.some((s) => s.id === "skill.claim-atom-triage")).toBe(true);
    expect(skills.some((s) => s.id === "skill.no-prompt-injection")).toBe(true);
    expect(formatSkillsForPrompt(skills)).toContain("On-demand Skills");
  });

  it("loads causal skill only when claimType matches", () => {
    const causal = selectAgentSkills({
      agentId: "report_composer",
      claimType: "causal",
      maxSkills: 4,
    });
    expect(causal.some((s) => s.id === "skill.causal-boundary")).toBe(true);

    const nonCausal = selectAgentSkills({
      agentId: "report_composer",
      claimType: "event",
      maxSkills: 4,
    });
    expect(nonCausal.some((s) => s.id === "skill.causal-boundary")).toBe(false);
  });
});

describe("reviewAndRepairReport", () => {
  it("fails thin report and repairs required fields", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "maybe",
        conclusion: "ok",
        credibilityScore: 999,
      },
      { claim: "测试命题" }
    );

    expect(result.passed).toBe(false);
    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.repaired.credibilityScore).toBe(50);
    expect(Array.isArray(result.repaired.evidenceChain)).toBe(true);
    expect((result.repaired.evidenceChain as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(result.repaired.canSay)).toBe(true);
    expect(Array.isArray(result.repaired.cannotSay)).toBe(true);
    expect(Array.isArray(result.repaired.closureActions)).toBe(true);
  });

  it("passes a complete report", () => {
    const result = reviewAndRepairReport({
      verdictType: "mixed_misleading",
      conclusion: "存在夸大，核心事实部分成立。",
      credibilityScore: 42,
      summaryForPublic: "该说法有夸大成分。",
      recommendation: "勿二次传播未经核实细节。",
      canSay: ["可说存在夸大"],
      cannotSay: ["不能说完全虚假"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability", score: 50 },
        { dimension: "evidence_completeness", score: 40 },
        { dimension: "consistency", score: 60 },
        { dimension: "recency", score: 55 },
        { dimension: "authority", score: 45 },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
    });

    expect(result.passed).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("downgrades overclaim true when fact check is unverified", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "true",
        conclusion: "完全正确。",
        credibilityScore: 90,
        canSay: ["可说属实"],
        cannotSay: ["无"],
        evidenceChain: [
          { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
          { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
          { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
        ],
        confidenceDimensions: [
          { dimension: "source_reliability" },
          { dimension: "evidence_completeness" },
          { dimension: "consistency" },
          { dimension: "recency" },
          { dimension: "authority" },
        ],
      },
      {
        previousOutputs: [{ factCheckResult: "unverified" }],
      }
    );

    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.issues.some((i) => i.code === "overclaim")).toBe(true);
  });
});
