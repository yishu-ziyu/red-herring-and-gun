/**
 * Case Pipeline — production orchestration for one claim case.
 * 阶段：拆题 → 检索 → 核查（+ 来源审计）→ 证据补查 → 质询 → 因果增强 → 整句审计 → 报告写作 → 收尾（finalizeReport）。
 * 本文件只排阶段顺序；各阶段在 stages/，进行态在 caseState.ts，时间预算在 budget.ts，里程碑快照在 snapshotTimeline.ts。
 * HTTP / SSE are thin adapters; inject runAgent + searchOne + selfProof model.
 */

import { randomUUID } from "node:crypto";
import type { SelfProofModelCall } from "../claimAtom/index.js";
import type { AtomSearchBundle, KnowledgeHit, SearchOneAtom } from "../atomSearch.js";
import { pruneDeadCitations, type LivenessDeps } from "../citationLiveness.js";
import type { ReportReviewIssue } from "../reportReviewer.js";
import type { EvidenceLoopOutcome, EvidenceLoopHooks, RewriteQueryModelCall } from "../evidenceLoop/index.js";
import type { CrossExamOutcome, CrossExamRawModelCall } from "../crossExam/index.js";
import type { InvestigationSnapshotV1 } from "../investigation/index.js";
import { interruptedInvestigationSnapshot } from "../interruptedSnapshot.js";
import type { WholeClaimAuditModelCall, WholeClaimAuditRun } from "../wholeClaimAudit/index.js";
import { planFollowUpReuse } from "../followUpReuse.js";
import { createBudget } from "./budget.js";
import type { PipelineContext } from "./caseState.js";
import { finalizeReport } from "./finalizeReport.js";
import { createSnapshotTimeline } from "./snapshotTimeline.js";
import { compose } from "./stages/compose.js";
import { crossExamine } from "./stages/crossExamine.js";
import { decompose } from "./stages/decompose.js";
import { enrichCausal } from "./stages/enrichCausal.js";
import { evaluateWholeClaim } from "./stages/evaluateWholeClaim.js";
import { judge } from "./stages/judge.js";
import { pursueEvidence } from "./stages/pursue.js";
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
  /** after self-proof written on rumor step */
  onSelfProof?: (info: { kept: string[]; dropped: unknown[]; model: string }) => void;
  /** atom search lifecycle (SSE) */
  onAtomSearchStart?: (atom: string) => void;
  onAtomSearchResult?: (atom: string, result: unknown) => void;
  /** 同一案上一轮证据够用、不再检索已核命题（活动流 prior_round_reuse 行） */
  onPriorRoundReuse?: (hit: KnowledgeHit) => void;
  searchMode?: "parallel" | "sequential";
  /** evidence sufficiency loop — ADR-004（SSE：tool_start / tool_result 风格） */
  onEvidenceLoopStart?: (targets: Array<{ atom: string; trigger: string }>) => void;
  onEvidenceLoopRoundStart?: EvidenceLoopHooks["onRoundStart"];
  onEvidenceLoopRoundResult?: EvidenceLoopHooks["onRoundResult"];
  onEvidenceLoopStopped?: (info: { atom: string; rounds: number; reason: string }) => void;
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
   * （核查绑定 / 补查 / 质询）→ complete。中断帧由 handlers 补发。
   */
  onInvestigationSnapshot?: (snapshot: InvestigationSnapshotV1) => void;
};

