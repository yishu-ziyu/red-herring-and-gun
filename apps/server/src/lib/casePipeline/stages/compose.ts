/**
 * 阶段 4 报告：由分条判断确定性地写出整份报告，不调用写作模型（#145）。
 * 整句判断由规则表从分条判断推出，整句理由来自核查模型的 verdictReason。
 */
import { buildDeterministicFinalReport } from "../../deterministicReport.js";
import type { CaseState, PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";

export function compose(ctx: PipelineContext, state: CaseState): PipelineStep {
  const { claim, steps, throwIfAborted } = ctx;
  throwIfAborted();
  const startedAt = Date.now();
  const reportStep: PipelineStep = {
    agent: "report",
    agentName: "Report",
    input: { claim },
    output: buildDeterministicFinalReport(claim, steps, state.search360Result),
    model: "deterministic-report",
    latencyMs: Date.now() - startedAt,
    timestamp: Date.now(),
    status: "completed",
  };
  steps.push(reportStep);
  return reportStep;
}
