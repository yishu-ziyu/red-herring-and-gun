/**
 * 一次调查的执行（请求通过校验、run 建好之后）：
 *
 *   读材料 → 管线接线 → 两段时限（总时限 → 宽限）→ 结局（outcome.ts）→ RunService.settle 落终态。
 *
 * 不认识 SSE：订阅者来去不影响执行，取消是 run 自己的操作。
 */
import { runCasePipeline } from "../casePipeline/runCasePipeline.js";
import { IMAGE_UNREADABLE_ONLY_MESSAGE, ImageUnreadableError, readIntake, type IntakeResult } from "../casePipeline/stages/intake.js";
import { applyContextCrossCheckToReport } from "../contextCrossCheck.js";
import { buildInterruptedReport } from "../deterministicReport.js";
import { withExecutionBudget, withTimeout, type ExecutionBudget } from "../executionBudget.js";
import type { followUpReuseFromClientBrief } from "../followUpReuse.js";
import { createOrchestrateAdapter } from "../orchestrate.js";
import { createRunRecorder, type RunRecorder } from "../runRecorder.js";
import type { RunService } from "../runService.js";
import {
  build360SearchFailure,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "../searchProviders.js";
import type { buildCaseIntakeMetadata, CaseIntakePayload, normalizeClientMemoryRecall } from "../visionIntake.js";
import type { InvestigationSnapshotV1 } from "../../../../shared/investigation/index.js";
import { makePipelineHooks, makeRunAgentCallbacks } from "../../http/pipelineEvents.js";
import { classifyFailure, TIMEOUT_LABEL, type RunEnding } from "./outcome.js";

export type InvestigationRunDeps = {
  env: Record<string, string>;
  runs: RunService;
  /** 总时限（ORCHESTRATE_TOTAL_TIMEOUT_MS）。 */
  totalTimeoutMs: number;
  /** 总时限到了之后给管线自己收尾的宽限（ORCHESTRATE_LATE_GRACE_MS）。 */
  lateGraceMs: number;
};

/** 已通过校验、已建好 run 的一次调查请求。 */
export type InvestigationRequest = {
  claim: string;
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

/** 截图语境核查：用户配文对视觉提取，写进报告提示，不改判定。 */
function crossCheck(report: Record<string, unknown>, material: IntakeResult | undefined) {
  applyContextCrossCheckToReport(report, { caption: material?.caption ?? "", visualExtraction: material?.visualExtraction });
}

/** 执行并落终态；从不抛出，任何意外都按服务端失败收尾。 */
export async function runInvestigation(deps: InvestigationRunDeps, request: InvestigationRequest): Promise<void> {
  const { runs } = deps;
  const { runId } = request.run;
  const ending = await execute(deps, request);
  try {
    runs.settle(runId, ending);
  } catch (error) {
    console.error(`[run] result could not be published runId=${runId}`, error);
    try { runs.settle(runId, { outcome: "server-error", displayClaim: ending.displayClaim, snapshot: ending.snapshot }); }
    catch (storageError) {
      console.error(`[run] failure could not be persisted runId=${runId}`, storageError);
    }
  }
}

async function execute(deps: InvestigationRunDeps, request: InvestigationRequest): Promise<RunEnding> {
  const { env, runs, totalTimeoutMs, lateGraceMs } = deps;
  const { intake, intakeMetadata, clientMemoryRecall, clientFollowUpReuse } = request;
  const runId = request.run.runId;
  const runSignal = runs.signalFor(runId);
  const workDeadlineMs = Date.now() + Math.max(1, totalTimeoutMs - 10_000);
  // 管线输掉时限竞赛后从这里叫停；取消走 run 自己的信号。
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, ...(runSignal ? [runSignal] : [])]);
  const publish = (event: object) => { runs.publish(runId, event as Record<string, unknown>); };

  let displayClaim = request.claim;
  let material: IntakeResult | undefined;
  let lastSnapshot: InvestigationSnapshotV1 | undefined;
  try {
    const recorder = createRunRecorder(runId);
    recorder.recordMaterial({ kind: "original-input", content: JSON.stringify(runs.getInput(runId) ?? { claim: request.claim, intake }) });
    runs.advance(runId, "extracting");
    const intakeResult = await readIntake({ runId, env, claim: request.claim, intake, signal, deadlineMs: workDeadlineMs, recorder, publish });
    material = intakeResult;
    displayClaim = intakeResult.displayClaim;
    for (const notice of intakeResult.notices) publish({ type: "notice", ...notice, timestamp: Date.now() });

    const adapter = createOrchestrateAdapter({ env, signal, deadlineMs: workDeadlineMs });
    const runAgent = adapter.makeRunAgent({
      claim: intakeResult.claim,
      intakeMetadata,
      visualExtraction: intakeResult.visualExtraction,
      clientMemoryRecall,
      priorRoundContext: clientFollowUpReuse,
      recorder,
      ...makeRunAgentCallbacks(publish),
    });
    const emitInvestigation = (snapshot: InvestigationSnapshotV1) => {
      if (signal.aborted && snapshot.phase !== "interrupted") return;
      lastSnapshot = snapshot;
      runs.emitSnapshot(runId, snapshot);
    };

    const pipelinePromise = withExecutionBudget((budgetSignal) => runCasePipeline({
      claim: intakeResult.claim,
      displayClaim,
      recorder,
      signal: budgetSignal,
      // 截止 = 总超时 − 10s 收尾余量：来源审计刷新在此前收敛
      deadline: workDeadlineMs,
      intakeLinks: intake?.links,
      runAgent,
      searchOne: makeSearchOneAtom(publish, env, { signal: budgetSignal, deadlineMs: workDeadlineMs }, recorder),
      hooks: makePipelineHooks({
        sendEvent: publish,
        emitInvestigation,
        emitter: { emitSearchStarted: (atom) => runs.emitSearchStarted(runId, atom) },
      }),
      finalizeReport: ({ finalReport }) => crossCheck(finalReport, intakeResult),
    }), { signal, timeoutMs: totalTimeoutMs + lateGraceMs, label: TIMEOUT_LABEL });
    // withTimeout 是 race：落败方的 rejection 必须被吸收，
    // 否则超时或取消触发的 abort 会变成 unhandledRejection 直接崩进程
    pipelinePromise.catch(() => {});
    let result: Awaited<typeof pipelinePromise>;
    try {
      result = await withTimeout(pipelinePromise, totalTimeoutMs, TIMEOUT_LABEL);
    } catch (error) {
      // 超时不一锤定音。总时限只说明「等待到头了」，不是管线失败：
      //  1) 先告诉客户端「还在查」，用户留在页面上就继续跟着看；
      //  2) 再等管线自己收尾：晚完成 → 落 complete，快照与结论经刷新恢复通道取回；
      //  3) 宽限期到还没回来 → 抛出，按「超时中断」收尾（现有文案与重查入口）。
      if (!(error instanceof Error && error.message.includes(TIMEOUT_LABEL))) throw error;
      publish({ type: "timeout_pending", timestamp: Date.now() });
      console.log(`[orchestrate] 总时限 ${totalTimeoutMs}ms 到，管线继续收尾（宽限 ${lateGraceMs}ms）runId=${runId}`);
      result = await withTimeout(pipelinePromise, lateGraceMs, TIMEOUT_LABEL);
    }
    signal.throwIfAborted();
    console.log(`[atom_search] sources=${(result.atomSearchBundle.aggregate.sources || []).length}`);

    recorder.assertHealthy();
    const failed = result.finalReport._source === "error-boundary";
    return { outcome: failed ? "server-error" : "completed", displayClaim, snapshot: lastSnapshot, report: result.finalReport };
  } catch (error) {
    const outcome = classifyFailure(error, { cancelled: Boolean(runSignal?.aborted) });
    if (outcome !== "cancelled") {
      console.error(`[run] ${outcome}:`, error);
      // 这次管线已经是 race 的落败方：叫停它，各阶段边界会立即退出，不再僵尸烧 token。
      stop.abort(error instanceof Error ? error : new Error("aborted"));
    }
    // 只有图片且没读出来：没有任何东西可核查，直接说明原因（额度按 server-error 退还）。
    if (error instanceof ImageUnreadableError) {
      return { outcome, displayClaim, failure: { code: "image_unreadable", message: IMAGE_UNREADABLE_ONLY_MESSAGE } };
    }
    // 宽限期也过了、管线仍不回来：给「还没查完」的中间结论，不发 error。
    if (outcome === "timed-out") {
      const report = buildInterruptedReport(displayClaim);
      crossCheck(report, material);
      return { outcome, displayClaim, snapshot: lastSnapshot, report };
    }
    return { outcome, displayClaim, snapshot: lastSnapshot };
  }
}
