import { demoCase } from "../data/demoCase";
import { gradeAll } from "./graderRules";
import { composeReport } from "./reportComposer";

export function runDemoPipeline() {
  const gradedEvidence = gradeAll(demoCase.candidates, demoCase.subclaims);
  const report = composeReport(demoCase, gradedEvidence);

  return {
    caseData: demoCase,
    gradedEvidence,
    report,
  };
}
