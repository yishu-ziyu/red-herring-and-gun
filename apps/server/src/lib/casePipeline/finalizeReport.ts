/**
 * 报告收尾链：组装之后、完成快照之前，终态报告只在这里定型。
 *
 * 顺序即语义：每一步原地改同一份报告，后一步读前一步的结果。函数体从上到下就是步骤表：
 *
 *   1 组装（判词来自 CaseState）→ 2 注入的收尾钩子（截图语境）→ 3 来源探活剔死链
 *   → 4 整句判定（verdictType · 徽章 · 结论文字，全在 sentenceVerdict）→ 5 复核（只报告问题）→ 6 核查时间
 *
 * 整句结论只由 4 写入，此前报告里没有、此后任何一步都只读；新加关卡只能在这张表里选位置。
 * 完成快照与复核结果事件不在这里：runCasePipeline 在收尾之后做。
 */

import { assembleFinalReport } from "../assembleFinalReport.js";
import type { PruneResult } from "../citationLiveness.js";
import { reviewReport, type ReportReviewResult } from "../reportReviewer.js";
import { decideAndWriteVerdict } from "../sentenceVerdict.js";
import type { CaseState } from "./caseState.js";
import type { CasePipelineInput } from "./runCasePipeline.js";

type FinalizeReportInput = {
  claim: string;
  state: CaseState;
  /** 报告骨架（compose 的产物），就地收尾。 */
  report: Record<string, unknown>;
  /** handlers 注入的收尾钩子：截图语境。 */
  finalizeHook?: CasePipelineInput["finalizeReport"];
  /** 复核开始（SSE tool_start）。 */
  onReviewStart?: () => void;
  /** 来源探活端口：剔除死链并重绑引用。抛错时跳过剔除，报告照发。 */
  pruneCitations: (report: Record<string, unknown>) => Promise<PruneResult>;
  signal?: AbortSignal;
};

type FinalizeReportResult = {
  finalReport: Record<string, unknown>;
  /** 探活判死、已从报告剔除的链接（完成快照的 reachability）。 */
  deadUrls: string[];
  review: ReportReviewResult;
};

export async function finalizeReport(input: FinalizeReportInput): Promise<FinalizeReportResult> {
  const { claim, state, report } = input;
  const { rumorStep, factStep, sourceStep } = state;

  assembleFinalReport({
    finalReport: report,
    rumorStep,
    verdicts: state.subclaimVerdicts,
    atomSearchBundle: state.atomSearchBundle,
  });

  input.finalizeHook?.({ finalReport: report, claim });

  // 探活通道自身故障不阻断主流程——宁可用未剪枝的报告，也不丢结论。
  let deadUrls: string[] = [];
  try {
    deadUrls = (await input.pruneCitations(report)).deadUrls;
  } catch (pruneError) {
    input.signal?.throwIfAborted();
    console.warn(`[casePipeline] 引用探活失败，跳过死链剔除: ${String(pruneError)}`);
  }

  // 死链已剔除，判词按仍然活着的出处求值：死证撑不起的判词回到没查清。
  // 辟谣材料只有经过逐条判词与关系审核才算反驳，没有绕过规则表的捷径。
  input.signal?.throwIfAborted();
  // 拆题/核查/信源审计步骤内部出错 → 本次核查未完成。
  const failedSteps = [rumorStep, factStep, sourceStep].filter((step) => typeof step.error === "string" && step.error.trim());
  if (failedSteps.length > 0) {
    console.error(`[finalize] steps failed: ${failedSteps.map((step) => step.agent).join(", ")}`, failedSteps.map((step) => `${step.agent}: ${step.error}`));
  }
  decideAndWriteVerdict(report, {
    claim,
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
    factCheckReason: factStep.output.verdictReason,
    ...(failedSteps.length > 0 ? { incomplete: failedSteps.map((step) => step.agent) } : {}),
  });

  input.onReviewStart?.();
  const review = reviewReport(report);

  // 结论文本会写「按当前信息」，这里打上实际核查时间；结论时效随来源窗口走。
  report.checkedAt = new Date().toISOString();

  return { finalReport: report, deadUrls, review };
}