export type CasePipelineInput = {
  claim: string;
  /**
   * 用户提交的链接材料（规范化 intake.links）：客户端既有抓取链路读过正文。
   * 只透传进调查快照登记来源，管线阶段不读它、不据此发起新抓取。
   */
  intakeLinks?: unknown;
  runAgent: RunAgentFn;
  searchOne: SearchOneAtom;
  callSelfProofModel: SelfProofModelCall;
  /** report_composer with deterministic fallback */
  runReport: (args: {
    claim: string;
    steps: PipelineStep[];
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
    signal?: AbortSignal;
    deadlineMs?: number;
  }) => Promise<PipelineStep>;
  hooks?: CasePipelineHooks;
  /** optional post-assembly mutators (formula score, fact-desk voice) */
  finalizeReport?: (ctx: {
    finalReport: Record<string, unknown>;
    claim: string;
    rumorStep: PipelineStep;
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
  }) => void;
  /** stable run id; default randomUUID */
  runId?: string;
  /**
   * 管线截止时间（epoch ms）：报告写作前的补查/复核/增强在此前必须收敛。
   * 不传 = 无预算（测试/脚本用）。handlers 侧 = 总超时 − 收尾余量。
   */
  deadline?: number;
  /**
   * 协作式取消：客户端断开 / 总超时后 abort，各阶段边界立即退出，
   * 流水线不再作为 Promise.race 落败方僵尸烧 token（阶段内在途调用不受此控制）。
   */
  signal?: AbortSignal;
  /**
   * Evidence sufficiency loop — ADR-004 + 翻案续期. 默认开启。
   * 提问 → 重判 → 判词仍翻转中且问题仍产证据 → 换策略再问（pass 2+）。
   * 判停全确定性：无新证据（坏问题停）/ 全部收敛（问完了）/ pass 上限（笼子）。
   */
  evidenceLoop?: {
    enabled?: boolean;
    maxRounds?: number;
    /** 翻案续期 pass 上限（默认 2，总轮数 ≤ maxPasses × maxRounds/原子） */
    maxPasses?: number;
    /** LLM 语义改写（官方来源词 / 原文语境 / 当事方与原始数据策略内）；缺省用确定性模板 */
    callRewriteModel?: RewriteQueryModelCall;
  };
  /**
   * Cross exam — G3/P1：证据冲突时第二模型独立复核（真辩论）。
   * 分歧不重写判词：降可信度、标 contested、SSE 可见。
   */
  crossExam?: {
    enabled?: boolean;
    /** 第二意见裸模型调用（域模块绑 prompt/解析） */
    callRaw?: CrossExamRawModelCall;
  };
  /**
   * Whole-Claim Audit（Issue #78）：整句在拆题后继续作为被审计对象。
   * Planning（检索前，可核查性语义修订）→ Evaluation（初轮后，≤1 次 audit 补查）。
   * 未注入 callModel 时保持 legacy 行为（fail-open）。
   */
  wholeClaimAudit?: {
    callModel?: WholeClaimAuditModelCall;
  };
  /**
   * 引用探活依赖（「来源能点开」门）。默认真实网络探活；
   * `false` 关闭；测试传 { liveness: Map } 注入结果避免触网。
   */
  citationLiveness?: LivenessDeps | false;
  /**
   * 同一案追问快路径（契约 docs/evals/2026-09-13-followup-fast-path.md）。
   * 登录读服务端档案，访客读请求里的上一轮可见材料；没有可用证据时
   * 分类器返回 null，本函数仍走完整管道。
   */
  followUpReuse?: {
    priorReport: unknown;
    priorClaim: string;
    priorCreatedAt: number;
  };
};

export type CasePipelineResult = {
  steps: PipelineStep[];
  finalReport: Record<string, unknown>;
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
  rumorStep: PipelineStep;
  factStep: PipelineStep;
  sourceStep: PipelineStep;
  reportStep: PipelineStep;
  /** evidence sufficiency loop outcome — ADR-004（未开启或无触发时为 undefined） */
  evidenceLoop?: EvidenceLoopOutcome;
  /** cross exam outcome — G3/P1（未开启 / 无冲突 / 无注入时为 undefined） */
  crossExam?: CrossExamOutcome;
  /** Whole-Claim Audit outcome — Issue #78（未注入模型时 plan/evaluation 为 null） */
  wholeClaimAudit: WholeClaimAuditRun;
  runId: string;
};

