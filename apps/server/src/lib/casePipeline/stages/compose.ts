/**
 * 阶段 4 报告：由核查进行态确定性地写出报告骨架，不调用写作模型。
 * 整句判断由 finalizeReport 里的规则表从分条判断推出，这里不写结论。
 */
import { buildReportSkeleton } from "../../deterministicReport.js";
import type { CaseState, PipelineContext } from "../caseState.js";

export function compose(ctx: PipelineContext, state: CaseState): Record<string, unknown> {
  ctx.throwIfAborted();
  return buildReportSkeleton(ctx.claim, state);
}
