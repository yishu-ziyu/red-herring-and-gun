/**
 * Case Pipeline — production orchestration for one claim case.
 * 阶段：拆题 → 检索 → 核查（+ 来源审计）→ 报告（确定性，不调模型）→ 收尾（finalizeReport）。
 * 本文件只排阶段顺序；各阶段在 stages/，进行态在 caseState.ts，时间预算在 budget.ts，里程碑快照在 snapshotTimeline.ts。
 * HTTP / SSE are thin adapters; inject runAgent + searchOne.
 */

import type { AtomSearchBundle, KnowledgeHit, SearchOneAtom } from "../atomSearch.js";
import { pruneDeadCitations } from "../citationLiveness.js";
import { readSourcePageDates } from "../sourcePageDates.js";
import type { ReportReviewIssue } from "../reportReviewer.js";
import type { InvestigationSnapshotV1 } from "../../../../shared/investigation/index.js";
import { createBudget } from "./budget.js";
import type { PipelineContext } from "./caseState.js";
import { finalizeReport } from "./finalizeReport.js";
import { createSnapshotTimeline } from "./snapshotTimeline.js";
import { compose } from "./stages/compose.js";
import { decompose } from "./stages/decompose.js";
import { judge } from "./stages/judge.js";
import { retrieve } from "./stages/retrieve.js";

export type PipelineStep = {
  agent: string;
  agentName?: string;
  agentIcon?: string;
  systemPrompt?: string;
  input?: Record<string, unknown>;
  output: Record<string, unknown>;
  model?: string;
  latencyMs?: number;
  timestamp?: number;
  status?: string;
  error?: string;
  /** Pre-audit directional candidates kept off the public output for SourceValidator refreshes. */
  relationAuditCandidates?: Array<Record<string, unknown>>;
};

export type RunAgentFn = (
  agentId: string,
  steps: PipelineStep[],
  search360Result?: unknown,
  atomSearchBundle?: AtomSearchBundle | null,
  execution?: { signal?: AbortSignal; deadlineMs?: number }
) => Promise<PipelineStep>;

export type CasePipelineHooks = {
  /** atom search lifecycle (SSE) */
  onAtomSearchStart?: (atom: string) => void;
  onAtomSearchResult?: (atom: string, result: unknown) => void;
  /** 同一案上一轮证据够用、不再检索已核命题（活动流 prior_round_reuse 行） */
  onPriorRoundReuse?: (hit: KnowledgeHit) => void;
  /** deterministic report reviewer — tool_start style (SSE) */
  onReportReviewStart?: (info: { toolName: string; query: string }) => void;
  /** deterministic report reviewer — tool_result style (SSE) */
  onReportReviewResult?: (info: {
    toolName: string;
    query: string;
    passed: boolean;
    score: number;
    issues: ReportReviewIssue[];
    checks: Record<string, boolean>;
  }) => void;
  /**
   * Investigation Snapshot 语义里程碑（SSE investigation_snapshot）：
   * 每次回调携带完整 InvestigationSnapshotV1，前端只取最新版。
   * 里程碑：received（拆题）→ decomposed（拆题一出来就上屏；没拆出条才发 checking）→
   * investigating（检索开始/返回）→ judging
   * （核查绑定 / 来源审计刷新）→ complete。中断帧由 handlers 补发。
   */
  onInvestigationSnapshot?: (snapshot: InvestigationSnapshotV1) => void;
};

export type CasePipelineInput = {
  recorder?: import("../runRecorder.js").RunRecorder;
  claim: string;
  /**
   * 快照里「你调查的说法」显示的文字。claim 可能带着给模型看的材料说明（例如图片的视觉提取），
   * 用户不能看到那部分；不传时与 claim 相同。
   */
  displayClaim?: string;
  /**
   * 用户提交的链接材料（规范化 intake.links）：客户端既有抓取链路读过正文。
   * 只透传进调查快照登记来源，管线阶段不读它、不据此发起新抓取。
   */
  intakeLinks?: unknown;
  runAgent: RunAgentFn;
  searchOne: SearchOneAtom;
  hooks?: CasePipelineHooks;
  /** 组装之后的收尾钩子（口吻清洗 · 截图语境），原地改报告。 */
  finalizeReport?: (ctx: { finalReport: Record<string, unknown>; claim: string }) => void;
  /**
   * 管线截止时间（epoch ms）：来源审计刷新在此前必须收敛。
   * 不传 = 无预算。调用方传的是总超时 − 收尾余量。
   */
  deadline?: number;
  /**
   * 协作式取消：收到取消或截止信号后，在阶段边界退出。
   * 阶段内调用通过传入的 signal 响应取消；客户端断开连接本身不取消调查。
   */
  signal?: AbortSignal;
};

