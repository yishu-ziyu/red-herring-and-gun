/**
 * Case Pipeline — production orchestration for one claim case.
 * 阶段：拆题 → 检索 → 核查与来源审计 → 冲突质询 → 唯一补查 → 正式判定 → 报告写作 → 收尾 → 记忆。
 * 本文件只排阶段顺序；各阶段在 stages/，进行态在 caseState.ts，时间预算在 budget.ts，里程碑快照在 snapshotTimeline.ts。
 * HTTP / SSE are thin adapters; inject runAgent + searchOne + selfProof model.
 */

import { randomUUID } from "node:crypto";
import type { SelfProofModelCall } from "../claimAtom/index.js";
import { claimAtomKey } from "../claimAtom/index.js";
import type { AtomSearchBundle, KnowledgeHit, KnowledgeInjection, SearchOneAtom } from "../atomSearch.js";
import { pruneDeadCitations, type LivenessDeps } from "../citationLiveness.js";
import { assembleFinalReport } from "../reportAssembly/index.js";
import { applySentenceVerdict, listAssessedClaims, settleClaimVerdicts } from "../sentenceVerdict.js";
import type { ReportReviewIssue } from "../reportReviewer.js";
import { buildMemoryCandidatesFromRun } from "../memoryCandidateGenerator.js";
import type { MemoryCandidate } from "../memoryCandidateTypes.js";
import type { MemoryCandidateStore } from "../memoryCandidateStore.js";
import type { EvidenceLoopOutcome, EvidenceLoopHooks, RewriteQueryModelCall } from "../evidenceLoop/index.js";
import type { ImageOriginResult } from "../imageOrigin/index.js";
import type { CrossExamOutcome, CrossExamRawModelCall } from "../crossExam/index.js";
import type { InvestigationSnapshotV1 } from "../investigation/index.js";
import { planFollowUpReuse } from "../followUpReuse.js";
import { withOriginalText } from "../originalEvidence.js";
import { createBudget } from "./budget.js";
import type { PipelineContext } from "./caseState.js";
import { finalizeReport } from "./finalizeReport.js";
import { createSnapshotTimeline } from "./snapshotTimeline.js";
import { compose } from "./stages/compose.js";
import { crossExamine } from "./stages/crossExamine.js";
import { decompose } from "./stages/decompose.js";
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

/**
 * 证据库端口（服务端实现见 `knowledgeStore.createKnowledgeMemory`，测试可注入内存实现）。
 *
 * 宪法边界（写死在这里）：
 * - **记忆只加速、不代替核查**：lookup 只给「上次核过这条命题时绑过的证据」，
 *   判词仍由本轮 fact_checker 重新判；绑定失败 / 判 unverified → settle 前的
 *   evidenceLoop 会自动对该 atom 联网补查。
 * - **没证据不出结论**：注入证据必须带真实 URL，空来源一律当没命中（在 atomSearch 里再兜一道）。
 * - **不静默继承**：匹配闸门在 knowledgeMatch.ts；人物/日期/链接换了就匹配不上 → 正常联网。
 * 不传这个端口 = 整条管线与没有记忆时逐字节等价（老行为）。
 */
export type KnowledgeMemoryPort = {
  lookup: (atom: string) => KnowledgeInjection | null;
  markInjected: (atom: string, originDate: string) => void;
  /** 注入过的 atom 最终仍 unverified / 证据不足 → 记 downgraded。 */
  conclude: (verdicts: unknown) => void;
  /** 收尾沉淀：可核查且判词非 unverified 的 atom → upsert 一条。 */
  settle: (input: { claim: string; verdicts: unknown; sourceBundle?: Pick<AtomSearchBundle, "byAtomKey"> }) => void;
};

