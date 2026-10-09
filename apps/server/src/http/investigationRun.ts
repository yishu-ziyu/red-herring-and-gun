/**
 * 一次调查的生命周期（POST /api/agent/orchestrate-stream 通过校验、建好 run 之后）：
 *
 *   开 SSE → 取消 / 断开两个中止源 → 图片解析 → 管线接线 → 两段时限（总时限 → 宽限）
 *   → 结局（runOutcome.ts）→ 按结局发终态帧、落 run 终态、结算额度。
 *
 * 断开连接不是取消：run 属于它的 runId，用户离开页面后照常跑完，结论经刷新接回取回。
 */
import { runCasePipeline, type PipelineStep } from "../lib/casePipeline/index.js";
import { commitFreeCheck, releaseFreeCheck, type CheckTicket } from "../lib/checkQuota.js";
import { applyContextCrossCheckToReport } from "../lib/contextCrossCheck.js";
import { makeRewriteQueryCall } from "../lib/evidenceLoop/index.js";
import { withExecutionBudget, type ExecutionBudget } from "../lib/executionBudget.js";
import { applyFactDeskPostProcessToReport } from "../lib/factDeskPostProcess.js";
import { followUpReuseFromClientBrief } from "../lib/followUpReuse.js";
import { withTimeout } from "../lib/httpUtils.js";
import { interruptedInvestigationSnapshot } from "../lib/interruptedSnapshot.js";
import type { InvestigationSnapshotV1 } from "../lib/investigation/index.js";
import { createInvestigationEmitter } from "../lib/investigationEmitter.js";
import { createOrchestrateAdapter } from "../lib/orchestrate.js";
import { buildDeterministicFinalReport } from "../lib/reportFallback.js";
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
  imageTextForDisplay,
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
  ticket: CheckTicket;
  intake: CaseIntakePayload | null;
  intakeMetadata: ReturnType<typeof buildCaseIntakeMetadata>;
  clientMemoryRecall: ReturnType<typeof normalizeClientMemoryRecall>;
  clientFollowUpReuse: ReturnType<typeof followUpReuseFromClientBrief>;
  run: { runId: string; caseId: string };
};

function makeSearchOneAtom(
  onSearchProgress: ((event: SearchProgressEvent) => void) | undefined,
  searchEnv: Record<string, string>,
  execution: ExecutionBudget = {},
) {
  return async (atom: string) => {
    execution.signal?.throwIfAborted();
    let result: Record<string, unknown>;
    try {
      result = await retrieveAtomSources(searchEnv, atom, onSearchProgress, execution);
    } catch (error) {
      execution.signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
      result = build360SearchFailure(atom, message);
    }
    return result;
  };
}

