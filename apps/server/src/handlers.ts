/**
 * handlers.ts — Express HTTP adapter.
 *
 * 路由处理器与组装：调查流的请求解析与校验在这里，一次调查的生命周期在 http/investigationRun.ts，
 * 管线事件到 SSE 帧在 http/pipelineEvents.ts，公开流清洗在 http/publicStream.ts，SSE 线上格式在 http/sseChannel.ts。
 * 产品规则不写在 HTTP 层；域深度在 lib/。
 */

import { createRunService, hashRunInput } from "./lib/runService.js";
import { readEmailAccountOptional } from "./lib/emailSession.js";
import { isTerminalStatus, openRunStore } from "./lib/runStore.js";
import { getCase, generateCaseId, type CaseEntry } from "./lib/caseStore.js";
import { listAvailableModels, validateModelChoice } from "./lib/availableModels.js";
import { MODEL_UNKNOWN_MESSAGE, probeModelServiceHealth } from "./lib/modelServiceHealth.js";
import { releaseFreeCheck } from "./lib/checkQuota.js";
import { readJson, sendJson } from "./lib/httpUtils.js";
import { isBlockedTestLlmUrl } from "./lib/ssrfGuard.js";
import {
  normalizeCaseIntake,
  normalizeClientMemoryRecall,
  buildCaseIntakeMetadata,
} from "./lib/visionIntake.js";
import { followUpReuseFromClientBrief } from "./lib/followUpReuse.js";
import { runInvestigation, type InvestigationRunDeps } from "./http/investigationRun.js";
import { openSse, sseFrame, SSE_KEEPALIVE_FRAME, SSE_KEEPALIVE_MS } from "./http/sseChannel.js";
import { baseUrlTargetsPrivateNetwork, isLocalHttpUrl, parseByoConfig } from "./lib/orchestrateByo.js";

export { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot.js";

/**
 * 追问关联失败只说这一句：不区分「案件不存在」与「不是你的案件」，
 * 否则拿别人的 caseId 试一次就能问出它存不存在。三种失败共用同一文案。
 */
export const FOLLOW_UP_CASE_MISSING_MESSAGE = "追问关联的案件不存在或无权访问";

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
   * 追问关联校验（阶段 3）：案件必须存在，且 ownerHash 与请求者一致。
   * 无归属的老 case 与匿名请求（ownerHash 为空）一律视为无权——案件只在登录后才写入。
   * 读库出错也按「不存在或无权访问」处理：宁可 400，也不把名额留在半空、不建 run。
   */
  function readOwnedCase(caseId: string, ownerHash: string | null): CaseEntry | null {
    if (!caseId || !ownerHash) return null;
    try {
      const entry = getCase(caseId);
      return entry && entry.ownerHash === ownerHash ? entry : null;
    } catch (error) {
      console.error(`[followup] 读上一轮案件失败 caseId=${caseId}`, error);
      return null;
    }
  }

  const codexBin = env.CODEX_BIN || process.env.CODEX_BIN || "/usr/local/bin/codex";

  /**
   * 取消一次正在跑的调查（IMPLEMENTATION_PLAN §5.5）。
   * 幂等：终态再调无副作用。有归属的 run 只给主人取消；匿名 run 靠不可猜的 runId 当能力凭证。
   */
  async function cancelInvestigationHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();
    const runId = String(req.params?.runId ?? "").trim();
    if (!runId) return sendJson(res, 400, { message: "缺少 runId" });
    const run = runs.get(runId);
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    const account = await readEmailAccountOptional(req);
    const requester = account?.hash ?? null;
    if (run.ownerHash && run.ownerHash !== requester) {
      return sendJson(res, 404, { message: "没有这次调查" });
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
   * 只给本人（或拿得到不可猜 runId 的匿名访客）；不跑模型、不检索、不扣额。
   */
  async function getInvestigationHandler(req: any, res: any, next: any) {
    if (req.method !== "GET") return next();
    const runId = String(req.params?.runId ?? "").trim();
    if (!runId) return sendJson(res, 400, { message: "缺少 runId" });
    const run = runs.get(runId);
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    const account = await readEmailAccountOptional(req);
    if (run.ownerHash && run.ownerHash !== (account?.hash ?? null)) {
      return sendJson(res, 404, { message: "没有这次调查" });
    }
    return sendJson(res, 200, {
      runId: run.runId,
      caseId: run.caseId,
      status: run.status,
      revision: run.revision,
      lastSeq: run.lastSeq,
      snapshot: run.snapshot,
      activities: runs.replayActivities(runId, 0),
      updatedAt: run.updatedAt,
    });
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
    const account = await readEmailAccountOptional(req);
    if (run.ownerHash && run.ownerHash !== (account?.hash ?? null)) {
      return sendJson(res, 404, { message: "没有这次调查" });
    }
    const afterRaw = Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("after") ?? 0);
    const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;

    openSse(res);
    // 接回流直接写总线原始事件，不经 toPublicStreamEvent（与首次提交的流不同，见 rewrite-issues R11）。
    const write = (event: object) => {
      try {
        res.write(sseFrame(event));
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

  async function modelsListHandler(req: any, res: any, next: any) {
    if (req.method !== "GET") return next();
    try {
      const models = listAvailableModels(env);
      return sendJson(res, 200, { models });
    } catch (error) {
      const message = error instanceof Error ? error.message : "列出可用模型失败";
      return sendJson(res, 500, { message });
    }
  }

  async function modelsHealthHandler(req: any, res: any, next: any) {
    if (req.method !== "GET") return next();
    try {
      const health = await probeModelServiceHealth(env);
      return sendJson(res, 200, health);
    } catch {
      return sendJson(res, 200, {
        status: "unknown",
        message: MODEL_UNKNOWN_MESSAGE,
      });
    }
  }

  const PIPELINE_TOTAL_TIMEOUT_MS = Number(env.ORCHESTRATE_TOTAL_TIMEOUT_MS || PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT);
  /** 超时后给管线自己收尾的宽限（Change C）；ORCHESTRATE_LATE_GRACE_MS 可覆盖，默认 120s。 */
  const PIPELINE_LATE_GRACE_MS = Number(env.ORCHESTRATE_LATE_GRACE_MS || PIPELINE_LATE_GRACE_MS_DEFAULT);
  const investigationDeps: InvestigationRunDeps = {
    env,
    codexBin,
    runs,
    runStore,
    totalTimeoutMs: PIPELINE_TOTAL_TIMEOUT_MS,
    lateGraceMs: PIPELINE_LATE_GRACE_MS,
  };

  async function orchestrateStreamHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const claim = payload.claim;
    if (!claim || typeof claim !== "string") {
      return sendJson(res, 400, { message: "缺少 claim 参数" });
    }
    // BYO key 接管：请求携带合法 byoKey 时，调查管线主力模型调用与命中家的检索改用请求内凭证；
    // 未携带时 byo=undefined，行为与现状零差异。携带但畸形 → 400 拒绝（先退还本次核查名额）。
    const byoParsed = await parseByoConfig(payload.byoKey);
    if (!byoParsed.ok) {
      const earlyTicket = req.checkTicket;
      if (earlyTicket) releaseFreeCheck(earlyTicket);
      return sendJson(res, 400, { message: byoParsed.error });
    }
    const byo = byoParsed.config;
    const modelChoice = payload.modelChoice;
    const mcValidation = validateModelChoice(env, modelChoice);
    if (!mcValidation.ok) {
      return sendJson(res, 400, { message: mcValidation.error || "modelChoice 非法" });
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
    const ownerAccount = await readEmailAccountOptional(req);
    const ownerHash = ownerAccount?.hash ?? null;

    // 追问关联：followUp=true 且带了 caseId → 必须是本人名下案件。
    // 访客没有服务端档案：不带 caseId，把上一轮可见材料放在 priorRound；校验放在建 run 与额度扣除之前。
    // 首轮与 legacy 路径不传 followUp，行为与现状完全一致（caseId 仍按老规矩当本次 case 用）。
    const isFollowUp = payload.followUp === true;
    const priorCaseId = typeof payload.caseId === "string" ? payload.caseId.trim() : "";
    const priorCase = isFollowUp && priorCaseId ? readOwnedCase(priorCaseId, ownerHash) : null;
    if (isFollowUp && priorCaseId && !priorCase) {
      releaseFreeCheck(ticket);
      return sendJson(res, 400, { message: FOLLOW_UP_CASE_MISSING_MESSAGE });
    }
    const clientFollowUpReuse =
      isFollowUp && !priorCase ? followUpReuseFromClientBrief(payload.priorRound) : null;

    const started = runs.start({
      // 追问轮是新一轮调查：caseId 另生成一个，上一轮的 caseId 记在 priorCaseId 上，
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
      run: { runId: started.run.runId, caseId: started.run.caseId },
    }, res);
  }

  // ───────────────────────────────────────────────────────────────
  // POST /api/agent/test-llm — BYO key 连接性探针（不落库，不记 key）
  // 强约束：
  //   - 仅放行 https:// 站点（dev 允许 http://localhost）
  //   - prod 拒绝任何 loopback / 内网 IP
  //   - 5s 超时 + AbortController
  //   - 永不记录 apiKey
  // 内网/loopback 判定抽到 lib/orchestrateByo.ts，供 BYO 接管路径共用同一纪律。
  // ───────────────────────────────────────────────────────────────

  async function testLlmHandler(req: any, res: any, next: any) {
    if (process.env.NODE_ENV === "production") {
      return sendJson(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: "无法解析请求 JSON" });
    }

    const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : "";
    const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
    const modelName = typeof payload.modelName === "string" ? payload.modelName.trim() : "";

    if (!baseUrl || !apiKey) {
      return sendJson(res, 400, { ok: false, error: "缺少 baseUrl 或 apiKey" });
    }

    const isLocalhost = isLocalHttpUrl(baseUrl);
    if (!baseUrl.startsWith("https://") && !isLocalhost) {
      return sendJson(res, 400, {
        ok: false,
        error: "baseUrl 必须以 https:// 开头（dev 环境允许 http://localhost）",
      });
    }

    if (!isLocalhost && (await baseUrlTargetsPrivateNetwork(baseUrl))) {
      return sendJson(res, 400, {
        ok: false,
        error: "禁止 baseUrl 指向 loopback 或内网地址",
      });
    }
    if (isBlockedTestLlmUrl(baseUrl) && !isLocalhost) {
      return sendJson(res, 400, {
        ok: false,
        error: "禁止 baseUrl 指向 loopback、内网或 metadata 地址",
      });
    }

    const normalizedBase = baseUrl.replace(/\/$/, "");
    const target = `${normalizedBase}/chat/completions`;
    const safeLabel = modelName || "默认模型";
    console.log(`[test-llm] test attempt for modelName=${safeLabel}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const startedAt = Date.now();
    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName || "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
        signal: controller.signal,
        redirect: "manual",
      });

      const latencyMs = Date.now() - startedAt;
      await upstream.arrayBuffer().catch(() => undefined);

      if (!upstream.ok) {
        return sendJson(res, 200, {
          ok: false,
          latencyMs,
          status: upstream.status,
        });
      }

      return sendJson(res, 200, {
        ok: true,
        latencyMs,
        status: upstream.status,
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "未知错误";
      const aborted = error instanceof Error && error.name === "AbortError";
      return sendJson(res, 200, {
        ok: false,
        latencyMs,
        error: aborted ? "连接超时（5s）" : message,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    modelsListHandler,
    modelsHealthHandler,
    orchestrateStreamHandler,
    cancelInvestigationHandler,
    getInvestigationHandler,
    investigationEventsHandler,
    testLlmHandler,
  };
}
