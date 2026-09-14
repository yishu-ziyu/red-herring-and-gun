/**
 * Case Pipeline — production orchestration for one claim case.
 * Depth: rumor → self-proof → per-atom search → fact//source → report → assemble → review.
 * HTTP / SSE are thin adapters; inject runAgent + searchOne + selfProof model.
 */

import { randomUUID } from "node:crypto";
import {
  claimAtomKey,
  collapseNarrativeAtoms,
  ensureLeapAtoms,
  forceCheckableAtomTypes,
  prefilterClaimAtoms,
  retainAtomTypes,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../claimAtom/index.js";
import {
  retrieveForAtoms,
  buildAtomSearchBundle,
  bindAtomEvidenceToVerdicts,
  type AtomSearchBundle,
  type KnowledgeHit,
  type KnowledgeInjection,
  type SearchOneAtom,
} from "../atomSearch.js";
import { assembleFinalReport, deriveOverallVerdict, faceVerdictFor } from "../reportAssembly/index.js";
import { looksLikePlanOrPrediction, boundTinyRumorVerdict } from "../atomSearchQuery.js";
import { normalizeReportCitations } from "../citationBinding.js";
import { pruneDeadCitations, type LivenessDeps } from "../citationLiveness.js";
import {
  reviewAndRepairReport,
  type ReportReviewIssue,
} from "../reportReviewer.js";
import { buildMemoryCandidatesFromRun } from "../memoryCandidateGenerator.js";
import type { MemoryCandidate } from "../memoryCandidateTypes.js";
import type { MemoryCandidateStore } from "../memoryCandidateStore.js";
import {
  findLoopTargets,
  runEvidenceLoop,
  MAX_EVIDENCE_LOOP_PASSES,
  MAX_EVIDENCE_LOOP_ROUNDS,
  type EvidenceLoopAtomOutcome,
  type EvidenceLoopOutcome,
  type EvidenceLoopHooks,
  type RewriteQueryModelCall,
} from "../evidenceLoop/index.js";
import { mergeSourcesIntoBundle } from "../evidenceLoop/evidenceLoop.js";
import { compactPursuitHops, type PursuitHop } from "../evidencePursuit/index.js";
import {
  applyImageOriginToReport,
  type ImageOriginResult,
} from "../imageOrigin/index.js";
import {
  findCrossExamTargets,
  makeSecondOpinionCall,
  runCrossExam,
  type CrossExamOutcome,
  type CrossExamRawModelCall,
} from "../crossExam/index.js";
import {
  buildInvestigationSnapshot,
  type InvestigationBuildInput,
  type InvestigationSnapshotV1,
} from "../investigation/index.js";
import {
  applyCheckabilityRevisions,
  applyConclusionGate,
  needsConstrainedConclusion,
  repairGatedConclusion,
  resolveQuestionAtomKey,
  runWholeClaimEvaluation,
  runWholeClaimPlanning,
  type WholeClaimAuditModelCall,
  type WholeClaimAuditQuestion,
  type WholeClaimAuditRun,
} from "../wholeClaimAudit/index.js";
import {
  applyFollowUpAnswerLead,
  collapseFollowUpAtoms,
  planFollowUpReuse,
  priorRoundLookupOf,
  reusedAtomKeysOf,
} from "../followUpReuse.js";
import { applyUnopenedLinkConclusion } from "../publicCopy.js";

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
};

export type RunAgentFn = (
  agentId: string,
  steps: PipelineStep[],
  search360Result?: unknown,
  atomSearchBundle?: AtomSearchBundle | null
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
  settle: (input: { claim: string; verdicts: unknown }) => void;
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
   * Whole-Claim Audit（Issue #78）：整句在拆题后继续作为被审计对象。
   * Planning（检索前，可核查性语义修订）→ Evaluation（初轮后，≤1 次 audit 补查）。
   * 未注入 callModel 时保持 legacy 行为（fail-open）。
   */
  wholeClaimAudit?: {
    callModel?: WholeClaimAuditModelCall;
  };
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
  /** Whole-Claim Audit outcome — Issue #78（未注入模型时 plan/evaluation 为 null） */
  wholeClaimAudit: WholeClaimAuditRun;
  runId: string;
  /** Screenshot origin from reverse-image; absent when the case has no image. */
  imageOrigin?: ImageOriginResult;
};

const REPORT_REVIEWER_TOOL = "Report Reviewer (proposer-reviewer)";
const MEMORY_WRITE_TOOL = "Agent Memory Write";

function fallbackRumorStep(claim: string, error: unknown): PipelineStep {
  const text = claim.replace(/\s+/g, " ").trim() || claim;
  const type = looksLikePlanOrPrediction(text) ? "prediction" : "fact";
  return {
    agent: "rumor_detector",
    agentName: "RumorDetector",
    output: {
      claimAtoms: [text],
      claimAtomTypes: [{ text, verifiable: true, type }],
      stanceClaimType: {
        verifiable: true,
        type,
        reason: "拆题模型失败，整句按可核查流传说法继续检索",
      },
      rumorIndicators: [],
      severity: "medium",
      analysis: "拆题服务未完成，已把原句当作一条可核查判断继续检索。",
      detectedPatterns: [],
    },
    status: "completed",
    error: error instanceof Error ? error.message : "rumor_detector failed",
    timestamp: Date.now(),
  };
}

