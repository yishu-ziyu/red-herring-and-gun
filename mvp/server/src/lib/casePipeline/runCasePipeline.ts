/**
 * Case Pipeline — production orchestration for one claim case.
 * Depth: rumor → self-proof → per-atom search → fact//source → report → assemble → review.
 * HTTP / SSE are thin adapters; inject runAgent + searchOne + selfProof model.
 */

import { randomUUID } from "node:crypto";
import {
  claimAtomKey,
  forceCheckableAtomTypes,
  prefilterClaimAtoms,
  runClaimAtomSelfProof,
  type SelfProofModelCall,
} from "../claimAtom/index.js";
import {
  retrieveForAtoms,
  type AtomSearchBundle,
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

export type CasePipelineHooks = {
  /** after self-proof written on rumor step */
  onSelfProof?: (info: { kept: string[]; dropped: unknown[]; model: string }) => void;
  /** atom search lifecycle (SSE) */
  onAtomSearchStart?: (atom: string) => void;
  onAtomSearchResult?: (atom: string, result: unknown) => void;
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
   * Screenshot reverse-image lookup (P2 origin gate). Beside searchOne.
   * OCR/text hits must not become image origin.
   */
  lookupImageOrigin?: () => Promise<ImageOriginResult>;
  /**
   * 引用探活依赖（「来源能点开」门）。默认真实网络探活；
   * `false` 关闭；测试传 { liveness: Map } 注入结果避免触网。
   */
  citationLiveness?: LivenessDeps | false;
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

export async function runCasePipeline(input: CasePipelineInput): Promise<CasePipelineResult> {
  const { claim, runAgent, searchOne, callSelfProofModel, runReport, hooks, finalizeReport } = input;
  const steps: PipelineStep[] = [];

  // 协作式取消：各阶段边界检查一次。fail-open 的 catch 会吞掉 AbortError，
  // 所以下一个边界必须再查，断连后最多再浪费一个阶段调用就会整体退出。
  const throwIfAborted = () => input.signal?.throwIfAborted();
  throwIfAborted();

  // 时间预算：证据补查/交叉复核/因果增强是「锦上添花」，报告写作是「必须发生」。
  // 剩余时间不足时提前收敛补查类阶段，把时间让给 ReportComposer。
  const COMPOSER_RESERVE_MS = 90_000;
  const CROSS_EXAM_MIN_MS = 45_000;
  const EVIDENCE_PASS_MIN_MS = 100_000;
  const timeLeftMs = () =>
    input.deadline == null ? Number.POSITIVE_INFINITY : input.deadline - Date.now();

  // Phase 1: RumorDetector — fail-open to the original sentence so search still runs.
  let rumorStep: PipelineStep;
  try {
    rumorStep = await runAgent("rumor_detector", steps);
  } catch (error) {
    rumorStep = fallbackRumorStep(claim, error);
  }
  steps.push(rumorStep);

  throwIfAborted();
  // Phase 1a: self-proof (must precede per-atom search).
  // If rumor_detector already exhausted providers, don't spend another full fallback chain.
  const selfProof = rumorStep.error
    ? (() => {
        const pre = prefilterClaimAtoms(claim, rumorStep?.output?.claimAtoms ?? []);
        return { kept: pre.atoms, dropped: pre.dropped, model: "fallback:skip-after-rumor-error" };
      })()
    : await runClaimAtomSelfProof(claim, rumorStep?.output?.claimAtoms ?? [], callSelfProofModel);
  if (!rumorStep.output || typeof rumorStep.output !== "object") {
    rumorStep.output = {};
  }
  rumorStep.output.claimAtoms = selfProof.kept;
  rumorStep.output.claimAtomSelfProof = {
    kept: selfProof.kept,
    dropped: selfProof.dropped,
    model: selfProof.model,
  };
  rumorStep.output.claimAtomTypes = forceCheckableAtomTypes(rumorStep.output.claimAtomTypes);
  hooks?.onSelfProof?.(selfProof);

  throwIfAborted();
  // Phase 1b: per-atom retrieval (+ screenshot reverse-image beside searchOne)
  const { atomSearchBundle, search360Result } = await retrieveForAtoms({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    searchOne,
    claimAtomKeyFn: claimAtomKey,
    lookupImageOrigin: input.lookupImageOrigin,
    hooks: {
      mode: hooks?.searchMode ?? "parallel",
      onAtomStart: hooks?.onAtomSearchStart,
      onAtomResult: hooks?.onAtomSearchResult,
    },
  });
  const imageOrigin = atomSearchBundle.imageOrigin;

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
  // Phase 2a: Evidence sufficiency loop — ADR-004 + 翻案续期
  // 提问 → 重判 → 判词仍翻转中且问题仍产证据 → 换策略再问（pass 2+）→ 再重判。
  // 好问题续命（翻转判词的提问 earns another pass），坏问题判停（整 pass 零新增）。
  let evidenceLoop: EvidenceLoopOutcome | undefined;
  if (input.evidenceLoop?.enabled !== false && atomSearchBundle.atomsSearched.length > 0) {
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
        bundle: atomSearchBundle,
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
        atomsSearched: atomSearchBundle.atomsSearched,
        verdicts: currentVerdicts(),
        claimAtomKeyFn: claimAtomKey,
      });
      if (remaining.length === 0) break;
      // 仍有未解决原子且上一 pass 问题还在产证据 → 翻案续期（下一 pass 换策略）
    }

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

  // Phase 2b: Cross exam — G3/P1（证据冲突 → 第二模型独立复核，分歧降分不重写判词）
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
    if (crossTargets.length > 0) {
      throwIfAborted();
      crossExam = await runCrossExam({
        claim,
        targets: crossTargets,
        callSecondOpinion: makeSecondOpinionCall(input.crossExam.callRaw),
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
  }

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
  if (deriveOverallVerdict(atomVerdicts) === "partial") {
    const originalOverall = String(factStep?.output?.factCheckResult ?? "").trim();
    if (originalOverall === "false" && factStep?.output) {
      factStep.output._factCheckResultDerived = { from: "false", to: "partial", rule: "有据之真 + 假原子" };
      factStep.output.factCheckResult = "partial";
    }
    if (finalReport.verdictType === "false") {
      finalReport.verdictType = "mixed_misleading";
      finalReport._mixedGuard = "有据之真 + 假原子 → mixed（原子级守门）";
    }
  }

  const searchSources = Array.isArray((search360Result as { sources?: unknown[] } | undefined)?.sources)
    ? ((search360Result as { sources: Array<Record<string, unknown>> }).sources)
    : [];
  const bound = boundTinyRumorVerdict(claim, searchSources);
  if (
    bound === "false" &&
    (finalReport.verdictType === "mixed_misleading" || finalReport.verdictType === "unverified")
  ) {
    finalReport.verdictType = "false";
  }

  finalizeReport?.({
    finalReport,
    claim,
    rumorStep,
    factStep,
    sourceStep,
    search360Result,
  });

  // Cross exam 分歧处置（在 finalizeReport 之后，公式分不被覆盖；确定性代码）：
  // 不重写判词，降可信度并标注 contested，报告可审计。
  if (crossExam && crossExam.confidenceAdjustment !== 0) {
    const base =
      typeof finalReport.credibilityScore === "number" ? finalReport.credibilityScore : 50;
    finalReport.credibilityScore = Math.max(
      0,
      Math.min(100, Math.round(base + crossExam.confidenceAdjustment))
    );
  }
  if (crossExam?.ran) {
    finalReport.crossExam = {
      model: crossExam.model,
      adjustment: crossExam.confidenceAdjustment,
      atoms: crossExam.atoms.map((a) => ({
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
  try {
    await pruneDeadCitations(
      finalReport,
      input.citationLiveness === false ? { liveness: new Map() } : input.citationLiveness
    );
  } catch (pruneError) {
    console.warn(`[casePipeline] 引用探活失败，跳过死链剔除: ${String(pruneError)}`);
  }
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);
  // 结论文本会写「按当前信息」，这里打上实际核查时间；结论时效随来源窗口走。
  finalReport.checkedAt = new Date().toISOString();
  reportStep.output = finalReport;
  hooks?.onReportReviewResult?.({
    toolName: REPORT_REVIEWER_TOOL,
    query: claim,
    passed: review.passed,
    score: review.score,
    issues: review.issues,
    checks: review.checks,
  });

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
    runId,
    imageOrigin,
  };
}
