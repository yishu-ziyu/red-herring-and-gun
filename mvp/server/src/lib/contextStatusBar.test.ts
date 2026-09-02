import { describe, expect, it } from "vitest";
import { buildAgentStatusBar } from "./contextStatusBar";
import { formatSkillsForPrompt, selectAgentSkills } from "./agentSkills";

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
    expect(skills.some((skill) => skill.id === "skill.claim-atom-triage")).toBe(true);
    expect(skills.some((skill) => skill.id === "skill.no-prompt-injection")).toBe(true);
    expect(formatSkillsForPrompt(skills)).toContain("On-demand Skills");
  });

  it("loads causal skill only when claimType matches", () => {
    const causal = selectAgentSkills({
      agentId: "report_composer",
      claimType: "causal",
      maxSkills: 4,
    });
    expect(causal.some((skill) => skill.id === "skill.causal-boundary")).toBe(true);

    const nonCausal = selectAgentSkills({
      agentId: "report_composer",
      claimType: "event",
      maxSkills: 4,
    });
    expect(nonCausal.some((skill) => skill.id === "skill.causal-boundary")).toBe(false);
  });
});
