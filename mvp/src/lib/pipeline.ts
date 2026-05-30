import { demoCase } from "../data/demoCase";
import {
  healthRumorCase,
  socialRumorCase,
  techRumorCase,
  financeRumorCase,
  politicalRumorCase,
  entertainmentRumorCase,
} from "../data/rumorCases";
import type { DemoCase } from "./schemas";
import { gradeAll } from "./graderRules";
import { composeReport } from "./reportComposer";

const CASE_REGISTRY: Record<string, DemoCase> = {
  "ai-content-jobs": demoCase,
  "health-overnight-vegetables": healthRumorCase,
  "social-metro-shutdown": socialRumorCase,
  "tech-5g-radiation": techRumorCase,
  "finance-rmb-devalue": financeRumorCase,
  "political-policy-rumor": politicalRumorCase,
  "entertainment-celebrity-rumor": entertainmentRumorCase,
};

export function getDemoCase(caseId: string): DemoCase {
  return CASE_REGISTRY[caseId] ?? demoCase;
}

export function runDemoPipeline(caseId: string = "ai-content-jobs") {
  const selectedCase = getDemoCase(caseId);
  const gradedEvidence = gradeAll(selectedCase.candidates, selectedCase.subclaims);
  const report = composeReport(selectedCase, gradedEvidence);

  return {
    caseData: selectedCase,
    gradedEvidence,
    report,
  };
}
