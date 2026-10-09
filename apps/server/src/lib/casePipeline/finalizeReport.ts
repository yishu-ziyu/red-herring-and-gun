/**
 * 报告收尾链：组装之后、完成快照之前，终态报告只在这里定型。
 *
 * 顺序即语义（behavior-spec 12.1）：每一步原地改同一份 finalReport，后一步读前一步的结果。
 * finalizeReport 的函数体从上到下就是步骤表；新加一道关卡，只能在这张表里选位置：
 *
 *   1 组装 → 2 整句判定（先行，给公式分用）→ 3 注入的收尾钩子（公式分 · 口吻清洗 · 截图语境）
 *   → 4 质询记录 → 5 追索记录 → 6 复核（+ 重绑引用）→ 7 来源探活剔死链
 *   → 8 整句判定（终局，写结论）→ 9 追问直答 → 10 打不开的链接 → 11 徽章 → 12 核查时间
 *
 * 整句结论只由规则表（domain/verdict）得出，2 与 8 是同一个纯函数在不同时点的两次求值：
 * 2 只在调用公式分期间借用结论（分数与最终判定不得互相矛盾），8 在死链剔除之后重新求值并写结论文字。
 * 除这两处，任何一步都不得改整句的 verdictType（复核可能改，但会被 8 重新决定）。
 *
 * 完成快照、复核结果事件与记忆收尾不在这里：runCasePipeline 在收尾之后做。
 */

import type { AtomSearchBundle } from "../atomSearch.js";
import { normalizeReportCitations } from "../citationBinding.js";
import type { PruneResult } from "../citationLiveness.js";
import type { CrossExamOutcome } from "../crossExam/index.js";
import type { EvidenceLoopOutcome } from "../evidenceLoop/index.js";
import { compactPursuitHops } from "../evidencePursuit/index.js";
import { applyFollowUpAnswerLead } from "../followUpReuse.js";
import { applyUnopenedLinkConclusion } from "../publicCopy.js";
import { assembleFinalReport, faceVerdictFor } from "../reportAssembly/index.js";
import { reviewAndRepairReport, type ReportReviewResult } from "../reportReviewer.js";
import { decideSentenceVerdict } from "../../domain/verdict.js";
import { applySentenceVerdict, listAssessedClaims, VERDICT_TYPE } from "../sentenceVerdict.js";
import type { CasePipelineInput, PipelineStep } from "./runCasePipeline.js";

export type FinalizeReportInput = {
  claim: string;
  /** 报告写作步骤。output 是对象时就地收尾（与 steps 里是同一个对象），否则从空报告开始。 */
  reportStep: PipelineStep;
  rumorStep: PipelineStep;
  /** 原子级守门把整句 false 救成 partial 时，同步改它的 factCheckResult（公式分读这里）。 */
  factStep: PipelineStep;
  sourceStep: PipelineStep;
  /** 复核看全部前序输出，报告写作步骤自己也在里面。 */
  steps: PipelineStep[];
  search360Result: unknown;
  atomSearchBundle: AtomSearchBundle;
  auditUnresolvedGaps: string[];
  crossExam?: CrossExamOutcome;
  evidenceLoop?: EvidenceLoopOutcome;
  /** handlers 注入的收尾钩子：公式分 · 口吻清洗 · 截图语境。 */
  finalizeHook?: CasePipelineInput["finalizeReport"];
  /** 复核开始（SSE tool_start）。 */
  onReviewStart?: () => void;
  /** 来源探活端口：剔除死链并重绑引用。抛错时跳过剔除，报告照发。 */
  pruneCitations: (report: Record<string, unknown>) => Promise<PruneResult>;
  signal?: AbortSignal;
};

export type FinalizeReportResult = {
  finalReport: Record<string, unknown>;
  /** 探活判死、已从报告剔除的链接（完成快照的 reachability）。 */
  deadUrls: string[];
  review: ReportReviewResult;
};

/** 规则表结论 → 公式分读的整体判定（fact_checker 的 factCheckResult 四值）。 */
const FACT_CHECK_RESULT = {
  "can-believe": "true",
  "cannot-believe": "false",
  "part-true-part-false": "partial",
  "partly-holds": "partial",
  disputed: "partial",
  "not-enough-evidence": "unverified",
} as const;