function pipelineFinalize(
  ctx: {
    finalReport: Record<string, unknown>;
    claim: string;
    rumorStep: PipelineStep;
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
  },
  visualExtraction?: Record<string, unknown>
) {
  applyFactDeskPostProcessToReport(ctx.finalReport, ctx.claim);
  applyContextCrossCheckToReport(ctx.finalReport, { claim: ctx.claim, visualExtraction });
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

const IMAGE_UNREADABLE_NOTICE = "图片没能读出来，已按你输入的文字继续";
const IMAGE_UNREADABLE_ONLY_MESSAGE = "图片没能读出来，这次没法核查。请换一张更清晰的图，或把图里的文字打出来再试。";

/** 只有图片、图片又没读出来：没有可核查的内容。 */
class ImageUnreadableError extends Error {
  constructor() {
    super("image-unreadable");
    this.name = "ImageUnreadableError";
  }
}

/** Node 22+: native composition keeps the first reason without accumulating listeners. */
function combineAbortSignals(...sources: AbortSignal[]): AbortSignal {
  return AbortSignal.any(sources);
}

export async function runInvestigation(deps: InvestigationRunDeps, request: InvestigationRequest, res: any): Promise<void> {
  try {
    await runInvestigationToEnd(deps, request, res);
  } finally {
    // 每条结局都已显式结算；走到这里还没结算，说明收尾途中出了没预料到的异常：按服务端失败退还。
    if (!request.ticket.settled) {
      console.error(`[quota] run 结束时名额未结算，按服务端失败退还 runId=${request.run.runId}`);
      releaseFreeCheck(request.ticket);
    }
  }
}

async function runInvestigationToEnd(deps: InvestigationRunDeps, request: InvestigationRequest, res: any): Promise<void> {
  const { env, runs, runStore } = deps;
  const PIPELINE_TOTAL_TIMEOUT_MS = deps.totalTimeoutMs;
  const PIPELINE_LATE_GRACE_MS = deps.lateGraceMs;
  const {
    ticket,
    intake,
    intakeMetadata,
    clientMemoryRecall,
    clientFollowUpReuse,
    run,
  } = request;
  let claim = request.claim;
  // 用户看到的「你调查的说法」。claim 读图之后会拼上给模型看的视觉提取，这部分不能出现在界面上。
  let displayClaim = request.claim;
  let visualExtraction: Record<string, unknown> | undefined;
  const settleQuota = (outcome: RunOutcome) => {
    if (QUOTA_SETTLEMENT[outcome] === "commit") commitFreeCheck(res, ticket);
    else releaseFreeCheck(ticket);
  };

  const runId = run.runId;
  const runSignal = runs.signalFor(runId);
  const workDeadlineMs = Date.now() + Math.max(1, PIPELINE_TOTAL_TIMEOUT_MS - 10_000);

  openSse(res);

  // A subscriber leaving is not a cancellation. The run belongs to its stored runId.
  // Explicit cancel/deadline remain the only ways to stop the work.
  let detachedFromClient = false;
  const disconnect = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) detachedFromClient = true;
  });

  const pipelineSignal = combineAbortSignals(
    disconnect.signal,
    ...(runSignal ? [runSignal] : [])
  );

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
        const readImage = () => withExecutionBudget(
          (signal) => callStepFunVisionForIntake({ env, claim, intake, signal }),
          { signal: pipelineSignal, deadlineMs: workDeadlineMs, timeoutMs: 60_000, label: "图片解析" },
        );
        // 视觉模型偶尔失败一次：重试一次再算读不出来。取消、断连、总时限到了不重试。
        const visionResult = await readImage().catch((error) => {
          pipelineSignal.throwIfAborted();
          if (Date.now() >= workDeadlineMs) throw error;
          console.warn(`[vision] 图片解析失败，重试一次 runId=${run.runId}: ${error instanceof Error ? error.message : String(error)}`);
          return readImage();
        });
        visualExtraction = asRecord(visionResult.output);
        claim = composeClaimWithVision(claim, intake, visualExtraction);
        if (!intake.text.trim()) displayClaim = imageTextForDisplay(visualExtraction);
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
        // 取消、断连仍走各自的结局，不当成「图片读不出来」。
        pipelineSignal.throwIfAborted();
        // R10：图片没读出来不拖垮整次调查。有文字就按文字继续并留常驻提示；没有文字就明说，不假装查过。
        const hasText = intake.text.trim().length > 0 || intake.links.some((link) => Boolean(link.scrapedContent?.trim()));
        if (!hasText) throw new ImageUnreadableError();
        sendEvent({
          type: "notice",
          code: "image_unreadable",
          message: IMAGE_UNREADABLE_NOTICE,
          timestamp: Date.now(),
        });
      }
    }

    const adapter = createOrchestrateAdapter({ env, signal: pipelineSignal, deadlineMs: workDeadlineMs });

    const runAgent = adapter.makeRunAgent({
      claim,
      intakeMetadata,
      visualExtraction,
      clientMemoryRecall,
      ...makeRunAgentCallbacks(sendEvent),
    });

    const pipelinePromise = withExecutionBudget((signal) => runCasePipeline({
      claim,
      displayClaim,
      // 断连与取消两个 abort 源合并：任一触发，管线阶段边界立即退出
      signal,
      // 截止 = 总超时 − 10s 收尾余量：补查/复核提前收敛，报告写作不再被总超时截断
      deadline: workDeadlineMs,
      intakeLinks: intake?.links,
      runAgent,
      searchOne: makeSearchOneAtom((event) => sendEvent(event), env, { signal, deadlineMs: workDeadlineMs }),
      callSelfProofModel: adapter.makeSelfProofCaller(),
      evidenceLoop: { callRewriteModel: makeRewriteQueryCall(adapter.makeRewriteCaller()) },
      crossExam: { callRaw: adapter.makeCrossExamCaller((data) => sendEvent(data)) },
      wholeClaimAudit: { callModel: adapter.makeWholeClaimAuditCaller() },
      followUpReuse: clientFollowUpReuse ?? undefined,
      runReport: makeRunReport(runAgent, sendEvent),
      hooks: makePipelineHooks({ claim, sendEvent, emitInvestigation, emitter, searchesCounter }),
      finalizeReport: (fctx: Parameters<typeof pipelineFinalize>[0]) =>
        pipelineFinalize(fctx, visualExtraction),
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
      `[atom_search] sources=${(result.atomSearchBundle.aggregate.sources || []).length}`
    );

    sendEvent({
      type: "complete",
      claim: displayClaim,
      steps: result.steps,
      finalReport: result.finalReport,
      timestamp: Date.now(),
    });
    // run 终态与快照终态一致：核查步骤内部失败（error-boundary）的 run 是
    // interrupted，不是 completed——pipeline 已在快照 emit 前定了中断帧。
    finishRun(
      result.finalReport._source === "error-boundary"
        ? RUN_FINAL_STATUS["server-error"]
        : RUN_FINAL_STATUS.completed
    );
    settleQuota("completed");
    endResponse();
  } catch (error) {
    const outcome = classifyFailure(error, {
      cancelled: Boolean(runSignal?.aborted),
    });
    if (outcome === "cancelled") {
      settleQuota(outcome);
      emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, displayClaim));
      finishRun(RUN_FINAL_STATUS[outcome]);
      endResponse();
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
      const interrupted = interruptedInvestigationSnapshot(lastInvestigation, displayClaim);
      emitInvestigation(interrupted);
      const timedOut = buildTimedOutReport(displayClaim);
      timedOut.investigation = interrupted;
      applyContextCrossCheckToReport(timedOut, { claim, visualExtraction });
      // B2：先计费再收尾（原先 release 在前把 settled 置真，这里的 commit 变空操作 → 超时=白嫖）
      settleQuota(outcome);
      sendEvent({
        type: "complete",
        claim: displayClaim,
        steps: [],
        finalReport: timedOut,
        timestamp: Date.now(),
      });
      finishRun(RUN_FINAL_STATUS[outcome]);
      endResponse();
      return;
    }
    // 客户端主动断开（刷新/关页/写失败）→ 照常计费，放弃不能变成免费重试入口；
    // 服务端真失败 → 退还这次核查
    settleQuota(outcome);
    if (error instanceof ImageUnreadableError) {
      // 只有图片且没读出来：没有任何东西可核查，不发中断快照，直接说明原因（额度已按 server-error 退还）。
      sendEvent({ type: "error", code: "image_unreadable", message: IMAGE_UNREADABLE_ONLY_MESSAGE, timestamp: Date.now() });
      finishRun(RUN_FINAL_STATUS[outcome]);
      res.end();
      return;
    }
    const { message } = toFriendlyError(error, "这次核查没能完成，请稍后重试");
    // 中断帧先行：前端拿到 phase=interrupted 的真实部分数据，再收 error 提示。
    emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, displayClaim));
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
