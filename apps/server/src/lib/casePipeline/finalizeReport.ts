/**
 * 报告收尾链：组装之后、完成快照之前，终态报告只在这里定型。
 *
 * 顺序即语义（behavior-spec 12.1）：每一步原地改同一份 finalReport，后一步读前一步的结果。
 * finalizeReport 的函数体从上到下就是步骤表；新加一道关卡，只能在这张表里选位置：
 *
 *   1 组装 → 2 原子级守门 → 3 早收权门 → 4 短谣通道 → 5 注入的收尾钩子（公式分 · 口吻清洗 · 截图语境）
 *   → 6 质询记录 → 7 追索记录 → 8 复核（+ 重绑引用 + 原图出处）→ 9 来源探活剔死链
 *   → 10 终收权门 → 11 受限结论重写（+ 重绑 + 原图出处）→ 12 整句判定（+ 重绑 + 原图出处）
 *   → 13 追问直答 → 14 打不开的链接 → 15 徽章 → 16 核查时间
 *
 * 完成快照、复核结果事件与记忆收尾不在这里：runCasePipeline 在收尾之后做。
 */

import type { AtomSearchBundle } from "../atomSearch.js";
import { boundTinyRumorVerdict, isOnTopicDebunk } from "../atomSearchQuery.js";
import { normalizeReportCitations } from "../citationBinding.js";
import type { PruneResult } from "../citationLiveness.js";
import type { CrossExamOutcome } from "../crossExam/index.js";
import type { EvidenceLoopOutcome } from "../evidenceLoop/index.js";
import { compactPursuitHops } from "../evidencePursuit/index.js";
import { applyFollowUpAnswerLead } from "../followUpReuse.js";
import { applyImageOriginToReport, type ImageOriginResult } from "../imageOrigin/index.js";
import { applyUnopenedLinkConclusion } from "../publicCopy.js";
import { assembleFinalReport, deriveOverallVerdict, faceVerdictFor } from "../reportAssembly/index.js";
import { reviewAndRepairReport, type ReportReviewResult } from "../reportReviewer.js";
import { applySentenceVerdict, bindDebunksToPrimaryClaim, listAssessedClaims } from "../sentenceVerdict.js";
import { applyConclusionGate, needsConstrainedConclusion, repairGatedConclusion } from "../wholeClaimAudit/index.js";
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
  imageOrigin?: ImageOriginResult;
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