export async function finalizeReport(input: FinalizeReportInput): Promise<FinalizeReportResult> {
  const { claim, reportStep, rumorStep, factStep, sourceStep, search360Result, auditUnresolvedGaps } = input;
  const throwIfAborted = () => input.signal?.throwIfAborted();

  const finalReport =
    reportStep.output && typeof reportStep.output === "object"
      ? reportStep.output
      : ({} as Record<string, unknown>);

  // 1 组装：分条判词以核查步骤为准，核查没给才用报告自带的。
  const reportVerdicts = reportStep?.output?.subclaimVerdicts;
  const verdictSource =
    Array.isArray(factStep?.output?.subclaimVerdicts) && factStep.output.subclaimVerdicts.length > 0
      ? factStep.output.subclaimVerdicts
      : reportVerdicts;
  assembleFinalReport({
    finalReport,
    rumorStep,
    verdicts: verdictSource,
    searchSources: (search360Result as { sources?: Array<{ url?: unknown }> })?.sources,
    atomSearchBundle: input.atomSearchBundle,
  });

  const assess = () =>
    listAssessedClaims(finalReport, {
      claimAtoms: rumorStep.output.claimAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
    });
  // 2 整句判定（先行）：同一个规则表，先求一次值给公式分用，免得分数读的是模型漂出来的整句字段
  // （例如「有据之真 + 假」被写成整句 false，或规则表判了不能信而分数没有封顶）。
  // 只在调用注入的收尾钩子期间借用这个结论；钩子之后 verdictType 还原成模型草稿交给复核，
  // 终局由第 8 步在死链剔除之后重新求值。
  const provisional = decideSentenceVerdict(assess());
  const draftVerdictType = finalReport.verdictType;
  finalReport.verdictType = VERDICT_TYPE[provisional.verdict];
  const originalFactResult = String(factStep?.output?.factCheckResult ?? "").trim();
  if (factStep?.output && originalFactResult === "false" && FACT_CHECK_RESULT[provisional.verdict] === "partial") {
    // 模型把「有据之真 + 假」漂成整体 false 时，公式分读到的整体判定跟着规则表走（救回真的部分）。
    factStep.output._factCheckResultDerived = { from: "false", to: "partial", rule: provisional.rule };
    factStep.output.factCheckResult = "partial";
  }

  // 3 注入的收尾钩子。
  input.finalizeHook?.({
    finalReport,
    claim,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
  });
  finalReport.verdictType = draftVerdictType;

  // 4 保存实际质询记录；意见是否一致不改变报告分数。
  const { crossExam, evidenceLoop } = input;
  if (crossExam) {
    finalReport.crossExam = {
      ran: crossExam.ran,
      skippedReason: crossExam.skippedReason,
      model: crossExam.model,
      adjustment: crossExam.confidenceAdjustment,
      atoms: crossExam.atoms.map((a) => ({
        ...a,
        atom: a.atom,
        primaryVerdict: a.primaryVerdict,
        secondVerdict: a.secondVerdict,
        relation: a.relation,
        reason: a.secondReason,
      })),
    };
  }
  // 5 证据追索记录。
  if (evidenceLoop?.pursuitHops && evidenceLoop.pursuitHops.length > 0) {
    finalReport.evidencePursuit = {
      hops: compactPursuitHops(evidenceLoop.pursuitHops),
    };
  }

  // 6 确定性复核（非 LLM）。复核可能补证据链、改写结论：重绑 [n]。
  input.onReviewStart?.();
  const review = reviewAndRepairReport(finalReport, {
    claim,
    previousOutputs: input.steps.map((s) => s.output),
  });
  Object.assign(finalReport, review.repaired);
  normalizeReportCitations(finalReport);

  // 7 「来源能点开」门：发布前对全局引用真实探活，死链剔除并重绑 [n] 标记。
  // 探活通道自身故障不阻断主流程——宁可用未剪枝的报告，也不丢结论。
  let deadCitationUrls: string[] = [];
  try {
    const pruneResult = await input.pruneCitations(finalReport);
    deadCitationUrls = pruneResult.deadUrls;
  } catch (pruneError) {
    throwIfAborted();
    console.warn(`[casePipeline] 引用探活失败，跳过死链剔除: ${String(pruneError)}`);
  }

  // 8 整句判定（终局）：死链已剔除，按仍然活着的出处重新求值，并写结论首句、摘要与正文。
  // 死证撑不起的判词回到没查清。辟谣材料只有经过逐条判词与关系审核才算反驳，没有绕过规则表的捷径。
  throwIfAborted();
  applySentenceVerdict(finalReport, assess(), { auditUnresolvedGaps, factCheckReason: factStep?.output?.verdictReason });
  normalizeReportCitations(finalReport);

  // 9 追问直答；10 只有打不开的链接时的结论。
  applyFollowUpAnswerLead(finalReport, claim);
  const keptAtomCount = Array.isArray(rumorStep.output.claimAtoms) ? rumorStep.output.claimAtoms.length : 0;
  applyUnopenedLinkConclusion(finalReport, claim, keptAtomCount);

  // 11 徽章跟最终判词走。
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);
  // 12 结论文本会写「按当前信息」，这里打上实际核查时间；结论时效随来源窗口走。
  finalReport.checkedAt = new Date().toISOString();

  // 13 运行失败态：核查/信源审计/报告写作步骤内部出错 → 本次核查未完成。
  // 这些失败是运行事件不是认识论结果，不能留着「公开材料还撑不住判断」的结论文字——
  // 那句话的意思是「查过了但材料不够」，而这里是「核查本身没跑成」。标记沿用
  // error-boundary（重建/列表/复核都把这份报告按中断处理），结论换成未完成的真实说明。
  const failedSteps = [rumorStep, factStep, sourceStep, reportStep]
    .map((step) => (typeof step?.error === "string" && step.error.trim() ? step.agent : null))
    .filter((agent): agent is string => Boolean(agent));
  if (failedSteps.length > 0) {
    finalReport._source = "error-boundary";
    finalReport.incompleteSteps = failedSteps;
    finalReport.conclusion = "本次核查没能完成，判断还没写成。已找到的公开材料保留在来源里，可以重新调查。";
    finalReport.summaryForPublic = "本次核查没能完成，判断还没写成。";
    finalReport.recommendation = "本次核查没能完成，请重新调查后再看判断。";
  }

  return { finalReport, deadUrls: deadCitationUrls, review };
}
