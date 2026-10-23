/**
 * 一次调查的生命周期（POST /api/agent/orchestrate-stream 通过校验、建好 run 之后）：
 *
 *   开 SSE → 订阅运行事件 → 图片解析 → 管线接线 → 两段时限（总时限 → 宽限）
 *   → 结局（runOutcome.ts）→ 按结局发终态帧、落 run 终态、结算额度。
 *
 * 断开连接不是取消：run 属于它的 runId，用户离开页面后照常跑完，结论经刷新接回取回。
 */
import { createRunRecorder, type RunRecorder } from "../lib/runRecorder.js";
import { runCasePipeline } from "../lib/casePipeline/runCasePipeline.js";
import { commitFreeCheck, releaseFreeCheck, type CheckTicket } from "../lib/checkQuota.js";
import { applyContextCrossCheckToReport } from "../lib/contextCrossCheck.js";
import { withExecutionBudget, withTimeout, type ExecutionBudget } from "../lib/executionBudget.js";
import { applyFactDeskPostProcessToReport } from "../lib/factDeskPostProcess.js";
import { followUpReuseFromClientBrief } from "../lib/followUpReuse.js";
import { interruptedInvestigationSnapshot } from "../../../shared/interruptedSnapshot.js";
import type { InvestigationSnapshotV1 } from "../../../shared/investigation/index.js";
import { createInvestigationEmitter } from "../lib/investigationEmitter.js";
import { createOrchestrateAdapter } from "../lib/orchestrate.js";
import { buildDeterministicFinalReport } from "../lib/deterministicReport.js";
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
  composeClaimWithLinks,
  imageTextForDisplay,
  type buildCaseIntakeMetadata,
  type CaseIntakePayload,
  type normalizeClientMemoryRecall,
} from "../lib/visionIntake.js";
import { makePipelineHooks, makeRunAgentCallbacks } from "./pipelineEvents.js";
import { toPublicStreamEvent } from "./publicStream.js";
import { classifyFailure, QUOTA_SETTLEMENT, RUN_FINAL_STATUS, TIMEOUT_LABEL, type RunOutcome } from "./runOutcome.js";
import { createSseWriter } from "./sseChannel.js";

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
type InvestigationRequest = {
  claim: string;
  ticket: CheckTicket;
  intake: CaseIntakePayload | null;
  intakeMetadata: ReturnType<typeof buildCaseIntakeMetadata>;
  clientMemoryRecall: ReturnType<typeof normalizeClientMemoryRecall>;
  clientFollowUpReuse: ReturnType<typeof followUpReuseFromClientBrief>;
  run: { runId: string; caseId: string; createdAt: number };
};

function makeSearchOneAtom(
  onSearchProgress: ((event: SearchProgressEvent) => void) | undefined,
  searchEnv: Record<string, string>,
  execution: ExecutionBudget = {},
  recorder?: RunRecorder,
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
    recorder?.recordMaterial({ kind: "search-response", content: JSON.stringify(result), metadata: { query: atom } });
    return result;
  };
}

function pipelineFinalize(
  ctx: { finalReport: Record<string, unknown>; claim: string },
  visualExtraction?: Record<string, unknown>
) {
  applyFactDeskPostProcessToReport(ctx.finalReport);
  applyContextCrossCheckToReport(ctx.finalReport, { claim: ctx.claim, visualExtraction });
}

/**
 * 整体核查超时兜底：不憋用户，先给「还没查完」的中间结论（unverified + error-boundary）。
 * 只在宽限期也过了、管线确定回不来时用（第一次总超时不走这条路）。
 */