const REPORT_REVIEWER_TOOL = "Report Reviewer (proposer-reviewer)";

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  const { claim, hooks } = input;
  const steps: PipelineStep[] = [];

  // 协作式取消：各阶段边界检查一次。fail-open 的 catch 会吞掉 AbortError，
  // 所以下一个边界必须再查，断连后最多再浪费一个阶段调用就会整体退出。
  const throwIfAborted = () => input.signal?.throwIfAborted();
  throwIfAborted();

  const snapshots = createSnapshotTimeline({ claim, hooks, throwIfAborted });
  snapshots.received();

  const ctx: PipelineContext = {
    input,
    claim,
    hooks,
    steps,
    budget: createBudget(input.deadline),
    snapshots,
    throwIfAborted,
    reusePlan: input.followUpReuse
      ? planFollowUpReuse({
          claim,
          priorReport: input.followUpReuse.priorReport,
          priorClaim: input.followUpReuse.priorClaim,
          priorCreatedAt: input.followUpReuse.priorCreatedAt,
        })
      : null,
    audit: {
      callModel: input.wholeClaimAudit?.callModel,
      run: {
        plan: null,
        evaluation: null,
        extraPass: null,
        model: "",
        reevaluation: null,
      },
      unresolvedGaps: [],
    },
  };

  const rumorStep = await decompose(ctx);
  throwIfAborted();
  const retrieval = await retrieve(ctx, rumorStep);
  throwIfAborted();
  const state = await judge(ctx, rumorStep, retrieval);
  await pursueEvidence(ctx, state);
  await crossExamine(ctx, state);

  // Evidence loop / cross-exam may have added URLs. Refresh the independent
  // relation audit once after those bounded searches; until this succeeds,
  // new URLs stay context-only and cannot flash a directional badge.
  await state.sourceAudit.refreshIfNeeded();

  // 里程碑：质询收束（冲突 reason 已知/未知如实标注；质询未运行不影响冲突存在性）。
  snapshots.judging({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle: state.atomSearchBundle,
    subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
    sourceRelationAudits: state.sourceStep?.output?.claimSourceRelations,
    crossExam: state.crossExam,
    pursuitHops: state.evidenceLoop?.pursuitHops,
  });

  await enrichCausal(ctx, state);
  throwIfAborted();
  await evaluateWholeClaim(ctx, state);

  // Whole-claim audit may add another bounded search pass after the earlier
  // source audit. Refresh once more if needed; otherwise keep any new URL
  // non-directional rather than letting ReportComposer inherit an unaudited bucket.
  await state.sourceAudit.refreshIfNeeded();

  const reportStep = await compose(ctx, state);
  const { atomSearchBundle, search360Result, evidenceLoop, crossExam } = state;
  const { factStep, sourceStep } = state;
  const auditUnresolvedGaps = ctx.audit.unresolvedGaps;
  const wholeClaimAudit = ctx.audit.run;

  const { finalReport, deadUrls: deadCitationUrls, review } = await finalizeReport({
    claim,
    reportStep,
    rumorStep,
    factStep,
    sourceStep,
    steps,
    search360Result,
    atomSearchBundle,
    auditUnresolvedGaps,
    crossExam,
    evidenceLoop,
    finalizeHook: input.finalizeReport,
    onReviewStart: () => hooks?.onReportReviewStart?.({ toolName: REPORT_REVIEWER_TOOL, query: claim }),
    pruneCitations: (report) =>
      pruneDeadCitations(
        report,
        input.citationLiveness === false
          ? { liveness: new Map(), signal: input.signal }
          : { ...input.citationLiveness, signal: input.signal, deadlineMs: input.deadline }
      ),
    signal: input.signal,
  });
  // 核查步骤内部失败 → 本次核查未完成：先定终态再发快照，
  // 中断帧在 emit 之前成形（stream / 存库 snapshot / run 状态三者同一终态），
  // 不能先发 complete 帧再事后换 interrupted，否则广播与终态不一致。
  const runIncomplete = finalReport._source === "error-boundary";
  // 里程碑（完成）：finalReport.investigation = 稳定快照；报告 + 复核 + 探活后构建。
  const finalInvestigation = snapshots.complete(
    {
      claimAtoms: rumorStep.output.claimAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      atomSearchBundle,
      subclaimVerdicts: finalReport.subclaimVerdicts,
      sourceRelationAudits: sourceStep?.output?.claimSourceRelations,
      nonVerifiableAtoms: finalReport.nonVerifiableAtoms,
      crossExam: finalReport.crossExam,
      pursuitHops: evidenceLoop?.pursuitHops,
      report: finalReport,
      reachability: { deadUrls: deadCitationUrls },
      intakeLinks: input.intakeLinks,
      checkedAt: typeof finalReport.checkedAt === "string" ? finalReport.checkedAt : undefined,
    },
    { interrupted: runIncomplete, claim }
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

  const runId = input.runId ?? randomUUID();
  throwIfAborted();

  return {
    steps,
    finalReport,
    atomSearchBundle,
    search360Result,
    rumorStep,
    factStep,
    sourceStep,
    reportStep,
    evidenceLoop,
    crossExam,
    wholeClaimAudit,
    runId,
  };
}
