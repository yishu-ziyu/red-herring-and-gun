/** Ancillary score from the settled facts; no judgment or prose changes. */
import { applyFormulaScoreToReport, computeFormulaScore } from "../formulaScore.js";
import type { CasePipelineInput } from "./runCasePipeline.js";

export const scoreReport: NonNullable<CasePipelineInput["finalizeReport"]> = ({
  finalReport, rumorStep, factStep, sourceStep, search360Result,
}) => {
  applyFormulaScoreToReport(finalReport, computeFormulaScore(
    rumorStep.output, factStep.output, sourceStep.output, search360Result,
  ));
};