export type CasePipelineHooks = {
  /** after self-proof written on rumor step */
  onSelfProof?: (info: { kept: string[]; dropped: unknown[]; model: string }) => void;
  /** atom search lifecycle (SSE) */
  onAtomSearchStart?: (atom: string) => void;
  onAtomSearchResult?: (atom: string, result: unknown) => void;
  /** 命中知识库、免于本次检索（活动流 knowledge_hit 行） */
  onKnowledgeHit?: (hit: KnowledgeHit) => void;
  /** 同一案上一轮证据够用、不再检索已核命题（活动流 prior_round_reuse 行） */
  onPriorRoundReuse?: (hit: KnowledgeHit) => void;
  /** between fact//source and report (e.g. consensus debate SSE) */
  afterFactSource?: (ctx: {
    steps: PipelineStep[];
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
  }) => Promise<void>;
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
  /** memory candidate propose — tool_start style (SSE) */
  onMemoryWriteStart?: (info: { toolName: string; query: string }) => void;
  /** memory candidate propose — tool_result style (SSE) */
  onMemoryWriteResult?: (info: {
    toolName: string;
    query: string;
    proposedCandidateCount: number;
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
  runAgent: RunAgentFn;
  searchOne: SearchOneAtom;
  callSelfProofModel: SelfProofModelCall;
  /** report_composer with deterministic fallback */
  runReport: (args: {
    claim: string;
    steps: PipelineStep[];
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
    judgment: Record<string, unknown>;
    verifiedQuotes: Array<Record<string, unknown>>;
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
  /** stable id for memory provenance; default randomUUID */
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
   * When set, proposed candidates are persisted after the run.
   * Handlers should pass the shared JsonlMemoryCandidateStore.
   * When omitted, candidates are still built and returned (no I/O).
   */
  memoryCandidateStore?: MemoryCandidateStore;
  /**
   * Screenshot reverse-image lookup (P2 origin gate). Beside searchOne.
   * OCR/text hits must not become image origin.
   */
  lookupImageOrigin?: () => Promise<ImageOriginResult>;
  /**
   * 引用探活依赖（「来源能点开」门）。默认真实网络探活；
   * `false` 关闭；测试传 { liveness: Map } 注入结果避免触网。
   */
  citationLiveness?: LivenessDeps | false;
  /**
   * 证据库（Part 1 · 记忆复用）：逐 atom 联网前查库、命中免检索、finalize 后沉淀。
   * 不传 = 无记忆行为（与旧版逐字节等价）。
   */
  knowledgeBase?: KnowledgeMemoryPort;
  /** Read saved article text first and require a body-checked quote for directional evidence. */
  archiveEvidence?: boolean;
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
  /** proposed memory candidates (same shape as AgentRuntime) */
  memoryCandidates: MemoryCandidate[];
  /** evidence sufficiency loop outcome — ADR-004（未开启或无触发时为 undefined） */
  evidenceLoop?: EvidenceLoopOutcome;
  /** cross exam outcome — G3/P1（未开启 / 无冲突 / 无注入时为 undefined） */
  crossExam?: CrossExamOutcome;
  runId: string;
  /** Screenshot origin from reverse-image; absent when the case has no image. */
  imageOrigin?: ImageOriginResult;
};

const REPORT_REVIEWER_TOOL = "Report Reviewer (proposer-reviewer)";
const MEMORY_WRITE_TOOL = "Agent Memory Write";

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  if (input.archiveEvidence) input = { ...input, searchOne: withOriginalText(input.searchOne, input.signal) };
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
  };

  const rumorStep = await decompose(ctx);
  throwIfAborted();
  const retrieval = await retrieve(ctx, rumorStep);
  throwIfAborted();
  const state = await judge(ctx, rumorStep, retrieval);
  await crossExamine(ctx, state);
  await pursueEvidence(ctx, state);

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

  if (hooks?.afterFactSource) {
    await hooks.afterFactSource({
      steps,
      factStep: state.factStep,
      sourceStep: state.sourceStep,
      search360Result: state.search360Result,
      atomSearchBundle: state.atomSearchBundle,
    });
  }

  const judgment = {} as Record<string, unknown>;
  assembleFinalReport({
    finalReport: judgment,
    rumorStep,
    verdicts: state.factStep.output.subclaimVerdicts,
    atomSearchBundle: state.atomSearchBundle,
  });
  const preservedUrls = new Set(Object.values(state.atomSearchBundle.byAtomKey).flat()
    .filter((source) => source.originalText)
    .map((source) => source.url));
  let deadCitationUrls: string[] = [];
  try {
    const pruned = await pruneDeadCitations(judgment, input.citationLiveness === false
      ? { liveness: new Map(), signal: input.signal }
      : { ...input.citationLiveness, signal: input.signal, deadlineMs: input.deadline, preservedUrls });
    deadCitationUrls = pruned.deadUrls;
  } catch (error) {
    throwIfAborted();
    console.warn(`[casePipeline] 引用探活失败，沿用已审材料: ${String(error)}`);
  }
  settleClaimVerdicts(judgment);
  applySentenceVerdict(judgment, listAssessedClaims(judgment, {
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
  }));
  const verifiedQuotes = Array.isArray(state.sourceStep.output.claimSourceRelations)
    ? (state.sourceStep.output.claimSourceRelations as Array<Record<string, unknown>>)
        .filter((row) => row.quoteVerified === true && typeof row.quote === "string")
        .map((row) => ({ ...row,
          originalScope: state.atomSearchBundle.byAtomKey[claimAtomKey(String(row.claimAtom ?? ""))]
            ?.find((source) => source.url === row.url)?.originalScope,
        }))
    : [];
  const reportStep = await compose(ctx, state, judgment, verifiedQuotes);
  const { atomSearchBundle, search360Result, imageOrigin, evidenceLoop, crossExam } = state;
  const { factStep, sourceStep } = state;
  const { finalReport, review } = await finalizeReport({
    claim,
    reportStep,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
    imageOrigin,
    crossExam,
    evidenceLoop,
    judgment,
    finalizeHook: input.finalizeReport,
    onReviewStart: () => hooks?.onReportReviewStart?.({ toolName: REPORT_REVIEWER_TOOL, query: claim }),
    signal: input.signal,
  });
  // 里程碑（完成）：finalReport.investigation = 稳定快照；报告 + 复核 + 探活后构建。
  const finalInvestigation = snapshots.complete({
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
    checkedAt: typeof finalReport.checkedAt === "string" ? finalReport.checkedAt : undefined,
  });
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

  // Phase 3b2: 证据库收尾（Part 1 · 记忆复用）。
  // 到这里判词已经是最终值（复核 / 探活 / 收权门 / repair 全部走过）：
  //  - conclude：注入过的 atom 若最终仍 unverified/证据不足 → 记 downgraded
  //    （它的联网补查已经由上面的 evidenceLoop 做过，此处只观测，不改判词）；
  //  - settle：可核查且判词非 unverified 的 atom → 沉淀进知识库。
  // 记忆层失败不得改这次调查的结局：端口实现内部兜住并记服务端日志。
  if (input.knowledgeBase) {
    throwIfAborted();
    try {
      input.knowledgeBase.conclude(finalReport.subclaimVerdicts);
      input.knowledgeBase.settle({ claim, verdicts: finalReport.subclaimVerdicts,
        sourceBundle: { byAtomKey: atomSearchBundle.byAtomKey } });
    } catch (error) {
      console.error("[casePipeline] 知识库收尾失败", error);
    }
  }

  // Phase 3c: propose memory candidates (same as AgentRuntime memory write)
  const runId = input.runId ?? randomUUID();
  throwIfAborted();
  hooks?.onMemoryWriteStart?.({
    toolName: MEMORY_WRITE_TOOL,
    query: claim,
  });
  const memoryCandidates = buildMemoryCandidatesFromRun({
    runId,
    claim,
    steps,
    finalReport,
    searchResult: search360Result as Parameters<typeof buildMemoryCandidatesFromRun>[0]["searchResult"],
  });
  if (input.memoryCandidateStore && memoryCandidates.length > 0) {
    throwIfAborted();
    await input.memoryCandidateStore.propose(memoryCandidates);
  }
  throwIfAborted();
  hooks?.onMemoryWriteResult?.({
    toolName: MEMORY_WRITE_TOOL,
    query: claim,
    proposedCandidateCount: memoryCandidates.length,
  });

  return {
    steps,
    finalReport,
    atomSearchBundle,
    search360Result,
    rumorStep,
    factStep,
    sourceStep,
    reportStep,
    memoryCandidates,
    evidenceLoop,
    crossExam,
    runId,
    imageOrigin,
  };
}