function fallbackAgentStep(agentId: string, error: unknown, search360Result?: unknown, _claim = ""): PipelineStep {
  const message = error instanceof Error ? error.message : `${agentId} failed`;
  const sources = Array.isArray((search360Result as { sources?: unknown[] } | undefined)?.sources)
    ? ((search360Result as { sources: Array<{ title?: unknown; snippet?: unknown; url?: unknown }> }).sources)
    : [];
  const urls = sources
    .map((s) => String(s.url || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 4);
  if (agentId === "fact_checker") {
    return {
      agent: "fact_checker",
      output: {
        factCheckResult: "unverified",
        confidence: "low",
        sources: urls,
        keyFindings: ["核查模型未完成，结论只能依据检索到的公开材料。"],
        counterEvidence: [],
        subclaimVerdicts: [],
      },
      status: "completed",
      error: message,
      timestamp: Date.now(),
    };
  }
  return {
    agent: "source_validator",
    output: {
      sourceReliability: "unverified",
      verifiedSources: [],
      questionableSources: [],
      missingSources: ["信源审计模型未完成"],
      verificationNotes: "信源审计未完成，请直接看来源链接。",
    },
    status: "completed",
    error: message,
    timestamp: Date.now(),
  };
}

/**
 * self-proof 全丢兜底（主路 P0 Change B）：模型偶发把全部候选判为不支持时，
 * 先重试一次；仍全丢则 fail-open 保留全部候选继续管道，不让拆题结果凭空归零。
 * 判定标准与拆题候选都不改，只兜「全丢」这一种结局。
 */
async function runSelfProofWithRetry(
  claim: string,
  rawAtoms: unknown,
  callModel: SelfProofModelCall
): Promise<Awaited<ReturnType<typeof runClaimAtomSelfProof>>> {
  const first = await runClaimAtomSelfProof(claim, rawAtoms, callModel);
  if (first.kept.length > 0) return first;
  // 候选为空 = 本来就没有可保留的命题，不是「全丢」，不重试也不兜底。
  const candidates = prefilterClaimAtoms(claim, rawAtoms).atoms;
  if (candidates.length === 0) return first;
  const retried = await runClaimAtomSelfProof(claim, rawAtoms, callModel);
  if (retried.kept.length > 0) return retried;
  console.warn(
    `[casePipeline] self-proof 两次均未保留任何候选（候选 ${candidates.length} 条），` +
      `fail-open 保留全部候选继续管道；被丢弃的候选：${retried.dropped
        .slice(0, 3)
        .map((item) => item.text)
        .join(" / ")}`
  );
  // kept 已覆盖全部候选，没有任何候选被这一闸门丢掉。
  return { kept: candidates, dropped: [], model: retried.model };
}

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  const { claim, runAgent, searchOne, callSelfProofModel, runReport, hooks, finalizeReport } = input;
  const steps: PipelineStep[] = [];

  // 协作式取消：各阶段边界检查一次。fail-open 的 catch 会吞掉 AbortError，
  // 所以下一个边界必须再查，断连后最多再浪费一个阶段调用就会整体退出。
  const throwIfAborted = () => input.signal?.throwIfAborted();
  throwIfAborted();

  // Investigation Snapshot（Issue #51）：语义里程碑发完整快照；构建失败不阻断管线。
  let investigationBase: InvestigationBuildInput | undefined;
  const searchedAtoms: string[] = [];
  const emitInvestigation = (patch: Partial<InvestigationBuildInput> & { phase: InvestigationBuildInput["phase"] }): InvestigationSnapshotV1 | null => {
    if (!hooks?.onInvestigationSnapshot) return null;
    try {
      investigationBase = { ...(investigationBase ?? {}), ...patch, originalClaim: patch.originalClaim ?? claim } as InvestigationBuildInput;
      const snapshot = buildInvestigationSnapshot(investigationBase, { claimAtomKeyFn: claimAtomKey });
      hooks.onInvestigationSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.warn(`[casePipeline] investigation snapshot 构建失败: ${String(error)}`);
      return null;
    }
  };
  emitInvestigation({ phase: "received" });

  // 时间预算：证据补查/交叉复核/因果增强是「锦上添花」，报告写作是「必须发生」。
  // 剩余时间不足时提前收敛补查类阶段，把时间让给 ReportComposer。
  const COMPOSER_RESERVE_MS = 90_000;
  const CROSS_EXAM_MIN_MS = 45_000;
  const EVIDENCE_PASS_MIN_MS = 100_000;
  /** Whole-Claim Audit（Issue #78）：Planning / Evaluation 各自的最低启动余量。 */
  const AUDIT_MIN_MS = 45_000;
  /** 每次 Audit 最多提出的高价值问题数（Issue #78 §8）。 */
  const MAX_AUDIT_QUESTIONS = 3;
  const timeLeftMs = () =>
    input.deadline == null ? Number.POSITIVE_INFINITY : input.deadline - Date.now();

  const reusePlan = input.followUpReuse
    ? planFollowUpReuse({
        claim,
        priorReport: input.followUpReuse.priorReport,
        priorClaim: input.followUpReuse.priorClaim,
        priorCreatedAt: input.followUpReuse.priorCreatedAt,
      })
    : null;

  const wholeClaimAudit: WholeClaimAuditRun = {
    plan: null,
    evaluation: null,
    extraPass: null,
    model: "",
    reevaluation: null,
  };
  let auditUnresolvedGaps: string[] = [];
  const auditCallModel = input.wholeClaimAudit?.callModel;

  // Phase 1: RumorDetector — fail-open to the original sentence so search still runs.
  // 同一案追问且上一轮有可点开证据：不再完整拆题，沿用已核命题（+ 新冒出来的小问题）。
  let rumorStep: PipelineStep;
  if (reusePlan) {
    rumorStep = {
      agent: "rumor_detector",
      agentName: "RumorDetector",
      output: {
        claimAtoms: reusePlan.atoms,
        claimAtomTypes: reusePlan.atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
        claimAtomSelfProof: { kept: reusePlan.atoms, dropped: [], model: "followup-reuse:skip" },
        stanceClaimType: {
          verifiable: true,
          type: "fact",
          reason: "同一条核查的追问，沿用上一轮已拆命题",
        },
        rumorIndicators: [],
        severity: "medium",
        analysis: "追问沿用上一轮已拆命题，不再完整拆题。",
        detectedPatterns: [],
      },
      status: "completed",
      timestamp: Date.now(),
    };
    steps.push(rumorStep);
  } else {
    try {
      rumorStep = await runAgent("rumor_detector", steps);
    } catch (error) {
      rumorStep = fallbackRumorStep(claim, error);
    }
    steps.push(rumorStep);

    throwIfAborted();
    // 拆题后再自证：长文先抽断言、追问先收成这句追问，避免自证 9 条课文或把 IARC 拆出来顶替。
    const rawAtoms = Array.isArray(rumorStep?.output?.claimAtoms) ? rumorStep.output.claimAtoms : [];
    const narrowed = ensureLeapAtoms(claim, collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, rawAtoms)));
    if (!rumorStep.output || typeof rumorStep.output !== "object") {
      rumorStep.output = {};
    }
    rumorStep.output.claimAtoms = narrowed;
    rumorStep.output.claimAtomTypes = retainAtomTypes(narrowed, rumorStep.output.claimAtomTypes);
    // 拆题模型已经回来：有命题就立刻上屏，不等自证。没拆出条才停在核对句。
    if (!rumorStep.error && narrowed.length > 0) {
      emitInvestigation({ phase: "decomposed", claimAtoms: narrowed });
    } else if (!rumorStep.error) {
      emitInvestigation({ phase: "received", preClaimWork: "checking" });
    }
    const selfProof = rumorStep.error
      ? (() => {
          const pre = prefilterClaimAtoms(claim, rumorStep?.output?.claimAtoms ?? []);
          return { kept: pre.atoms, dropped: pre.dropped, model: "fallback:skip-after-rumor-error" };
        })()
      : await runSelfProofWithRetry(claim, rumorStep?.output?.claimAtoms ?? [], callSelfProofModel);
    rumorStep.output.claimAtoms = ensureLeapAtoms(
      claim,
      collapseFollowUpAtoms(claim, collapseNarrativeAtoms(claim, selfProof.kept)),
    );
    rumorStep.output.claimAtomSelfProof = {
      kept: rumorStep.output.claimAtoms,
      dropped: selfProof.dropped,
      model: selfProof.model,
    };
    rumorStep.output.claimAtomTypes = retainAtomTypes(
      rumorStep.output.claimAtoms,
      forceCheckableAtomTypes(rumorStep.output.claimAtomTypes)
    );
    hooks?.onSelfProof?.({ ...selfProof, kept: rumorStep.output.claimAtoms });

    if (auditCallModel && timeLeftMs() > AUDIT_MIN_MS) {
      const planning = await runWholeClaimPlanning({
        claim,
        keptAtoms: Array.isArray(rumorStep.output.claimAtoms) ? (rumorStep.output.claimAtoms as string[]) : [],
        claimAtomTypes: rumorStep.output.claimAtomTypes,
        stanceClaimType: rumorStep.output.stanceClaimType,
        callModel: auditCallModel,
      });
      if (planning) {
        const revised = applyCheckabilityRevisions(
          rumorStep.output.claimAtomTypes,
          Array.isArray(rumorStep.output.claimAtoms) ? (rumorStep.output.claimAtoms as string[]) : [],
          planning.plan.checkabilityRevisions
        );
        rumorStep.output.claimAtomTypes = revised.claimAtomTypes;
        wholeClaimAudit.plan = planning.plan;
        wholeClaimAudit.model = planning.model;
        rumorStep.output.wholeClaimAuditPlan = {
          overallQuestion: planning.plan.overallQuestion,
          checkabilityRevisions: planning.plan.checkabilityRevisions,
          appliedRevisions: revised.applied,
          ignoredRevisions: revised.ignored,
          missingJustifications: planning.plan.missingJustifications,
          model: planning.model,
        };
        auditUnresolvedGaps = [...(planning.plan.missingJustifications ?? [])];
      }
    }
  }

  // 里程碑：拆题完成（self-proof 后保留的原子才是用户主张；dropped 不进 claims）。
  emitInvestigation({
    phase: "decomposed",
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
  });

  throwIfAborted();
  // Phase 1b: per-atom retrieval (+ screenshot reverse-image beside searchOne)
  // 记忆层先查库：命中且新鲜的 atom 用知识库证据替换联网检索（不占 6 个名额），
  // 命中的原子在 hooks.onKnowledgeHit 里落一条活动行。
  const { atomSearchBundle, search360Result } = await retrieveForAtoms({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    searchOne,
    claimAtomKeyFn: claimAtomKey,
    lookupImageOrigin: input.lookupImageOrigin,
    knowledge: input.knowledgeBase
      ? {
          lookup: input.knowledgeBase.lookup,
          onInjected: (hit) => {
            try {
              input.knowledgeBase?.markInjected(hit.atom, hit.originDate);
            } catch (error) {
              console.error("[casePipeline] 知识库注入记录失败", error);
            }
            hooks?.onKnowledgeHit?.(hit);
          },
        }
      : undefined,
    priorRound: reusePlan
      ? {
          lookup: priorRoundLookupOf(reusePlan),
          onInjected: (hit) => hooks?.onPriorRoundReuse?.(hit),
        }
      : undefined,
    hooks: {
      mode: hooks?.searchMode ?? "parallel",
      onAtomStart: (atom) => {
        // 里程碑：单个原子检索开始（声明该命题进入 searching；来源未返回不预填）。
        searchedAtoms.push(atom);
        emitInvestigation({
          phase: "investigating",
          claimAtoms: rumorStep.output.claimAtoms,
          claimAtomTypes: rumorStep.output.claimAtomTypes,
          atomSearchBundle: { atomsSearched: [...searchedAtoms], byAtomKey: {} },
        });
        hooks?.onAtomSearchStart?.(atom);
      },
      onAtomResult: hooks?.onAtomSearchResult,
    },
  });
  const imageOrigin = atomSearchBundle.imageOrigin;
  // 里程碑：检索返回——来源此时只能是 unassessed（尚未核查）。
  emitInvestigation({
    phase: "investigating",
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
  });

  throwIfAborted();
  // Phase 2: FactChecker // SourceValidator — fail-open so检索到的 URL 仍能进报告
  const [factSettled, sourceSettled] = await Promise.allSettled([
    runAgent("fact_checker", steps, search360Result, atomSearchBundle),
    runAgent("source_validator", steps, search360Result, atomSearchBundle),
  ]);
  let factStep =
    factSettled.status === "fulfilled"
      ? factSettled.value
      : fallbackAgentStep("fact_checker", factSettled.reason, search360Result, claim);
  const sourceStep =
    sourceSettled.status === "fulfilled"
      ? sourceSettled.value
      : fallbackAgentStep("source_validator", sourceSettled.reason, search360Result, claim);
  steps.push(factStep, sourceStep);

  throwIfAborted();
  // 里程碑：核查绑定开始（判词与证据关系出现；来源不再是 unassessed）。
  emitInvestigation({
    phase: "judging",
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
    subclaimVerdicts: factStep?.output?.subclaimVerdicts,
  });
  // Phase 2a: Evidence sufficiency loop — ADR-004 + 翻案续期
  // 提问 → 重判 → 判词仍翻转中且问题仍产证据 → 换策略再问（pass 2+）→ 再重判。
  // 好问题续命（翻转判词的提问 earns another pass），坏问题判停（整 pass 零新增）。
  let evidenceLoop: EvidenceLoopOutcome | undefined;
  const loopAtoms = reusePlan
    ? atomSearchBundle.atomsSearched.filter((atom) => !reusedAtomKeysOf(reusePlan).has(claimAtomKey(atom)))
    : atomSearchBundle.atomsSearched;
  if (input.evidenceLoop?.enabled !== false && loopAtoms.length > 0) {
    const roundsPerPass = Math.max(
      1,
      input.evidenceLoop?.maxRounds ?? MAX_EVIDENCE_LOOP_ROUNDS
    );
    const maxPasses = Math.max(
      1,
      input.evidenceLoop?.maxPasses ?? MAX_EVIDENCE_LOOP_PASSES
    );
    const atomOutcomes = new Map<string, EvidenceLoopAtomOutcome>();
    const currentVerdicts = () =>
      Array.isArray(factStep?.output?.subclaimVerdicts)
        ? (factStep!.output.subclaimVerdicts as Array<Record<string, unknown>>)
        : [];
    let totalNewSources = 0;
    let recheckFactChecker = false;
    let passes = 0;
    const pursuitHops: PursuitHop[] = [];

    while (passes < maxPasses) {
      if (timeLeftMs() < EVIDENCE_PASS_MIN_MS) break;
      passes += 1;
      const seedQueriesByAtomKey: Record<string, string[]> = {};
      for (const [key, outcome] of atomOutcomes) {
        seedQueriesByAtomKey[key] = outcome.rounds.map((r) => r.query);
      }
      const passOutcome = await runEvidenceLoop({
        claim,
        bundle: { ...atomSearchBundle, atomsSearched: loopAtoms },
        factVerdicts: currentVerdicts(),
        searchOne,
        claimAtomKeyFn: claimAtomKey,
        callRewriteModel: input.evidenceLoop?.callRewriteModel,
        maxRounds: roundsPerPass,
        startRound: (passes - 1) * roundsPerPass + 1,
        seedQueriesByAtomKey,
        needImageOrigin: Boolean(input.lookupImageOrigin),
        shouldStopEarly: () => timeLeftMs() < COMPOSER_RESERVE_MS,
        hooks: {
          onLoopStart: hooks?.onEvidenceLoopStart,
          onRoundStart: hooks?.onEvidenceLoopRoundStart,
          onRoundResult: hooks?.onEvidenceLoopRoundResult,
          onAtomStopped: hooks?.onEvidenceLoopStopped,
        },
      });
      for (const a of passOutcome.atoms) {
        const prev = atomOutcomes.get(a.atomKey);
        if (prev) {
          prev.rounds.push(...a.rounds);
          prev.stopReason = a.stopReason;
          prev.trigger = a.trigger;
        } else {
          atomOutcomes.set(a.atomKey, { ...a, rounds: [...a.rounds] });
        }
      }
      totalNewSources += passOutcome.totalNewSources;
      if (passOutcome.pursuitHops?.length) pursuitHops.push(...passOutcome.pursuitHops);
      // 坏问题停：整 pass 零新增（边际增益判停）
      if (!passOutcome.recheckFactChecker) break;
      if (timeLeftMs() < COMPOSER_RESERVE_MS) break;
      recheckFactChecker = true;
      // 有新证据 → 重判（判词可能翻转）
      try {
        const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
        steps.push(rechecked);
        factStep = rechecked;
      } catch {
        // 重判失败保留原 factStep；补查证据已入 bundle，报告/溯源仍可见。不再续期。
        break;
      }
      // 问完了：重判后无 unverified / 冲突原子 → 停
      const remaining = findLoopTargets({
        atomsSearched: loopAtoms,
        verdicts: currentVerdicts(),
        claimAtomKeyFn: claimAtomKey,
      });
      if (remaining.length === 0) break;
      // 仍有未解决原子且上一 pass 问题还在产证据 → 翻案续期（下一 pass 换策略）
    }

    // 里程碑：证据补查收束（判词可能翻转；缺口与追索目标入快照）。
    emitInvestigation({
      phase: "judging",
      claimAtoms: rumorStep.output.claimAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      atomSearchBundle,
      subclaimVerdicts: factStep?.output?.subclaimVerdicts,
      pursuitHops,
    });
    if (atomOutcomes.size > 0) {
      evidenceLoop = {
        ran: true,
        atoms: [...atomOutcomes.values()],
        totalNewSources,
        recheckFactChecker,
        passes,
        pursuitHops,
      };
    }
  }

  // Phase 2b: 最多两条命题，各一次独立质询、定向补查、主调查回应。
  let crossExam: CrossExamOutcome | undefined;
  if (
    input.crossExam?.enabled !== false &&
    input.crossExam?.callRaw &&
    timeLeftMs() > CROSS_EXAM_MIN_MS
  ) {
    const factVerdicts = Array.isArray(factStep?.output?.subclaimVerdicts)
      ? (factStep.output.subclaimVerdicts as Array<Record<string, unknown>>)
      : [];
    const crossTargets = findCrossExamTargets({
      verdicts: factVerdicts,
      bundle: atomSearchBundle,
      claimAtomKeyFn: claimAtomKey,
    });
    {
      throwIfAborted();
      crossExam = await runCrossExam({
        claim,
        targets: crossTargets,
        callSecondOpinion: makeSecondOpinionCall(input.crossExam.callRaw),
        signal: input.signal,
        deadline: input.deadline,
        shouldStop: () => timeLeftMs() < COMPOSER_RESERVE_MS,
        search: async (target, query) => {
          const result = await searchOne(query);
          if ((result as { _source?: string } | null)?._source === "tool-error") throw new Error("定向补查失败");
          const found = buildAtomSearchBundle([{ atom: target.atom, result }], claimAtomKey);
          const incoming = found.byAtomKey[target.atomKey] ?? [];
          mergeSourcesIntoBundle(atomSearchBundle, target.atomKey, incoming, claimAtomKey);
          return incoming.filter(s => (atomSearchBundle.byAtomKey[target.atomKey] ?? []).some(known => known.url === s.url));
        },
        respond: async (target, challenge) => {
          steps.push({ agent: "cross_examiner", output: { kind: "cross_exam", atoms: [challenge] }, timestamp: Date.now() });
          const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
          if (rechecked.error || rechecked.status === "failed") throw new Error("回应未完成");
          const verdicts = Array.isArray(rechecked.output?.subclaimVerdicts) ? rechecked.output.subclaimVerdicts as Array<{ claimAtom: string; [key: string]: unknown }> : [];
          // 不让一次不完整的回应替换整份调查，也不接受没有回应说明的暗中改判。
          const previousVerdicts = Array.isArray(factStep?.output?.subclaimVerdicts)
            ? factStep.output.subclaimVerdicts as Array<{ claimAtom: string }> : [];
          const expectedKeys = new Set(previousVerdicts.map(v => claimAtomKey(v.claimAtom)));
          const returnedKeys = new Set(verdicts.filter(v => v && typeof v.claimAtom === "string").map(v => claimAtomKey(v.claimAtom)));
          const reply = verdicts.find(v => v && typeof v.claimAtom === "string" && claimAtomKey(v.claimAtom) === target.atomKey);
          if (returnedKeys.size !== verdicts.length || returnedKeys.size !== expectedKeys.size ||
              [...expectedKeys].some(key => !returnedKeys.has(key)) ||
              typeof reply?.crossExamResponse !== "string" || !reply.crossExamResponse.trim()) {
            throw new Error("主调查回应不完整，保留先前调查");
          }
          rechecked.output.subclaimVerdicts = bindAtomEvidenceToVerdicts(verdicts, atomSearchBundle.byAtomKey, claimAtomKey);
          steps.push(rechecked);
          factStep = rechecked;
          const verdict = (rechecked.output.subclaimVerdicts as typeof verdicts).find(v => claimAtomKey(v.claimAtom) === target.atomKey);
          return {
            response: typeof verdict?.crossExamResponse === "string" ? verdict.crossExamResponse : "",
            finalVerdict: typeof verdict?.verdict === "string" ? verdict.verdict : undefined,
            sources: [...(Array.isArray(verdict?.supportingSources) ? verdict.supportingSources : []), ...(Array.isArray(verdict?.contradictingSources) ? verdict.contradictingSources : [])],
          };
        },
      });
      steps.push({
        agent: "cross_examiner",
        agentName: "CrossExaminer",
        output: {
          kind: "cross_exam",
          atoms: crossExam.atoms,
          confidenceAdjustment: crossExam.confidenceAdjustment,
          model: crossExam.model,
        },
        model: crossExam.model,
        status: "completed",
        timestamp: Date.now(),
      });
    }
  } else {
    crossExam = { ran: false, atoms: [], confidenceAdjustment: 0, model: "", skippedReason: input.crossExam?.enabled === false ? "质询已关闭" : !input.crossExam?.callRaw ? "未接入独立复核" : "质询时间预算不足" };
  }

  // 里程碑：质询收束（冲突 reason 已知/未知如实标注；质询未运行不影响冲突存在性）。
  emitInvestigation({
    phase: "judging",
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
    subclaimVerdicts: factStep?.output?.subclaimVerdicts,
    crossExam,
    pursuitHops: evidenceLoop?.pursuitHops,
  });

  if (hooks?.afterFactSource) {
    await hooks.afterFactSource({
      steps,
      factStep,
      sourceStep,
      search360Result,
      atomSearchBundle,
    });
  }

  // Phase 2a: Causal enrichment — 仅当 RumorDetector 拆出的原子含因果断言时，
  // 并行运行替代解释搜索 + 反证评分，失败可继续（不阻断收束）。
  const hasCausalAtom = Array.isArray(rumorStep?.output?.claimAtomTypes)
    && rumorStep.output.claimAtomTypes.some((t) => (t as { type?: string })?.type === "causal");
  if (hasCausalAtom && timeLeftMs() > COMPOSER_RESERVE_MS) {
    const causalSteps = await Promise.allSettled([
      runAgent("alternative_explanation_searcher", steps, search360Result, atomSearchBundle),
      runAgent("counter_evidence_grader", steps, search360Result, atomSearchBundle),
    ]);
    for (const settled of causalSteps) {
      if (settled.status === "fulfilled") steps.push(settled.value);
    }
  }

  throwIfAborted();
  // Whole-Claim Evaluation（Issue #78 §7）：初轮核查完成后、报告前。
  // 回答「原句现在成立到哪里 / 最大缺口 / 下一步查什么」；LM 先验只能生成问题，
  // 不得成为 Evidence。最多 1 次 audit-driven 补查：只有能映射到真实 kept atom
  // 的问题才补查（复用 searchOne + bundle 合并 + fact_checker 重判）；纯桥接缺口只记录。
  // 失败/超预算时保守沿用 Planning 缺口基线（fail-closed，Review 5128449568 Blocker 2）。
  const writeAuditConservativeArtifact = (status: "failed" | "skipped-budget") => {
    rumorStep.output.wholeClaimAudit = {
      supportedWhere: "",
      biggestGap: "",
      missingJustifications: auditUnresolvedGaps,
      model: wholeClaimAudit.model,
      reevaluated: false,
      recheckCommitted: false,
      evaluationStatus: status,
    };
  };
  if (auditCallModel && timeLeftMs() > COMPOSER_RESERVE_MS) {
    const keptAuditAtoms = Array.isArray(rumorStep.output.claimAtoms)
      ? (rumorStep.output.claimAtoms as string[])
      : [];
    const evaluation = await runWholeClaimEvaluation({
      claim,
      keptAtoms: keptAuditAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      subclaimVerdicts: factStep?.output?.subclaimVerdicts,
      missingJustificationsFromPlan: wholeClaimAudit.plan?.missingJustifications,
      callModel: auditCallModel,
    });
    if (!evaluation) {
      wholeClaimAudit.evaluationStatus = "failed";
      writeAuditConservativeArtifact("failed");
    }
    if (evaluation) {
      wholeClaimAudit.evaluation = evaluation.evaluation;
      wholeClaimAudit.model = wholeClaimAudit.model || evaluation.model;
      const keptKeys = new Set(keptAuditAtoms.map((a) => claimAtomKey(a)));
      const searchables = evaluation.evaluation.nextQuestions
        .map((q) => ({ question: q, atomKey: resolveQuestionAtomKey(q, keptAuditAtoms) }))
        .filter((row): row is { question: WholeClaimAuditQuestion; atomKey: string } =>
          Boolean(row.atomKey && keptKeys.has(row.atomKey))
        )
        .slice(0, MAX_AUDIT_QUESTIONS);
      const newSourcesByAtomKey: Record<string, number> = {};
      const addedUrlsByAtomKey: Record<string, string[]> = {};
      let recheckCommitted = false;
      let newlyBoundEvidenceUrlsByAtomKey: Record<string, string[]> = {};
      if (searchables.length > 0 && timeLeftMs() > COMPOSER_RESERVE_MS) {
        for (const { question, atomKey } of searchables) {
          if (timeLeftMs() <= COMPOSER_RESERVE_MS) break;
          const query = (question.suggestedQuery || question.question).trim().slice(0, 160);
          let result: unknown;
          try {
            result = await searchOne(query);
          } catch {
            continue;
          }
          if ((result as { _source?: string } | null)?._source === "tool-error") continue;
          const found = buildAtomSearchBundle([{ atom: atomKey, result }], claimAtomKey);
          const beforeUrls = new Set(
            (atomSearchBundle.byAtomKey[atomKey] ?? []).map((s) => String(s.url ?? ""))
          );
          const before = (atomSearchBundle.byAtomKey[atomKey] ?? []).length;
          mergeSourcesIntoBundle(atomSearchBundle, atomKey, found.byAtomKey[atomKey] ?? [], claimAtomKey);
          const after = atomSearchBundle.byAtomKey[atomKey] ?? [];
          const gained = Math.max(0, after.length - before);
          if (gained > 0) {
            newSourcesByAtomKey[atomKey] = (newSourcesByAtomKey[atomKey] ?? 0) + gained;
            const added = after
              .map((s) => String(s.url ?? ""))
              .filter((u) => u && !beforeUrls.has(u));
            addedUrlsByAtomKey[atomKey] = [...(addedUrlsByAtomKey[atomKey] ?? []), ...added];
          }
        }
        // 拿到有效新证据才重判（同 evidence loop 纪律）；重判失败保留原判词。
        // 提交判定（Review 5128022550 Blocker 2）：只有重判成功返回合法目标 atom
        // 判词、经 bind 形成非 related-only 的 support/contradict relation、且实际
        // 引用了本次新 URL，才算 committed；否则第二次 Evaluation 无权关闭旧 gap。
        if (Object.keys(newSourcesByAtomKey).length > 0) {
          try {
            const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
            const recheckedVerdicts = rechecked?.output?.subclaimVerdicts;
            if (!rechecked.error && rechecked.status !== "failed" && Array.isArray(recheckedVerdicts) && recheckedVerdicts.length > 0) {
              const bound = bindAtomEvidenceToVerdicts(
                recheckedVerdicts as Array<{ claimAtom: string; [key: string]: unknown }>,
                atomSearchBundle.byAtomKey,
                claimAtomKey
              );
              rechecked.output.subclaimVerdicts = bound;
              const gainedKeys = Object.keys(newSourcesByAtomKey);
              const boundByKey: Record<string, string[]> = {};
              const committed = gainedKeys.every((atomKey) => {
                const verdict = (bound as Array<Record<string, unknown>>).find(
                  (v) => v && typeof v.claimAtom === "string" && claimAtomKey(v.claimAtom) === atomKey
                );
                if (!verdict || verdict.sourcesRelatedOnly === true) return false;
                const added = new Set(addedUrlsByAtomKey[atomKey] ?? []);
                const bucketUrls = [
                  ...(Array.isArray(verdict.supportingSources) ? verdict.supportingSources : []),
                  ...(Array.isArray(verdict.contradictingSources) ? verdict.contradictingSources : []),
                ].map((s) =>
                  s && typeof s === "object" ? String((s as { url?: unknown }).url ?? "") : ""
                );
                const referenced = [...new Set(bucketUrls.filter((u) => u && added.has(u)))];
                boundByKey[atomKey] = referenced;
                return referenced.length > 0;
              });
              if (committed) {
                recheckCommitted = true;
                newlyBoundEvidenceUrlsByAtomKey = boundByKey;
                steps.push(rechecked);
                factStep = rechecked;
              }
              // 未提交：保留原 factStep（旧判词），补查证据仍在 bundle，报告 / 溯源可见。
            }
          } catch {
            // 补查证据已入 bundle，报告 / 溯源仍可见。
          }
        }
      }
      // 结算（Review 5127740625 Blocker 3 + 5128022550 Blocker 2）：只有重判真正
      // 提交（新 URL 进 bind 后的非 related-only relation）时，才跑 bounded
      // re-evaluation 并以第二次 Evaluation 为准关闭旧 gap；否则保守沿用第一次。
      let finalSupportedWhere = evaluation.evaluation.supportedWhere;
      let finalBiggestGap = evaluation.evaluation.biggestGap;
      let reevaluated = false;
      if (recheckCommitted && timeLeftMs() > COMPOSER_RESERVE_MS) {
        const reevaluation = await runWholeClaimEvaluation({
          claim,
          keptAtoms: keptAuditAtoms,
          claimAtomTypes: rumorStep.output.claimAtomTypes,
          subclaimVerdicts: factStep?.output?.subclaimVerdicts,
          missingJustificationsFromPlan: wholeClaimAudit.plan?.missingJustifications,
          callModel: auditCallModel,
        });
        if (reevaluation) {
          wholeClaimAudit.reevaluation = reevaluation.evaluation;
          finalSupportedWhere = reevaluation.evaluation.supportedWhere;
          finalBiggestGap = reevaluation.evaluation.biggestGap;
          reevaluated = true;
          const unresolvedAfterReeval = new Set<string>();
          for (const q of reevaluation.evaluation.nextQuestions) unresolvedAfterReeval.add(q.question);
          for (const gap of reevaluation.evaluation.missingJustifications) unresolvedAfterReeval.add(gap);
          auditUnresolvedGaps = [...unresolvedAfterReeval];
        }
      }
      if (!reevaluated) {
        // 无 target 的桥接问题 + 补查没取得新来源的问题 + eval 缺口 → 未解决，
        // 交给收权门限制整句结论强度（§11）。
        const resolvedKeys = new Set(Object.keys(newSourcesByAtomKey));
        const unresolved = new Set<string>();
        for (const q of evaluation.evaluation.nextQuestions) {
          const atomKey = resolveQuestionAtomKey(q, keptAuditAtoms);
          if (!atomKey || !keptKeys.has(atomKey) || !resolvedKeys.has(atomKey)) unresolved.add(q.question);
        }
        for (const gap of evaluation.evaluation.missingJustifications) unresolved.add(gap);
        auditUnresolvedGaps = [...unresolved];
      }
      wholeClaimAudit.extraPass = {
        ran: searchables.length > 0,
        questionsSearched: searchables.length,
        newSourcesByAtomKey,
        unresolvedQuestions: auditUnresolvedGaps,
        reevaluated,
        recheckCommitted,
        newlyBoundEvidenceUrlsByAtomKey,
      };
      wholeClaimAudit.evaluationStatus = "completed";
      rumorStep.output.wholeClaimAudit = {
        supportedWhere: finalSupportedWhere,
        biggestGap: finalBiggestGap,
        missingJustifications: auditUnresolvedGaps,
        model: evaluation.model,
        reevaluated,
        recheckCommitted,
        evaluationStatus: "completed",
      };
      // 里程碑：audit 补查可能新增来源 / 翻转判词，快照同步一次。
      emitInvestigation({
        phase: "judging",
        claimAtoms: rumorStep.output.claimAtoms,
        claimAtomTypes: rumorStep.output.claimAtomTypes,
        atomSearchBundle,
        subclaimVerdicts: factStep?.output?.subclaimVerdicts,
      });
    }
  } else if (auditCallModel) {
    // 预算不足未启动 Evaluation：保守沿用 Planning 缺口基线，不留静默空档。
    wholeClaimAudit.evaluationStatus = "skipped-budget";
    writeAuditConservativeArtifact("skipped-budget");
  }

  // Phase 3: ReportComposer (+ fallback owned by adapter)
  const reportStep = await runReport({
    claim,
    steps,
    search360Result,
    atomSearchBundle,
  });
  steps.push(reportStep);

  const finalReport =
    reportStep.output && typeof reportStep.output === "object"
      ? reportStep.output
      : ({} as Record<string, unknown>);

  const reportVerdicts = reportStep?.output?.subclaimVerdicts;
  const verdictSource =
    Array.isArray(reportVerdicts) && reportVerdicts.length > 0
      ? reportVerdicts
      : factStep?.output?.subclaimVerdicts;

  assembleFinalReport({
    finalReport,
    rumorStep,
    verdicts: verdictSource,
    searchSources: (search360Result as { sources?: Array<{ url?: unknown }> })?.sources,
    atomSearchBundle,
    imageOrigin,
  });

  // 原子级整句守门（确定性收束）——「分截判决」的收束端：
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

  // Whole-Claim 收权门（Issue #78 §11）：early + final 两次执行，同一 contract。
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

  // legacy 短谣通道：提成 false 之前先用同一 contract 做 probe，
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

  finalizeReport?.({
    finalReport,
    claim,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
  });

  // 保存实际质询记录；意见是否一致不改变报告分数。
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
  if (evidenceLoop?.pursuitHops && evidenceLoop.pursuitHops.length > 0) {
    finalReport.evidencePursuit = {
      hops: compactPursuitHops(evidenceLoop.pursuitHops),
    };
  }

  // Phase 3b: deterministic report reviewer (same as AgentRuntime; non-LLM)
  hooks?.onReportReviewStart?.({
    toolName: REPORT_REVIEWER_TOOL,
    query: claim,
  });
  const review = reviewAndRepairReport(finalReport, {
    claim,
    previousOutputs: steps.map((s) => s.output),
  });
  Object.assign(finalReport, review.repaired);
  // Reviewer may pad evidenceChain / rewrite conclusion — re-bind [n] to sources.
  normalizeReportCitations(finalReport);
  if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);
  // 「来源能点开」门：发布前对全局引用真实探活，死链剔除并重绑 [n] 标记。
  // 探活通道自身故障不阻断主流程——宁可用未剪枝的报告，也不丢结论。
  let deadCitationUrls: string[] = [];
  try {
    const pruneResult = await pruneDeadCitations(
      finalReport,
      input.citationLiveness === false ? { liveness: new Map() } : input.citationLiveness
    );
    deadCitationUrls = pruneResult.deadUrls;
  } catch (pruneError) {
    console.warn(`[casePipeline] 引用探活失败，跳过死链剔除: ${String(pruneError)}`);
  }
  // 最终 Whole-Claim consistency gate（Review 5128022550 Blocker 1）：
  // reviewer → normalize → prune → 权威 final gate → repair → normalize →
  // faceVerdict/checkedAt → Snapshot。final gate 基于 liveness 后的存活证据：
  // 死证已剔除仍无支撑的硬 true/false 直接收为 unverified；短谣存活辟谣通道
  // （聚合来源按 deadUrls 过滤后仍成立）是唯一的无绑定 false 豁免。
  // repair 触发（Review 5128022550 Blocker 3）由最终结构约束决定
  //（needsConstrainedConclusion），不看是谁降的级、不读结论文本。
  const deadUrlSet = new Set(deadCitationUrls);
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
  applyFollowUpAnswerLead(finalReport, claim);
  const keptAtomCount = Array.isArray(rumorStep.output.claimAtoms) ? rumorStep.output.claimAtoms.length : 0;
  applyUnopenedLinkConclusion(finalReport, claim, keptAtomCount);
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);
  // 结论文本会写「按当前信息」，这里打上实际核查时间；结论时效随来源窗口走。
  finalReport.checkedAt = new Date().toISOString();
  // 里程碑（完成）：finalReport.investigation = 稳定快照；报告 + 复核 + 探活后构建。
  const finalInvestigation = emitInvestigation({
    phase: "complete",
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
    subclaimVerdicts: finalReport.subclaimVerdicts,
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
    try {
      input.knowledgeBase.conclude(finalReport.subclaimVerdicts);
      input.knowledgeBase.settle({ claim, verdicts: finalReport.subclaimVerdicts });
    } catch (error) {
      console.error("[casePipeline] 知识库收尾失败", error);
    }
  }

  // Phase 3c: propose memory candidates (same as AgentRuntime memory write)
  const runId = input.runId ?? randomUUID();
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
    await input.memoryCandidateStore.propose(memoryCandidates);
  }
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
    wholeClaimAudit,
    runId,
    imageOrigin,
  };
}