export async function finalizeReport(input: FinalizeReportInput): Promise<FinalizeReportResult> {
  const { claim, reportStep, rumorStep, factStep, sourceStep, search360Result, imageOrigin, auditUnresolvedGaps } = input;
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
    imageOrigin,
  });

  // 2 原子级整句守门（确定性收束）——「分截判决」的收束端：
  // 整体 factCheckResult / verdictType 是单 LLM 字段，会把「真假交织」漂成 false；
  // 有据之真（bind 后 supportingSources 带真实 URL）+ 有假 → mixed，救回真的部分。
  // 最小干预：只救 false→partial 这一方向；tiny-bound 随后仍可按短谣辟谣压回 false。
  const atomVerdicts = Array.isArray(finalReport.subclaimVerdicts)
    ? (finalReport.subclaimVerdicts as Array<Record<string, unknown>>)
    : [];
  // composer draft 的整句强度：repair 只在结构化降级把它调弱时触发，不碰本来就一致的 draft。
  const draftVerdictType = String(finalReport.verdictType ?? "");
  let mixedGuardDemoted = false;
  if (deriveOverallVerdict(atomVerdicts) === "partial") {
    const originalOverall = String(factStep?.output?.factCheckResult ?? "").trim();
    if (originalOverall === "false" && factStep?.output) {
      factStep.output._factCheckResultDerived = { from: "false", to: "partial", rule: "有据之真 + 假原子" };
      factStep.output.factCheckResult = "partial";
    }
    if (finalReport.verdictType === "false") {
      finalReport.verdictType = "mixed_misleading";
      finalReport._mixedGuard = "有据之真 + 假原子 → mixed（原子级守门）";
      mixedGuardDemoted = true;
    }
  }

  // 3 Whole-Claim 收权门（Issue #78 §11）：early + final 两次执行，同一 contract。
  // early 在 boundTiny 之前先收权并记录；final 在 reviewer / 探活之后做最终兜底。
  // reviewer 可能先把无源硬判定降级（此时 final gate 看不到 demote），repair 触发看的是
  // "是否发生过结构化降级"（early / final / mixedGuard 任一），不是只看 final 那一次。
  const gateProbeInput = {
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    subclaimVerdicts: atomVerdicts,
    auditUnresolvedGaps,
  };
  const earlyGateResult = applyConclusionGate(finalReport, gateProbeInput);

  // 4 legacy 短谣通道：提成 false 之前先用同一 contract 做 probe，
  // contract 不允许硬 false（not-applicable / 无 sourced-false / audit 缺口未解）
  // 时不提，免得绕过收权不变量（Review 5127740625 Blocker 2）。
  const searchSources = Array.isArray((search360Result as { sources?: unknown[] } | undefined)?.sources)
    ? ((search360Result as { sources: Array<Record<string, unknown>> }).sources)
    : [];
  const bound = boundTinyRumorVerdict(claim, searchSources);
  if (
    bound === "false" &&
    (finalReport.verdictType === "mixed_misleading" || finalReport.verdictType === "unverified")
  ) {
    const probe: Record<string, unknown> = { ...finalReport, verdictType: "false" };
    if (!applyConclusionGate(probe, gateProbeInput).changed) {
      finalReport.verdictType = "false";
    } else {
      finalReport._tinyBoundSuppressed = "contract-forbids-hard-false";
    }
  }

  // 5 注入的收尾钩子。
  input.finalizeHook?.({
    finalReport,
    claim,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
  });

  // 6 保存实际质询记录；意见是否一致不改变报告分数。
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
  // 7 证据追索记录。
  if (evidenceLoop?.pursuitHops && evidenceLoop.pursuitHops.length > 0) {
    finalReport.evidencePursuit = {
      hops: compactPursuitHops(evidenceLoop.pursuitHops),
    };
  }

  // 8 确定性复核（非 LLM）。复核可能补证据链、改写结论：重绑 [n] 与原图出处。
  input.onReviewStart?.();
  const review = reviewAndRepairReport(finalReport, {
    claim,
    previousOutputs: input.steps.map((s) => s.output),
  });
  Object.assign(finalReport, review.repaired);
  normalizeReportCitations(finalReport);
  if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);

  // 9 「来源能点开」门：发布前对全局引用真实探活，死链剔除并重绑 [n] 标记。
  // 探活通道自身故障不阻断主流程——宁可用未剪枝的报告，也不丢结论。
  let deadCitationUrls: string[] = [];
  try {
    const pruneResult = await input.pruneCitations(finalReport);
    deadCitationUrls = pruneResult.deadUrls;
  } catch (pruneError) {
    throwIfAborted();
    console.warn(`[casePipeline] 引用探活失败，跳过死链剔除: ${String(pruneError)}`);
  }

  // 10 最终 Whole-Claim consistency gate（Review 5128022550 Blocker 1）：
  // final gate 基于 liveness 后的存活证据：死证已剔除仍无支撑的硬 true/false 直接收为
  // unverified；短谣存活辟谣通道（聚合来源按 deadUrls 过滤后仍成立）是唯一的无绑定 false 豁免。
  const deadUrlSet = new Set(deadCitationUrls);
  throwIfAborted();
  const aliveSearchSources = searchSources.filter(
    (s) => !deadUrlSet.has(String(s?.url ?? "").trim())
  );
  const tinyHoldsOnAliveSources =
    boundTinyRumorVerdict(claim, aliveSearchSources) === "false";
  const finalGateResult = applyConclusionGate(finalReport, {
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    subclaimVerdicts: finalReport.subclaimVerdicts,
    auditUnresolvedGaps,
    postLiveness: true,
    allowUnboundHardFalse: tinyHoldsOnAliveSources,
  });

  // 11 repair 触发（Review 5128022550 Blocker 3）由最终结构约束决定
  //（needsConstrainedConclusion），不看是谁降的级、不读结论文本。
  const repairDecision = needsConstrainedConclusion({
    draftVerdictType,
    finalVerdictType: finalReport.verdictType,
    subclaimVerdicts: finalReport.subclaimVerdicts,
    nonVerifiableAtoms: finalReport.nonVerifiableAtoms,
    auditUnresolvedGaps,
    finalGate: finalGateResult,
    earlyGate: earlyGateResult,
    mixedGuardDemoted,
  });
  if (repairDecision.needed) {
    repairGatedConclusion(
      finalReport,
      {
        changed: true,
        from: repairDecision.from,
        to: repairDecision.to,
        rule: repairDecision.rule,
      },
      {
        nonVerifiableAtoms: finalReport.nonVerifiableAtoms,
        subclaimVerdicts: finalReport.subclaimVerdicts,
        auditUnresolvedGaps,
        allowUnboundHardFalse: tinyHoldsOnAliveSources,
      }
    );
    normalizeReportCitations(finalReport);
    // repair 重建了用户可见文本：把幂等的 origin 落点重放一次，用结构化
    // finalReport.imageOrigin 恢复原图出处引用（不断言文本、只读对象）。
    if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);
  }

  // 12 整句判定唯一决定点：按规则表（domain/verdict）由各命题证据推出，取代上面各关卡改过的 verdictType。
  const assessedClaims = listAssessedClaims(finalReport, {
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
  });
  const debunkBound =
    tinyHoldsOnAliveSources &&
    bindDebunksToPrimaryClaim(
      finalReport,
      assessedClaims.find((c) => c.role === "primary"),
      aliveSearchSources.filter((s) => isOnTopicDebunk(claim, s))
    );
  applySentenceVerdict(finalReport, assessedClaims, { auditUnresolvedGaps, debunkBound });
  normalizeReportCitations(finalReport);
  if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);

  // 13 追问直答；14 只有打不开的链接时的结论。
  applyFollowUpAnswerLead(finalReport, claim);
  const keptAtomCount = Array.isArray(rumorStep.output.claimAtoms) ? rumorStep.output.claimAtoms.length : 0;
  applyUnopenedLinkConclusion(finalReport, claim, keptAtomCount);

  // 15 徽章跟最终判词走。
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);
  // 16 结论文本会写「按当前信息」，这里打上实际核查时间；结论时效随来源窗口走。
  finalReport.checkedAt = new Date().toISOString();

  return { finalReport, deadUrls: deadCitationUrls, review };
}
