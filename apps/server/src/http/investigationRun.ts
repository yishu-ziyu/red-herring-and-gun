/**
 * 一次调查的生命周期（POST /api/agent/orchestrate-stream 通过校验、建好 run 之后）：
 *
 *   开 SSE → 取消 / BYO 失败 / 断开三个中止源 → 图片解析 → 管线接线 → 两段时限（总时限 → 宽限）
 *   → 结局（runOutcome.ts）→ 按结局发终态帧、落 run 终态、结算额度。
 *
 * 断开连接不是取消：run 属于它的 runId，用户离开页面后照常跑完，结论经刷新接回取回。
 */
import { runCasePipeline } from "../lib/casePipeline/index.js";
import { commitFreeCheck, releaseFreeCheck, type CheckTicket } from "../lib/checkQuota.js";
import { applyContextCrossCheckToReport } from "../lib/contextCrossCheck.js";
import { getCase, type CaseEntry } from "../lib/caseStore.js";
import { makeRewriteQueryCall } from "../lib/evidenceLoop/index.js";
import { withExecutionBudget, type ExecutionBudget } from "../lib/executionBudget.js";
import { followUpReuseFromClientBrief } from "../lib/followUpReuse.js";
import {
  appendFollowUpObservation,
  buildFollowUpObservation,
  type FollowUpObservationStats,
} from "../lib/followupObservation.js";
import { scoreReport } from "../lib/casePipeline/scoreReport.js";
import { withTimeout } from "../lib/httpUtils.js";
import { lookupImageOrigin, visionHintsFromExtraction } from "../lib/imageOrigin/index.js";
import { interruptedInvestigationSnapshot } from "../lib/interruptedSnapshot.js";
import type { InvestigationSnapshotV1 } from "../lib/investigation/index.js";
import { createInvestigationEmitter } from "../lib/investigationEmitter.js";
import { createKnowledgeMemory } from "../lib/knowledgeStore.js";
import { getMemoryCandidateStore } from "../lib/memoryCandidateHandlers.js";
import type { MemoryCandidateHit } from "../lib/memoryCandidateTypes.js";
import { createOrchestrateAdapter } from "../lib/orchestrate.js";
import { ByoKeyError, searchEnvWithByoCredentials, type ByoConfig } from "../lib/orchestrateByo.js";
import { buildDeterministicFinalReport } from "../lib/reportFallback.js";
import { makeSearch360ReverseImage } from "../lib/reverseImage/search360ReverseImage.js";
import type { RunService } from "../lib/runService.js";
import type { RunStore } from "../lib/runStore.js";
import {
  build360SearchFailure,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "../lib/searchProviders.js";
import { asRecord } from "../lib/valueCoerce.js";
import {
  callStepFunVisionForIntake,
  composeClaimWithVision,
  type buildCaseIntakeMetadata,
  type CaseIntakeImagePayload,
  type CaseIntakePayload,
  type normalizeClientMemoryRecall,
} from "../lib/visionIntake.js";
import { makePipelineHooks, makeRunAgentCallbacks, makeRunReport } from "./pipelineEvents.js";
import { toFriendlyError, toPublicStreamEvent } from "./publicStream.js";
import { classifyFailure, QUOTA_SETTLEMENT, RUN_FINAL_STATUS, TIMEOUT_LABEL, type RunOutcome } from "./runOutcome.js";
import { openSse, sseFrame, SSE_KEEPALIVE_FRAME, SSE_KEEPALIVE_MS } from "./sseChannel.js";

export type InvestigationRunDeps = {
  env: Record<string, string>;
  codexBin: string;
  runs: RunService;
  runStore: RunStore | null;
  /** 总时限（ORCHESTRATE_TOTAL_TIMEOUT_MS）。 */
  totalTimeoutMs: number;
  /** 总时限到了之后给管线自己收尾的宽限（ORCHESTRATE_LATE_GRACE_MS）。 */
  lateGraceMs: number;
};

/** 已通过校验、已建好 run 的一次调查请求。 */
export type InvestigationRequest = {
  claim: string;
  byo: ByoConfig | undefined;
  modelChoice: unknown;
  ticket: CheckTicket;
  intake: CaseIntakePayload | null;
  intakeMetadata: ReturnType<typeof buildCaseIntakeMetadata>;
  clientMemoryRecall: ReturnType<typeof normalizeClientMemoryRecall>;
  isFollowUp: boolean;
  priorCaseId: string;
  priorCase: CaseEntry | null;
  clientFollowUpReuse: ReturnType<typeof followUpReuseFromClientBrief>;
  run: { runId: string; caseId: string };
};

/**
 * 追问观测记录（阶段 3）：报告 finalize 后写一行计数与判词标签到 JSONL。
 * 三件事都不许发生：阻断 run、把失败透给用户、把 claim 文本或 URL 写进文件。
 * 上一轮案件读不到（被删 / 报告缺失）→ 静默跳过；写文件真出异常 → 记一笔日志后跳过。
 */
function recordFollowUpObservation(input: {
  runId: string;
  caseId: string;
  priorCaseId: string;
  report: Record<string, unknown>;
  snapshot: InvestigationSnapshotV1 | undefined;
  atomsSearched: number;
  searchesTotal: number;
}): void {
  try {
    const priorCase = getCase(input.priorCaseId);
    if (!priorCase) return;
    const claims = input.snapshot?.claims ?? [];
    const stats: FollowUpObservationStats = {
      atomsTotal: claims.length || input.atomsSearched,
      atomsSearched: input.atomsSearched,
      // 完成态里判词 unresolved / 尚未给判词的命题，都是这轮没查出定论的命题。
      atomsUnverified: claims.filter((claim) => claim.judgment === "unresolved" || claim.judgment === null).length,
      searchesTotal: input.searchesTotal,
    };
    const record = buildFollowUpObservation({
      priorReport: priorCase.report,
      report: input.report,
      stats,
      runId: input.runId,
      caseId: input.caseId,
      priorCaseId: input.priorCaseId,
    });
    if (record) appendFollowUpObservation(record);
  } catch (error) {
    console.error(`[followup-observation] 观测记录未写入 runId=${input.runId}`, error);
  }
}

function makeImageOriginLookup(
  env: Record<string, string>,
  intake: CaseIntakePayload | null,
  visualExtraction: Record<string, unknown> | undefined,
  execution: ExecutionBudget = {},
) {
  if (!intake?.images.length) return undefined;
  const hints = visionHintsFromExtraction(visualExtraction);
  const images = intake.images
    .filter((image): image is CaseIntakeImagePayload & { dataUrl: string } => typeof image.dataUrl === "string")
    .map((image) => ({ mimeType: image.type, dataUrl: image.dataUrl }));
  // Reverse-image 适配器（360 图搜）：配置了 KEY + PUBLIC_BASE_URL 才启用，
  // 否则 undefined → lookupImageOrigin 自动降级为「原图没查到」，绝不发明图源。
  const reverseImageSearch = makeSearch360ReverseImage(env, execution);
  return () =>
    lookupImageOrigin({
      images,
      ocrTexts: hints.ocrTexts,
      sourceHints: hints.sourceHints,
      reverseImageSearch,
    });
}

function makeSearchOneAtom(
  onSearchProgress: ((event: SearchProgressEvent) => void) | undefined,
  searchEnvOverride: Record<string, string>,
  execution: ExecutionBudget = {},
) {
  let reuseHitsPromise: Promise<MemoryCandidateHit[]> | undefined;
  return async (atom: string) => {
    execution.signal?.throwIfAborted();
    if (!reuseHitsPromise) {
      reuseHitsPromise = getMemoryCandidateStore()
        .searchAccepted(atom)
        .catch(() => []);
    }
    const reuseHits = await reuseHitsPromise;
    let result: Record<string, unknown>;
    try {
      result = await retrieveAtomSources(searchEnvOverride, atom, reuseHits, onSearchProgress, execution);
    } catch (error) {
      execution.signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
      result = build360SearchFailure(atom, message);
    }
    return result;
  };
}

/**
 * 整体核查超时兜底：不憋用户，先给「还没查完」的中间结论（unverified + error-boundary）。
 * 只在宽限期也过了、管线确定回不来时用（Change C 之后超时本身不再走这条路）。
 */
function buildTimedOutReport(c: string): Record<string, unknown> {
  const report = buildDeterministicFinalReport(c, [], undefined, "核查超过时限，先给中间结论。");
  report._source = "error-boundary";
  return report;
}

/** Node 22+: native composition keeps the first reason without accumulating listeners. */
function combineAbortSignals(...sources: AbortSignal[]): AbortSignal {
  return AbortSignal.any(sources);
}

export async function runInvestigation(deps: InvestigationRunDeps, request: InvestigationRequest, res: any): Promise<void> {
  const { env, codexBin, runs, runStore } = deps;
  const PIPELINE_TOTAL_TIMEOUT_MS = deps.totalTimeoutMs;
  const PIPELINE_LATE_GRACE_MS = deps.lateGraceMs;
  const {
    byo,
    modelChoice,
    ticket,
    intake,
    intakeMetadata,
    clientMemoryRecall,
    isFollowUp,
    priorCaseId,
    priorCase,
    clientFollowUpReuse,
    run,
  } = request;
  let claim = request.claim;
  let visualExtraction: Record<string, unknown> | undefined;
  const settleQuota = (outcome: RunOutcome) => {
    if (QUOTA_SETTLEMENT[outcome] === "commit") commitFreeCheck(res, ticket);
    else releaseFreeCheck(ticket);
  };

  const runId = run.runId;
  if (isFollowUp && priorCaseId) runStore?.markFollowUp(runId, priorCaseId);
  const runSignal = runs.signalFor(runId);
  const workDeadlineMs = Date.now() + Math.max(1, PIPELINE_TOTAL_TIMEOUT_MS - 10_000);

  openSse(res);

  // A subscriber leaving is not a cancellation. The run belongs to its stored runId.
  // Explicit cancel/BYO failure/deadline remain the only ways to stop the work.
  let detachedFromClient = false;
  const disconnect = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) detachedFromClient = true;
  });

  // BYO fail-closed：请求内密钥失败（鉴权/网络）→ 独立 abort 源中止管线，
  // 与客户端断开分开计数——密钥失败要退还名额并给出密钥相关的用户可读错误，不与断连混淆。
  const byoFail = new AbortController();
  const onByoFailure = (error: unknown) => {
    if (!byoFail.signal.aborted) {
      byoFail.abort(error instanceof Error ? error : new Error("byo-key-failed"));
    }
  };
  const pipelineSignal = combineAbortSignals(
    disconnect.signal,
    byoFail.signal,
    ...(runSignal ? [runSignal] : [])
  );

  // 检索凭证绑定：BYO 端点命中 MiniMax / 阶跃 → 对应检索路径换用户密钥；其余端点检索仍全走 env。
  const searchEnv = searchEnvWithByoCredentials(env, byo);

  const writeFrame = (data: object) => {
    // 只看 res 自己有没有结束：`disconnect.abort()` 是「停管线」的信号，
    // 不是「别写了」的信号。之前两者混用，导致 catch 里 abort 之后的所有帧
    // （超时的中断帧、取消的终态帧）全部被丢掉。
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(sseFrame(toPublicStreamEvent(data)));
    } catch {
      detachedFromClient = true;
    }
  };
  // 总线是唯一出口：本流、重连的订阅者、取消时补发的状态帧走同一条路，
  // 不会出现「POST 说在停、流上什么都没有」。
  const sendEvent = (data: object) => {
    runs.publish(runId, data as Record<string, unknown>);
  };
  /**
   * 收尾响应：Change C 之后管线可能已经与这条连接解耦（用户按提示离开了页面），
   * res 已关不算错——结论已经落 run 库，经刷新恢复通道可取回。
   */
  const endResponse = () => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.end();
    } catch {
      /* 连接已关：不影响已落库的结果 */
    }
  };
  const unsubscribeRun = runs.subscribe(runId, (event) => writeFrame(event));

  // 先告诉客户端这次调查的 runId：取消与刷新恢复都要它。
  sendEvent({ type: "run_started", runId, caseId: run.caseId, timestamp: Date.now() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(SSE_KEEPALIVE_FRAME);
    } catch {
      // 响应已断开：由主流程的 EPIPE/写失败路径统一收尾
    }
  }, SSE_KEEPALIVE_MS);

  // Investigation Snapshot 最新帧：中断/超时时补发 interrupted 帧（保留已真实获得的数据）。
  let lastInvestigation: InvestigationSnapshotV1 | undefined;
  // 追问观测用：本轮实际发起的检索次数 = 命题检索 + 证据追索补查轮次。
  // 数值来自钩子（真发生过的动作），不来自报告文本。
  const searchesCounter = { current: 0 };
  // 公共活动账本（IMPLEMENTATION_PLAN §5.1）：只由已校验快照差分与结构化 hook 生成。
  // runId 目前只覆盖这一条流；跨刷新的重放要等 RunService（PR-D）。
  // 公共活动（IMPLEMENTATION_PLAN §5.1）：只由已校验快照差分与结构化 hook 生成。
  /**
   * 收尾：落终态并把结果广播出去。客户端就靠这帧把「正在停止」翻成「已停止」，
   * 不能让它自己猜——猜出来的状态等于假状态。
   */
  const finishRun = (status: "completed" | "interrupted" | "cancelled") => {
    runs.finish(runId, status);
    sendEvent({
      type: "run_state",
      status: runs.get(runId)?.status ?? status,
      terminal: true,
      timestamp: Date.now(),
    });
  };

  const emitter = createInvestigationEmitter({
    runId,
    send: sendEvent,
    onActivities: (activities) => runStore?.appendActivities(runId, activities),
  });
  const emitInvestigation = (snapshot: InvestigationSnapshotV1) => {
    if (pipelineSignal.aborted && snapshot.phase !== "interrupted") return;
    lastInvestigation = snapshot;
    // 运行状态跟着快照阶段走（§5.2：run 状态与快照 phase 有确定映射）。
    if (snapshot.phase === "investigating") runs.advance(runId, "investigating");
    else if (snapshot.phase === "judging") runs.advance(runId, "judging");
    emitter.emitSnapshot(snapshot);
    if (runStore) {
      try {
        runStore.saveSnapshot(runId, snapshot);
      } catch (error) {
        // 保存失败不挡结果：前端照拿快照，服务端记一笔。
        console.error(`[run] 快照落库失败 runId=${runId}`, error);
      }
    }
  };

  try {
    if (intake?.images.length) {
      sendEvent({
        type: "tool_start",
        toolName: "StepFun Vision",
        query: "图片材料解析",
        timestamp: Date.now(),
      });
      try {
        const visionResult = await withExecutionBudget(
          (signal) => callStepFunVisionForIntake({ env, claim, intake, signal }),
          { signal: pipelineSignal, deadlineMs: workDeadlineMs, timeoutMs: 60_000, label: "图片解析" },
        );
        visualExtraction = asRecord(visionResult.output);
        claim = composeClaimWithVision(claim, intake, visualExtraction);
        sendEvent({
          type: "tool_result",
          toolName: "StepFun Vision",
          query: "图片材料解析",
          model: visionResult.model,
          result: {
            _source: "stepfun-vision",
            ...visualExtraction,
          },
          timestamp: Date.now(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片材料解析失败";
        sendEvent({
          type: "tool_error",
          toolName: "StepFun Vision",
          query: "图片材料解析",
          error: message,
          timestamp: Date.now(),
        });
        throw error;
      }
    }

    // BYO 接管的请求内适配器：byo 存在时全部主力调用直调用户端点；不存在时与现状零差异。
    const byoAdapter = createOrchestrateAdapter({ env, codexBin, byo, onByoFailure, signal: pipelineSignal, deadlineMs: workDeadlineMs });

    const runAgent = byoAdapter.makeRunAgent({
      claim,
      modelChoice,
      intakeMetadata,
      visualExtraction,
      clientMemoryRecall,
      ...makeRunAgentCallbacks(sendEvent),
    });

    // 证据库（Part 1 · 记忆复用）：每次调查一份端口。claim 传进去是为了隐私闸门——
    // 整句等于原句的 atom 一律不进知识库、不落观测（原句全文不写盘）。
    const knowledgeBase = createKnowledgeMemory({ runId, claim });

    const pipelinePromise = withExecutionBudget((signal) => runCasePipeline({
      claim,
      // 断连与 BYO 密钥失败两个 abort 源合并：任一触发，管线阶段边界立即退出
      signal,
      // 截止 = 总超时 − 10s 收尾余量：补查/复核提前收敛，报告写作不再被总超时截断
      deadline: workDeadlineMs,
      runAgent,
      searchOne: makeSearchOneAtom((event) => sendEvent(event), searchEnv, { signal, deadlineMs: workDeadlineMs }),
      lookupImageOrigin: makeImageOriginLookup(env, intake, visualExtraction, { signal, deadlineMs: workDeadlineMs }),
      callSelfProofModel: byoAdapter.makeSelfProofCaller(claim, modelChoice),
      evidenceLoop: { callRewriteModel: makeRewriteQueryCall(byoAdapter.makeRewriteCaller(modelChoice)) },
      crossExam: { callRaw: byoAdapter.makeCrossExamCaller(modelChoice, (data) => sendEvent(data)) },
      knowledgeBase,
      archiveEvidence: true,
      followUpReuse: priorCase
        ? {
            priorReport: priorCase.report,
            priorClaim: priorCase.claim,
            priorCreatedAt: priorCase.createdAt,
          }
        : clientFollowUpReuse ?? undefined,
      runReport: makeRunReport(runAgent, byo, byoFail, sendEvent),
      hooks: makePipelineHooks({ claim, sendEvent, emitInvestigation, emitter, searchesCounter }),
      finalizeReport: scoreReport,
      memoryCandidateStore: getMemoryCandidateStore(),
    }), { signal: pipelineSignal, timeoutMs: PIPELINE_TOTAL_TIMEOUT_MS + PIPELINE_LATE_GRACE_MS, label: TIMEOUT_LABEL });
    // withTimeout 是 race：落败方的 rejection 必须被吸收，
    // 否则断连/超时触发的 abort 会变成 unhandledRejection 直接崩进程
    pipelinePromise.catch(() => {});
    const result = await (async () => {
      try {
        return await withTimeout(pipelinePromise, PIPELINE_TOTAL_TIMEOUT_MS, TIMEOUT_LABEL);
      } catch (error) {
        // 契约 Change C：超时不再一锤定音。超时只说明「这条连接的等待到头了」，不是管线失败：
        //  1) 先告诉客户端「还在查」，用户留在页面上就继续跟着看；
        //  2) 从此这条连接不再是管线的生命线（detachedFromClient），用户离开页面也不再 abort 它；
        //  3) 再等管线自己收尾：晚完成 → 落 complete，快照与结论经刷新恢复通道取回；
        //  4) 宽限期到还没回来 → 抛出，走下面既有的「超时中断」收尾（现有文案与重查入口）。
        if (!(error instanceof Error && error.message.includes(TIMEOUT_LABEL))) throw error;
        detachedFromClient = true;
        sendEvent({ type: "timeout_pending", timestamp: Date.now() });
        console.log(
          `[orchestrate] 总时限 ${PIPELINE_TOTAL_TIMEOUT_MS}ms 到，管线继续收尾（宽限 ${PIPELINE_LATE_GRACE_MS}ms）runId=${runId}`
        );
        return await withTimeout(pipelinePromise, PIPELINE_LATE_GRACE_MS, TIMEOUT_LABEL);
      }
    })();
    pipelineSignal.throwIfAborted();

    if (detachedFromClient) {
      console.log(`[orchestrate] 调查在连接等待结束后完成，结果可恢复 runId=${runId}`);
    }
    console.log(
      `[atom_search] sources=${(result.atomSearchBundle.aggregate.sources || []).length} memoryCandidates=${result.memoryCandidates.length}`
    );

    sendEvent({
      type: "complete",
      claim,
      steps: result.steps,
      finalReport: result.finalReport,
      memoryCandidates: result.memoryCandidates,
      timestamp: Date.now(),
    });
    finishRun(RUN_FINAL_STATUS.completed);
    // 追问观测：报告已 finalize、响应还没结束——写一行计数与判词标签就完事。
    // 只在追问轮写；写不进去也不改这次 run 的结局（recordFollowUpObservation 内部兜住）。
    if (isFollowUp && priorCaseId) {
      recordFollowUpObservation({
        runId,
        caseId: run.caseId,
        priorCaseId,
        report: result.finalReport,
        snapshot: lastInvestigation,
        atomsSearched: result.atomSearchBundle.atomsSearched.length,
        searchesTotal: searchesCounter.current,
      });
    }
    settleQuota("completed");
    endResponse();
  } catch (error) {
    const outcome = classifyFailure(error, {
      cancelled: Boolean(runSignal?.aborted),
      byoFailed: Boolean(byo && byoFail.signal.aborted),
    });
    if (outcome === "cancelled") {
      settleQuota(outcome);
      emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, claim));
      finishRun(RUN_FINAL_STATUS[outcome]);
      endResponse();
      return;
    }
    // BYO key fail-closed（Evaluator 3）：密钥失败时管线已被 byoFail 中止，
    // 不需要再走断连 abort；先发中断帧与密钥错误帧，再收尾，绝不静默回退 env 密钥重烧。
    if (outcome === "byo-failed") {
      settleQuota(outcome);
      console.error(
        `[byo-key] investigation ended fail-closed label=${byo?.modelName} detail=${
          error instanceof Error ? error.name : "unknown"
        }`
      );
      const byoMessage =
        error instanceof ByoKeyError && error.userMessage
          ? error.userMessage
          : "你保存的模型密钥调用失败，这次核查没能完成。请检查模型设置后重试。";
      sendEvent({
        type: "investigation_snapshot",
        investigation: interruptedInvestigationSnapshot(lastInvestigation, claim),
        timestamp: Date.now(),
      });
      sendEvent({
        type: "error",
        code: "byo_key_failed",
        message: byoMessage,
        timestamp: Date.now(),
      });
      finishRun(RUN_FINAL_STATUS[outcome]);
      res.end();
      return;
    }
    // B1：走到这里说明这次管线已经是 race 的落败方——abort 它，
    // 各阶段边界会立即退出，不再僵尸烧 token。
    // （Change C：第一次总超时不再走这条——那条路上管线被故意留着继续收尾。）
    if (!disconnect.signal.aborted) {
      disconnect.abort(error instanceof Error ? error : new Error("aborted"));
    }
    // 宽限期也过了、管线仍不回来 → 才按超时中断收尾：给「还没查完」的中间结论，不发 error。
    if (outcome === "timed-out") {
      const interrupted = interruptedInvestigationSnapshot(lastInvestigation, claim);
      emitInvestigation(interrupted);
      const timedOut = buildTimedOutReport(claim);
      timedOut.investigation = interrupted;
      applyContextCrossCheckToReport(timedOut, { claim, visualExtraction });
      // B2：先计费再收尾（原先 release 在前把 settled 置真，这里的 commit 变空操作 → 超时=白嫖）
      settleQuota(outcome);
      sendEvent({
        type: "complete",
        claim,
        steps: [],
        finalReport: timedOut,
        memoryCandidates: [],
        timestamp: Date.now(),
      });
      finishRun(RUN_FINAL_STATUS[outcome]);
      endResponse();
      return;
    }
    // 客户端主动断开（刷新/关页/写失败）→ 照常计费，放弃不能变成免费重试入口；
    // 服务端真失败 → 退还这次核查
    settleQuota(outcome);
    const { message } = toFriendlyError(error, "这次核查没能完成，请稍后重试");
    // 中断帧先行：前端拿到 phase=interrupted 的真实部分数据，再收 error 提示。
    emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, claim));
    sendEvent({
      type: "error",
      message,
      timestamp: Date.now(),
    });
    finishRun(RUN_FINAL_STATUS[outcome]);
    res.end();
  } finally {
    clearInterval(heartbeat);
    unsubscribeRun();
  }
}