function buildTimedOutReport(c: string): Record<string, unknown> {
  const report = buildDeterministicFinalReport(c, [], undefined);
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

export async function runInvestigation(deps: InvestigationRunDeps, request: InvestigationRequest, res?: any): Promise<void> {
  const response = res ?? { headersSent: true, writableEnded: true, destroyed: false, on() {}, writeHead() {}, end() {} };
  try {
    await runInvestigationToEnd(deps, request, response);
  } catch (error) {
    // Also cover failures before the inner execution guard (transport setup or storage reads).
    try { deps.runs.finish(request.run.runId, "interrupted"); }
    catch (storageError) {
      console.error(`[run] failure could not be persisted runId=${request.run.runId}`, storageError);
    }
    throw error;
  } finally {
    // 每条结局都已显式结算；走到这里还没结算，说明收尾途中出了没预料到的异常：按服务端失败退还。
    if (!request.ticket.settled) {
      console.error(`[quota] run 结束时名额未结算，按服务端失败退还 runId=${request.run.runId}`);
      releaseFreeCheck(request.ticket);
    }
  }
}

async function runInvestigationToEnd(deps: InvestigationRunDeps, request: InvestigationRequest, res: any): Promise<void> {
  const { env, runs } = deps;
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
  let claim = composeClaimWithLinks(request.claim, intake);
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

  // A subscriber leaving only closes transport; cancellation remains a durable run operation.
  let detachedFromClient = false;
  const disconnect = new AbortController();
  const pipelineSignal = AbortSignal.any([disconnect.signal, ...(runSignal ? [runSignal] : [])]);
  let writer: ReturnType<typeof createSseWriter> | undefined;
  if (!res.writableEnded && !res.destroyed) {
    try { writer = createSseWriter(res); }
    catch (error) { detachedFromClient = true; console.warn("[sse] initial connection unavailable", error); }
  }
  const sendEvent = (data: object) => { runs.publish(runId, data as Record<string, unknown>); };
  const endResponse = () => { writer?.finish(); };
  const unsubscribeRun = writer ? runs.subscribe(runId, event => { void writer?.send(toPublicStreamEvent(event)); }) : () => {};
  writer?.onClose(() => { detachedFromClient = true; unsubscribeRun(); });
  // A just-created legacy run has only its acceptance events; do not open a transport for background runs.
  if (writer) for (const event of runs.replayEvents(runId, 0, 128)) void writer.send(toPublicStreamEvent(event));

  // Investigation Snapshot 最新帧：中断/超时时补发 interrupted 帧（保留已真实获得的数据）。
  let lastInvestigation: InvestigationSnapshotV1 | undefined;
  /**
   * 收尾：落终态并把结果广播出去。客户端就靠这帧把「正在停止」翻成「已停止」，
   * 不能让它自己猜——猜出来的状态等于假状态。
   */
  let terminalEvents: Record<string, unknown>[] = [];
  let recorder: RunRecorder | undefined;
  const finishRun = (status: "completed" | "interrupted" | "cancelled", report?: Record<string, unknown>, extraEvents: Record<string, unknown>[] = []) => {
    const current = runs.get(runId);
    if (current?.status === "cancelling") status = "cancelled";
    if (status === "completed") {
      recorder?.assertHealthy();
      if (!lastInvestigation || !recorder) throw new Error("Final result has no recorded investigation");
      recorder.validateSnapshot(lastInvestigation, { requireEvidenceMaterials: true });
    }
    if (report && lastInvestigation) report.investigation = lastInvestigation;
    runs.commit(runId, {
      status,
      ...(lastInvestigation ? { snapshot: lastInvestigation, publication: status === "completed" ? "final" as const : "partial" as const } : {}),
      ...(report ? { report } : {}),
      events: [
        ...terminalEvents,
        ...extraEvents,
        ...(report ? [{ type: "complete", claim: displayClaim, steps: [], finalReport: report }] : []),
        { type: "run_state", status, terminal: true },
      ],
    });
    terminalEvents = [];
  };

  const emitter = createInvestigationEmitter({
    runId,
    send: sendEvent,
    commitSnapshot: (snapshot, events) => {
      if (snapshot.phase === "complete" || snapshot.phase === "interrupted") {
        terminalEvents = events;
        return;
      }
      const status = snapshot.phase === "judging" ? "judging" : "investigating";
      runs.commit(runId, { snapshot, status, events });
    },
  });
  const emitInvestigation = (snapshot: InvestigationSnapshotV1) => {
    if (pipelineSignal.aborted && snapshot.phase !== "interrupted") return;
    lastInvestigation = snapshot;
    emitter.emitSnapshot(snapshot);
  };

  try {
    recorder = createRunRecorder(runId);
    recorder.recordMaterial({ kind: "original-input", content: JSON.stringify(runs.getInput(runId) ?? { claim: request.claim, intake }) });
    runs.advance(runId, "extracting");
    if (intake?.images.length) {
      sendEvent({
        type: "tool_start",
        toolName: "StepFun Vision",
        query: "图片材料解析",
        timestamp: Date.now(),
      });
      try {
        const readImage = async () => {
          const attemptId = recorder!.startAttempt({ stage: "vision", input: { claim, intake } });
          try {
            const result = await withExecutionBudget(
              (signal) => callStepFunVisionForIntake({ env, claim, intake, signal }),
              { signal: pipelineSignal, deadlineMs: workDeadlineMs, timeoutMs: 60_000, label: "图片解析" },
            );
            recorder!.finishAttempt(attemptId, { status: "succeeded", output: result.output, model: result.model });
            return result;
          } catch (error) {
            recorder!.finishAttempt(attemptId, { status: pipelineSignal.aborted ? "cancelled" : "failed", error: String(error) });
            throw error;
          }
        };
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
      priorRoundContext: clientFollowUpReuse,
      recorder,
      ...makeRunAgentCallbacks(sendEvent),
    });

    const pipelinePromise = withExecutionBudget((signal) => runCasePipeline({
      claim,
      displayClaim,
      recorder,
      // 断连与取消两个 abort 源合并：任一触发，管线阶段边界立即退出
      signal,
      // 截止 = 总超时 − 10s 收尾余量：来源审计刷新在此前收敛
      deadline: workDeadlineMs,
      intakeLinks: intake?.links,
      runAgent,
      searchOne: makeSearchOneAtom((event) => sendEvent(event), env, { signal, deadlineMs: workDeadlineMs }, recorder),
      hooks: makePipelineHooks({ sendEvent, emitInvestigation, emitter }),
      finalizeReport: (fctx) => pipelineFinalize(fctx, visualExtraction),
    }), { signal: pipelineSignal, timeoutMs: PIPELINE_TOTAL_TIMEOUT_MS + PIPELINE_LATE_GRACE_MS, label: TIMEOUT_LABEL });
    // withTimeout 是 race：落败方的 rejection 必须被吸收，
    // 否则断连/超时触发的 abort 会变成 unhandledRejection 直接崩进程
    pipelinePromise.catch(() => {});
    const result = await (async () => {
      try {
        return await withTimeout(pipelinePromise, PIPELINE_TOTAL_TIMEOUT_MS, TIMEOUT_LABEL);
      } catch (error) {
        // 超时不一锤定音。超时只说明「这条连接的等待到头了」，不是管线失败：
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

    recorder.assertHealthy();
    const failed = result.finalReport._source === "error-boundary";
    finishRun(failed ? "interrupted" : "completed", result.finalReport);
    settleQuota(failed ? "server-error" : "completed");
    endResponse();
  } catch (error) {
    const outcome = classifyFailure(error, {
      cancelled: Boolean(runSignal?.aborted),
    });
    if (outcome !== "cancelled") console.error(`[run] ${outcome}:`, error);
    if (outcome === "cancelled") {
      settleQuota(outcome);
      emitInvestigation({ ...interruptedInvestigationSnapshot(lastInvestigation, displayClaim), interruptionReason: "cancelled" });
      finishRun(RUN_FINAL_STATUS[outcome]);
      endResponse();
      return;
    }
    // 走到这里说明这次管线已经是 race 的落败方——abort 它，
    // 各阶段边界会立即退出，不再僵尸烧 token。
    // （第一次总超时不走这条——那条路上管线被故意留着继续收尾。）
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
      // 先计费再收尾：release 在前会把 settled 置真，commit 变空操作，超时就等于白嫖。
      settleQuota(outcome);
      finishRun(RUN_FINAL_STATUS[outcome], timedOut);
      endResponse();
      return;
    }
    // 客户端主动断开（刷新/关页/写失败）→ 照常计费，放弃不能变成免费重试入口；
    // 服务端真失败 → 退还这次核查
    settleQuota(outcome);
    if (error instanceof ImageUnreadableError) {
      // 只有图片且没读出来：没有任何东西可核查，不发中断快照，直接说明原因（额度已按 server-error 退还）。
      finishRun(RUN_FINAL_STATUS[outcome], undefined, [{ type: "error", code: "image_unreadable", message: IMAGE_UNREADABLE_ONLY_MESSAGE }]);
      endResponse();
      return;
    }
    // 中断帧先行：前端拿到 phase=interrupted 的真实部分数据，再收 error 提示。
    emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, displayClaim));
    finishRun(RUN_FINAL_STATUS[outcome], undefined, [{ type: "error", message: "这次核查没能完成，请稍后重试" }]);
    endResponse();
  } finally {
    unsubscribeRun();
    writer?.finish();
  }
}