type CasePipelineResult = {
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle: AtomSearchBundle;
};

const REPORT_REVIEWER_TOOL = "Report Reviewer (proposer-reviewer)";

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  const { claim, hooks } = input;
  const steps: PipelineStep[] = [];

  // 协作式取消：各阶段边界检查一次。fail-open 的 catch 会吞掉 AbortError，
  // 所以下一个阶段边界必须再次检查取消信号。
  const throwIfAborted = () => input.signal?.throwIfAborted();
  throwIfAborted();

  const displayClaim = input.displayClaim ?? claim;
  const snapshots = createSnapshotTimeline({ claim: displayClaim, hooks, throwIfAborted });
  snapshots.received();

  const ctx: PipelineContext = {
    input,
    claim,
    hooks,
    steps,
    budget: createBudget(input.deadline),
    snapshots,
    throwIfAborted,
  };

  const rumorStep = await decompose(ctx);
  throwIfAborted();
  const retrieval = await retrieve(ctx, rumorStep);
  throwIfAborted();
  const state = await judge(ctx, rumorStep, retrieval);

  // 首次审计没覆盖全部方向性来源时再审一次；审不成的来源只作背景，不带方向上屏。
  await state.sourceAudit.refreshIfNeeded();

  snapshots.judging({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle: state.atomSearchBundle,
    subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
    sourceRelationAudits: state.sourceStep?.output?.claimSourceRelations,
  });

  const reportStep = compose(ctx, state);
  const { atomSearchBundle, search360Result, factStep, sourceStep } = state;

  const { finalReport, deadUrls: deadCitationUrls, review } = await finalizeReport({
    claim,
    reportStep,
    rumorStep,
    factStep,
    sourceStep,
    steps,
    search360Result,
    atomSearchBundle,
    finalizeHook: input.finalizeReport,
    onReviewStart: () => hooks?.onReportReviewStart?.({ toolName: REPORT_REVIEWER_TOOL, query: claim }),
    pruneCitations: (report) => pruneDeadCitations(report, { signal: input.signal, deadlineMs: input.deadline }),
    signal: input.signal,
  });
  // 核查步骤内部失败 → 本次核查未完成：先定终态再发快照，
  // 中断帧在 emit 之前成形（stream / 存库 snapshot / run 状态三者同一终态），
  // 不能先发 complete 帧再事后换 interrupted，否则广播与终态不一致。
  const runIncomplete = finalReport._source === "error-boundary";
  // 检索方没给发布日期的来源，读网页自己的发布元数据。
  const intakeUrls = (Array.isArray(input.intakeLinks) ? input.intakeLinks : [])
    .map((link) => String((link as { url?: unknown } | null)?.url ?? ""))
    .filter(Boolean);
  const pageDates = await readSourcePageDates(atomSearchBundle, intakeUrls, {
    signal: input.signal,
    deadlineMs: input.deadline,
  });
  throwIfAborted();
  // 里程碑（完成）：finalReport.investigation = 稳定快照；报告 + 复核 + 探活后构建。
  const finalInvestigation = snapshots.complete(
    {
      claimAtoms: rumorStep.output.claimAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      atomSearchBundle,
      subclaimVerdicts: finalReport.subclaimVerdicts,
      sourceRelationAudits: sourceStep?.output?.claimSourceRelations,
      nonVerifiableAtoms: finalReport.nonVerifiableAtoms,
      report: finalReport,
      reachability: { deadUrls: deadCitationUrls },
      pageDates,
      intakeLinks: input.intakeLinks,
      checkedAt: typeof finalReport.checkedAt === "string" ? finalReport.checkedAt : undefined,
    },
    { interrupted: runIncomplete, claim: displayClaim }
  );
  if (finalInvestigation) {
    finalReport.investigation = finalInvestigation;
  }
  reportStep.output = finalReport;
  hooks?.onReportReviewResult?.({
    toolName: REPORT_REVIEWER_TOOL,
    query: claim,
    passed: review.passed,
    score: review.score,
    issues: review.issues,
    checks: review.checks,
  });

  throwIfAborted();

  return { steps, finalReport, atomSearchBundle };
}
