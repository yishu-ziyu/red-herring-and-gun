/**
 * handlers.ts — Express HTTP adapter.
 *
 * 路由处理器与组装：调查流的请求解析与校验在这里，一次调查的生命周期在 http/investigationRun.ts，
 * 管线事件到 SSE 帧在 http/pipelineEvents.ts，公开流清洗在 http/publicStream.ts，SSE 线上格式在 http/sseChannel.ts。
 * 产品规则不写在 HTTP 层；域深度在 lib/。
 */

import { createRunService, hashRunInput } from "./lib/runService.js";
import { isTerminalStatus, openRunStore } from "./lib/runStore.js";
import { generateCaseId } from "./lib/caseStore.js";
import { ensureGuestId, guestIdFromRequest, guestOwnerHash, releaseFreeCheck } from "./lib/checkQuota.js";
import { createShareHandlers } from "./lib/shareHandlers.js";
import { readJson, sendJson } from "./lib/httpUtils.js";
import {
  normalizeCaseIntake,
  normalizeClientMemoryRecall,
  buildCaseIntakeMetadata,
} from "./lib/visionIntake.js";
import { followUpReuseFromClientBrief } from "./lib/followUpReuse.js";
import { runInvestigation, type InvestigationRunDeps } from "./http/investigationRun.js";
import { openSse, sseFrame, SSE_KEEPALIVE_FRAME, SSE_KEEPALIVE_MS } from "./http/sseChannel.js";
import { toPublicStreamEvent } from "./http/publicStream.js";

export { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot.js";

export { toFriendlyError, toPublicStreamEvent, type FriendlyErrorInfo } from "./http/publicStream.js";


/**
 * 管道总时限默认值：210s → 300s（P0）→ 420s（给 MiniMax-M2.7 作判断 180s 留余量）。
 * 依据：真实走查那一轮总时长压到 210 秒线附近，管线在 225.9s 才真正跑完并落了一份带结论的快照，
 * 而客户端在 210.0s 已经被判成「没查完」——那份 16 秒后产出的真结论没有任何人看得到。
 */
export const PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT = 420_000;

/**
 * 总超时之后还给仍在跑的管线多少时间自己收尾（同一个契约）。
 * 宽限期内跑完 → run 落 complete，结论经刷新恢复通道取回；宽限期到仍不回来 → 按中断收尾。
 * 有界，是为了不让一条僵尸管线永远占着后台；运维可用 ORCHESTRATE_LATE_GRACE_MS 覆盖。
 */
export const PIPELINE_LATE_GRACE_MS_DEFAULT = 120_000;

export function createHandlers(env: Record<string, string>) {
  // 运行身份与取消（PR-D）：存储不可用时退化成进程内注册表，不阻塞启动。
  const runStore = openRunStore();
  const runs = createRunService({ store: runStore });
  runs.markInterruptedOnBoot();

  /**
   * 取消一次正在跑的调查（IMPLEMENTATION_PLAN §5.5）。
   * 幂等：终态再调无副作用。不可猜的 runId 就是能力凭证。
   */
  async function cancelInvestigationHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();
    const runId = String(req.params?.runId ?? "").trim();
    if (!runId) return sendJson(res, 400, { message: "缺少 runId" });
    const run = runs.get(runId);
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    // 只有发起调查的浏览器能停它；没有归属的旧调查照旧。
    if (run.ownerHash) {
      const guestId = guestIdFromRequest(req);
      if (!guestId || guestOwnerHash(guestId) !== run.ownerHash) return sendJson(res, 403, { message: "不能停止别人的调查" });
    }
    const result = runs.cancel(runId);
    if (result.kind === "not-found") return sendJson(res, 404, { message: "没有这次调查" });
    // 立刻把「在停」广播到还开着的流上：客户端不能靠 POST 回执猜流上的状态。
    runs.publish(runId, { type: "run_state", status: result.run.status, terminal: isTerminalStatus(result.run.status), timestamp: Date.now() });
    return sendJson(res, 200, {
      runId,
      status: result.run.status,
      accepted: result.kind === "cancelling",
    });
  }

  /**
   * GET /api/investigations/:runId — 刷新恢复（IMPLEMENTATION_PLAN §5.3）。
   * 只给拿得到不可猜 runId 的人；不跑模型、不检索、不扣额。
   */
  async function getInvestigationHandler(req: any, res: any, next: any) {
    if (req.method !== "GET") return next();
    const runId = String(req.params?.runId ?? "").trim();
    if (!runId) return sendJson(res, 400, { message: "缺少 runId" });
    const run = runs.get(runId);
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    return sendJson(res, 200, toPublicStreamEvent({
      runId: run.runId,
      caseId: run.caseId,
      status: run.status,
      revision: run.revision,
      lastSeq: run.lastSeq,
      snapshot: run.snapshot,
      activities: runs.replayActivities(runId, 0),
      updatedAt: run.updatedAt,
    }));
  }

  /**
   * GET /api/investigations/:runId/events?after=N — 补发 N 之后的活动，再接直播。
   * 重连不新建 run、不重复扣额；终态的 run 补完就关，不挂长连接。
   */
  async function investigationEventsHandler(req: any, res: any, next: any) {
    if (req.method !== "GET") return next();
    const runId = String(req.params?.runId ?? "").trim();
    const run = runId ? runs.get(runId) : null;
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    const afterRaw = Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("after") ?? 0);
    const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;

    openSse(res);
    // 接回补发与直播使用首次提交相同的公开清洗边界（Issue #132 / R11）。
    const write = (event: object) => {
      try {
        res.write(sseFrame(toPublicStreamEvent(event)));
      } catch {
        /* 客户端已断开，由 close 收尾 */
      }
    };

    write({ type: "run_started", runId, caseId: run.caseId, timestamp: Date.now() });
    // 补发：先给已经发生过的活动，再给最新快照。
    for (const activity of runs.replayActivities(runId, after)) {
      write({ type: "investigation_activity", activity, timestamp: Date.now() });
    }
    if (run.snapshot) {
      write({ type: "investigation_snapshot", investigation: run.snapshot, timestamp: Date.now() });
    }

    const terminal = isTerminalStatus(run.status);
    write({ type: "run_state", status: run.status, terminal, timestamp: Date.now() });
    if (terminal) {
      res.end();
      return;
    }

    const unsubscribe = runs.subscribe(runId, (event) => {
      write(event);
      if (event.type === "run_state" && event.terminal === true) close();
    });
    const heartbeat = setInterval(() => {
      try {
        res.write(SSE_KEEPALIVE_FRAME);
      } catch {
        /* ignored */
      }
    }, SSE_KEEPALIVE_MS);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };
    res.on("close", close);
  }

  const PIPELINE_TOTAL_TIMEOUT_MS = Number(env.ORCHESTRATE_TOTAL_TIMEOUT_MS || PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT);
  /** 超时后给管线自己收尾的宽限（Change C）；ORCHESTRATE_LATE_GRACE_MS 可覆盖，默认 120s。 */
  const PIPELINE_LATE_GRACE_MS = Number(env.ORCHESTRATE_LATE_GRACE_MS || PIPELINE_LATE_GRACE_MS_DEFAULT);
  const investigationDeps: InvestigationRunDeps = {
    env,
    runs,
    runStore,
    totalTimeoutMs: PIPELINE_TOTAL_TIMEOUT_MS,
    lateGraceMs: PIPELINE_LATE_GRACE_MS,
  };

  /** 建 run 之前的提前拒绝：退还额度闸发的名额（没有票据时什么也不做；重复退还由 settled 挡住）。 */
  function releaseEarlyTicket(req: any) {
    if (req.checkTicket) releaseFreeCheck(req.checkTicket);
  }

  /**
   * 建 run 之前任何一步抛错（建 run、存储出错）：退还名额并回 500，不让名额悬空。
   * 进入 runInvestigation 之后由它按结局结算（http/runOutcome.ts）。
   */
  async function orchestrateStreamHandler(req: any, res: any, next: any) {
    try {
      return await startOrchestrateStream(req, res, next);
    } catch (error) {
      console.error("[orchestrate] 调查请求处理出错", error);
      releaseEarlyTicket(req);
      if (!res.headersSent) return sendJson(res, 500, { message: "这次核查没能开始，请稍后重试" });
      if (!res.writableEnded) res.end();
    }
  }

  async function startOrchestrateStream(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      releaseEarlyTicket(req);
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const claim = payload.claim;
    if (!claim || typeof claim !== "string") {
      releaseEarlyTicket(req);
      return sendJson(res, 400, { message: "缺少 claim 参数" });
    }
    const ticket = req.checkTicket;
    if (!ticket) return;
    const intake = normalizeCaseIntake(payload.intake);
    const intakeMetadata = buildCaseIntakeMetadata(intake);
    const clientMemoryRecall = normalizeClientMemoryRecall(payload.memoryRecall);

    // 运行身份（PR-D 片一）：clientRequestId 幂等、runId 供取消与后续重连使用。
    // 没有这条 run 之前，「停止」只能是前端不管结果，服务端照跑照烧。
    const clientRequestId =
      typeof payload.clientRequestId === "string" && payload.clientRequestId.trim()
        ? payload.clientRequestId.trim().slice(0, 120)
        : null;

    // 追问：服务端没有用户档案，上一轮可见材料由浏览器放在 priorRound 里带来。
    // 首轮与 legacy 路径不传 followUp（caseId 仍按老规矩当本次 case 用）。
    const isFollowUp = payload.followUp === true;
    // 分享只认创建这次调查的浏览器：记下访客 id 的哈希（没有访客 cookie 就在这次响应里发一个）。
    const ownerHash = guestOwnerHash(ensureGuestId(req, res, ticket.guestId));
    const clientFollowUpReuse = isFollowUp ? followUpReuseFromClientBrief(payload.priorRound) : null;
    // #145 对比实验：只在非生产环境接受精简管线，生产环境的客户端切不了。
    const pipelineMode = payload.pipeline === "lean" && process.env.NODE_ENV !== "production" ? "lean" : "full";

    const started = runs.start({
      // 追问轮是新一轮调查：caseId 另生成一个，
      // 不拿上一轮的 caseId 当本轮的 caseId（那会让两轮共用同一个案件坐标）。
      caseId: isFollowUp
        ? generateCaseId(claim)
        : typeof payload.caseId === "string" && payload.caseId
          ? payload.caseId
          : generateCaseId(claim),
      ownerHash,
      clientRequestId,
      inputHash: hashRunInput(claim, { intake: intakeMetadata }),
    });
    if (started.kind === "conflict") {
      releaseFreeCheck(ticket);
      return sendJson(res, 409, {
        message: "同一个请求编号对应了不同的材料，这次没有重复核查。",
        runId: started.existing.runId,
      });
    }
    if (started.kind === "existing") {
      releaseFreeCheck(ticket);
      return investigationEventsHandler({
        ...req,
        method: "GET",
        params: { ...req.params, runId: started.run.runId },
        url: `/api/investigations/${started.run.runId}/events?after=0`,
      }, res, next);
    }
    return runInvestigation(investigationDeps, {
      claim,
      ticket,
      intake,
      intakeMetadata,
      clientMemoryRecall,
      clientFollowUpReuse,
      pipelineMode,
      run: { runId: started.run.runId, caseId: started.run.caseId },
    }, res);
  }

  return {
    ...createShareHandlers({ getRun: (runId) => runs.get(runId) }),
    orchestrateStreamHandler,
    cancelInvestigationHandler,
    getInvestigationHandler,
    investigationEventsHandler,
  };
}
