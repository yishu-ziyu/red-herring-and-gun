import { describe, expect, it } from "vitest";
import { demoCase } from "../data/demoCase";
import {
  healthRumorCase,
  politicalRumorCase,
  techRumorCase,
} from "../data/rumorCases";
import { gradeAll } from "./graderRules";
import { composeReport } from "./reportComposer";
import {
  critiqueAndFixFactDeskDraft,
  scoreFactDeskDraft,
  writeFactDeskConclusion,
  writeFactDeskFromCase,
} from "./factDeskWriter";
import { aggregateInferences } from "./inferenceLicense";
import type { DemoCase } from "./schemas";

function runCase(caseData: DemoCase) {
  const grades = gradeAll(caseData.candidates, caseData.subclaims);
  const license = aggregateInferences(grades, caseData.subclaims);
  const desk = writeFactDeskFromCase(caseData, grades, license, {
    nextEvidenceNeeded: caseData.routes.flatMap((r) => r.neededEvidence).slice(0, 4),
  });
  const report = composeReport(caseData, grades);
  const score = scoreFactDeskDraft(desk, caseData.originalClaim);
  return { desk, report, score };
}

describe("factDeskWriter Prompt A + F", () => {
  it("strips drama diction in critique loop", () => {
    const fixed = critiqueAndFixFactDeskDraft(
      {
        lede: "这纯属捏造，令人啼笑皆非。",
        canSay: ["a"],
        cannotSay: ["b"],
        openQuestions: [],
        publicFacing: "作为人工智能我认为震惊全网。",
        researchMemo: "x",
        critiqueNotes: [],
      },
      { originalClaim: "测试", findings: [] },
    );
    expect(fixed.lede).not.toMatch(/纯属捏造|啼笑/);
    expect(fixed.publicFacing).not.toMatch(/作为人工智能|震惊全网/);
    expect(fixed.critiqueNotes.length).toBeGreaterThan(0);
  });

  it("writes a non-empty lede with claim framing", () => {
    const draft = writeFactDeskConclusion({
      originalClaim: "隔夜菜会致癌",
      findings: [
        {
          claimUnit: "亚硝酸盐是否危险",
          evidenceSummary: "国食安评估：正常储存远低于限量",
          sourceTitles: ["国家食品安全风险评估中心评估"],
          status: "contradict",
        },
      ],
      cannotSaySeed: ["不能说等于毒药"],
      nextEvidenceNeeded: ["更多菜种实测"],
    });
    expect(draft.lede).toContain("流传说法");
    expect(draft.cannotSay.some((x) => x.includes("毒药") || x.includes("不能"))).toBe(true);
    expect(scoreFactDeskDraft(draft, "隔夜菜会致癌").pass).toBe(true);
  });
});

describe("demo rumor cases: fact-desk voice gate", () => {
  const cases: { id: string; data: DemoCase }[] = [
    { id: "political-policy-rumor", data: politicalRumorCase },
    { id: "health-overnight-vegetables", data: healthRumorCase },
    { id: "tech-5g-radiation", data: techRumorCase },
  ];

  it.each(cases)("$id passes rubric and avoids AI drama", ({ data }) => {
    const { desk, report, score } = runCase(data);

    expect(desk.lede.length).toBeGreaterThan(20);
    expect(desk.lede).toMatch(/流传说法|原表述|网传|说法/);
    expect(desk.lede).not.toMatch(/纯属捏造|震惊|啼笑|作为AI|作为人工智能|广大网友务必/);
    expect(desk.cannotSay.length).toBeGreaterThan(0);
    expect(score.pass).toBe(true);

    // Wired into composeReport
    expect(report.rewrittenClaim.cautious).toBe(desk.lede);
    expect(report.rewrittenClaim.publicFacing.length).toBeGreaterThan(10);
    expect(report.attentionGuidance?.spans.length).toBeGreaterThan(0);
  });

  it("ai-content-jobs still composes with attention guidance", () => {
    const grades = gradeAll(demoCase.candidates, demoCase.subclaims);
    const report = composeReport(demoCase, grades);
    expect(report.rewrittenClaim.cautious.length).toBeGreaterThan(15);
    expect(report.attentionGuidance).toBeDefined();
  });
});
