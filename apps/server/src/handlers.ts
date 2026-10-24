/**
 * handlers.ts — Express HTTP adapter.
 *
 * 路由处理器与组装：调查流的请求解析与校验在这里，一次调查的生命周期在 http/investigationRun.ts，
 * 管线事件到 SSE 帧在 http/pipelineEvents.ts，公开流清洗在 http/publicStream.ts，SSE 线上格式在 http/sseChannel.ts。
 * 产品规则不写在 HTTP 层；域深度在 lib/。
 */

import { createRunRecorder } from "./lib/runRecorder.js";
import { randomUUID } from "node:crypto";
import { createRunService, generateCaseId, hashRunInput } from "./lib/runService.js";
import { isTerminalStatus, openRunStore, type RunRecord } from "./lib/runStore.js";
import { ensureGuestId, guestIdFromRequest, guestOwnerHash, releaseFreeCheck, freeCheckGate } from "./lib/checkQuota.js";
import { createShareHandlers } from "./lib/shareHandlers.js";
import {
  normalizeCaseIntake,
  normalizeClientMemoryRecall,
  buildCaseIntakeMetadata,
} from "./lib/visionIntake.js";
import { followUpReuseFromClientBrief } from "./lib/followUpReuse.js";
import { commitReusedResult, findReusableResult, isTextOnlyIntake } from "./lib/claimReuse.js";
import { runInvestigation, type InvestigationRunDeps } from "./http/investigationRun.js";
import { createSseWriter } from "./http/sseChannel.js";
import { toPublicStreamEvent } from "./http/publicStream.js";

/**
 * 调查总时限的默认值；可通过 ORCHESTRATE_TOTAL_TIMEOUT_MS 覆盖。
 */
const PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT = 420_000;

/**
 * 总超时之后还给仍在跑的管线多少时间自己收尾（同一个契约）。
 * 宽限期内跑完 → run 落 complete，结论经刷新恢复通道取回；宽限期到仍不回来 → 按中断收尾。
 * 有界，是为了不让一条僵尸管线永远占着后台；运维可用 ORCHESTRATE_LATE_GRACE_MS 覆盖。
 */
const PIPELINE_LATE_GRACE_MS_DEFAULT = 120_000;

// 与 express.json 上限一致：兜底路径同样要有界，防止无上限累积打爆内存
const READ_JSON_MAX_BYTES = 10 * 1024 * 1024;

function readJson(req: any) {
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > READ_JSON_MAX_BYTES) {
        overflowed = true;
        return; // 不再累积，等 end 直接拒绝
      }
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (overflowed) {
        reject(new Error("payload too large"));
        return;
      }
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function createHandlers(env: Record<string, string>) {
  const runStore = openRunStore();
  if (!runStore) throw new Error("Investigation storage unavailable; refusing non-durable startup");
  const runs = createRunService({ store: runStore });
  const releaseRuntime = runStore.claimRuntime();
  try { runs.markInterruptedOnBoot(); }
  catch (error) { releaseRuntime(); throw error; }
  const protocolVersion = 2;
  const investigationDeps: InvestigationRunDeps = {
    env, runs, runStore,
    totalTimeoutMs: Number(env.ORCHESTRATE_TOTAL_TIMEOUT_MS || PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT),
    lateGraceMs: Number(env.ORCHESTRATE_LATE_GRACE_MS || PIPELINE_LATE_GRACE_MS_DEFAULT),
  };

  function ownerOf(req: any): string | null {
    const guestId = guestIdFromRequest(req);
    return guestId ? guestOwnerHash(guestId) : null;
  }

  function ownedRun(req: any, res: any): RunRecord | null {
    const runId = String(req.params?.runId ?? "").trim();
    const run = runId ? runs.get(runId) : null;
    if (!run) { sendJson(res, 404, { message: "没有这次调查" }); return null; }
    if (!run.ownerHash || run.ownerHash !== ownerOf(req)) {
      sendJson(res, 403, { message: "只有发起调查的浏览器能访问它" });
      return null;
    }
    return run;
  }

  function runMeta(run: RunRecord) {
    return {
      protocolVersion, runId: run.runId, caseId: run.caseId,
      conversationId: run.conversationId, parentRunId: run.parentRunId, kind: run.kind,
      status: run.status, revision: run.revision, lastSeq: run.lastSeq,
      lastEventSeq: run.lastEventSeq, resultId: run.resultId,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
      statusUrl: `/api/investigations/${run.runId}`,
      eventsUrl: `/api/investigations/${run.runId}/events`,
      resultUrl: `/api/investigations/${run.runId}/result`,
      eventCursor: "afterEvent", eventId: "eventSeq",
    };
  }

  // Express 4 does not forward rejected async handlers automatically.
  const guarded = (handler: (req: any, res: any, next: any) => Promise<unknown>) =>
    async (req: any, res: any, next: any) => {
      try { return await handler(req, res, next); }
      catch (error) {
        if (req.checkTicket) releaseFreeCheck(req.checkTicket);
        console.error("[investigations] request failed", error);
        if (!res.headersSent) return sendJson(res, 503, { error: "investigation_unavailable", message: "调查服务暂时不可用，请稍后重试" });
        return next(error);
      }
    };

  const healthHandler = guarded(async (_req, res) => {
    // Query the same run-store connection used by requests; startup success is not a live probe.
    runStore.get("__health_probe__");
    return sendJson(res, 200, { status: "ok", storage: "sqlite", protocolVersion, timestamp: Date.now() });
  });

  const cancelInvestigationHandler = guarded(async (req, res, next) => {
    if (req.method !== "POST") return next();
    const run = ownedRun(req, res);
    if (!run) return;
    const result = runs.cancel(run.runId);
    if (result.kind === "not-found") return sendJson(res, 404, { message: "没有这次调查" });
    return sendJson(res, 200, { runId: run.runId, status: result.run.status, accepted: result.kind === "cancelling" });
  });

  const getInvestigationHandler = guarded(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const run = ownedRun(req, res);
    if (!run) return;
    return sendJson(res, 200, toPublicStreamEvent({
      ...runMeta(run), snapshot: run.snapshot, activities: runs.replayActivities(run.runId, 0),
    }));
  });

  const listInvestigationsHandler = guarded(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const ownerHash = ownerOf(req);
    if (!ownerHash) return sendJson(res, 403, { message: "需要原浏览器的访客身份才能读取历史" });
    return sendJson(res, 200, { protocolVersion, investigations: runs.listByOwner(ownerHash).map(run => ({
      ...runMeta(run), claim: run.snapshot?.originalClaim ?? runs.getInput(run.runId)?.claim ?? "",
    })) });
  });

  const investigationResultHandler = guarded(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const run = ownedRun(req, res);
    if (!run) return;
    const raw = new URL(req.url ?? "/", "http://localhost").searchParams.get("revision");
    const revision = raw === null ? undefined : Number(raw);
    if (revision !== undefined && (!/^\d+$/.test(raw!) || !Number.isSafeInteger(revision) || revision < 1)) {
      return sendJson(res, 400, { message: "revision 必须是正整数" });
    }
    const result = runs.getResult(run.runId, revision);
    if (result) return sendJson(res, 200, toPublicStreamEvent({ protocolVersion, ...result }));
    if (revision !== undefined || isTerminalStatus(run.status)) {
      return sendJson(res, 404, { ...runMeta(run), error: "result_unavailable", message: "没有这个已发布的结果版本" });
    }
    res.setHeader("Retry-After", "2");
    return sendJson(res, 202, { ...runMeta(run), pending: true });
  });

  const investigationMaterialHandler = guarded(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const run = ownedRun(req, res);
    if (!run) return;
    const materialId = String(req.params?.materialId ?? "");
    const material = createRunRecorder(run.runId).getMaterial(materialId);
    if (!material) return sendJson(res, 404, { message: "没有这份调查材料" });
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, 200, { ...material, quoteOffsetEncoding: "utf-16" });
  });

  const deleteInvestigationHandler = guarded(async (req, res, next) => {
    if (req.method !== "DELETE") return next();
    const run = ownedRun(req, res);
    if (!run) return;
    if (!isTerminalStatus(run.status)) return sendJson(res, 409, { message: "调查仍在进行，请先停止，结束后再删除" });
    const deleted = runs.deleteOwned(run.runId, run.ownerHash!);
    if (!deleted) return sendJson(res, 409, { message: "这次调查暂时不能删除" });
    return sendJson(res, 200, { runId: run.runId, deleted: true });
  });

  async function streamEvents(req: any, res: any, run: RunRecord, legacyAfter?: number) {
    const query = new URL(req.url ?? "/", "http://localhost").searchParams;
    const eventCursor = query.get("afterEvent") ?? req.headers?.["last-event-id"];
    const oldCursor = query.get("after");
    const legacy = legacyAfter !== undefined || (eventCursor === undefined && oldCursor !== null);
    const raw = legacyAfter ?? (legacy ? oldCursor : eventCursor ?? 0);
    const after = Number(raw);
    if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(after) || after < 0) {
      return sendJson(res, 400, { message: "事件游标必须是非负整数" });
    }
    if (!legacy && after > run.lastEventSeq) return sendJson(res, 400, { message: "事件游标超过这次调查的最后事件" });
    // Bound each SQLite read; live arrivals during replay stay in the journal, not another queue.
    let cursor = legacy ? run.lastEventSeq : after;
    let replayThrough = run.lastEventSeq;
    const firstPage = legacy ? [] : runs.replayEvents(run.runId, after, 128);
    const activities = legacy ? runs.replayActivities(run.runId, after) : [];
    const writer = createSseWriter(res);
    let replaying = true;
    const unsubscribe = runs.subscribe(run.runId, event => {
      const seq = Number(event.eventSeq);
      if (replaying) {
        if (Number.isSafeInteger(seq)) replayThrough = Math.max(replayThrough, seq);
        return;
      }
      if (!Number.isSafeInteger(seq) || seq <= cursor) return;
      cursor = seq;
      void writer.send(toPublicStreamEvent(event));
      if (event.type === "run_state" && event.terminal === true) writer.finish();
    });
    writer.onClose(unsubscribe);
    const send = (event: Record<string, unknown>) => writer.send(toPublicStreamEvent(event));
    try {
      if (legacy) {
        await send({ type: "run_started", ...runMeta(run), startedAt: run.createdAt, timestamp: Date.now() });
        for (const activity of activities) {
          if (writer.closed) break;
          await send({ type: "investigation_activity", activity, timestamp: Date.now() });
        }
        if (!writer.closed && run.snapshot) await send({ type: "investigation_snapshot", investigation: run.snapshot, timestamp: Date.now() });
        if (!writer.closed) await send({ type: "run_state", status: run.status, terminal: isTerminalStatus(run.status), timestamp: Date.now() });
      }
      let page = firstPage;
      while (!writer.closed && cursor < replayThrough) {
        if (!page.length) page = runs.replayEvents(run.runId, cursor, 128);
        if (!page.length) throw new Error("Durable event cursor has a gap");
        for (const event of page) {
          if (writer.closed) break;
          if (event.eventSeq <= cursor) continue;
          if (!await send(event)) break;
          cursor = event.eventSeq;
        }
        page = [];
      }
      // No await between the catch-up check and live mode: no event can fall between them.
      replaying = false;
      if (!writer.closed && isTerminalStatus(runs.get(run.runId)?.status ?? run.status)) writer.finish();
    } catch (error) {
      writer.close();
      throw error;
    }
  }

  const investigationEventsHandler = guarded(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const run = ownedRun(req, res);
    if (run) return streamEvents(req, res, run);
  });

  // Serialize only admission for the same request key, never the investigation itself.
  // Concurrent retries must see the persisted run before checking an already-reserved quota.
  const admissions = new Map<string, Promise<void>>();
  async function lockAdmission(key: string): Promise<() => void> {
    const previous = admissions.get(key);
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    admissions.set(key, current);
    if (previous) await previous;
    return () => { release(); if (admissions.get(key) === current) admissions.delete(key); };
  }

  async function startInvestigation(req: any, res: any, next: any, background: boolean) {
    if (req.method !== "POST") return next();
    let payload: any;
    try { payload = await readJson(req); }
    catch { return sendJson(res, 400, { message: "无法解析请求 JSON" }); }
    if (!payload || Array.isArray(payload) || typeof payload.claim !== "string" || !payload.claim.trim()) {
      return sendJson(res, 400, { message: "缺少 claim 参数" });
    }
    const claim = payload.claim.trim();
    const bodyKey = typeof payload.clientRequestId === "string" ? payload.clientRequestId.trim() : "";
    const headerKey = typeof req.headers?.["idempotency-key"] === "string" ? req.headers["idempotency-key"].trim() : "";
    if ((bodyKey && headerKey && bodyKey !== headerKey) || (bodyKey || headerKey).length > 120) {
      return sendJson(res, 400, { message: "请求编号不一致或超过 120 个字符" });
    }
    const clientRequestId = bodyKey || headerKey || (background ? "" : randomUUID());
    if (!clientRequestId) return sendJson(res, 400, { message: "需要 clientRequestId 或 Idempotency-Key 才能安全重试" });
    const kind = payload.kind ?? (payload.followUp === true ? "follow-up" : "initial");
    if (!["initial", "follow-up", "recheck"].includes(kind)) return sendJson(res, 400, { message: "调查 kind 无效" });
    for (const key of ["conversationId", "parentRunId", "caseId"]) {
      if (payload[key] !== undefined && (typeof payload[key] !== "string" || !payload[key].trim() || payload[key].length > 120)) {
        return sendJson(res, 400, { message: `${key} 必须是有效编号` });
      }
    }
    const intake = normalizeCaseIntake(payload.intake);
    const intakeMetadata = buildCaseIntakeMetadata(intake);
    const clientMemoryRecall = normalizeClientMemoryRecall(payload.memoryRecall);
    const clientFollowUpReuse = kind === "follow-up" ? followUpReuseFromClientBrief(payload.priorRound) : null;
    const guestId = ensureGuestId(req, res);
    const ownerHash = guestOwnerHash(guestId);
    const parentRunId = payload.parentRunId?.trim() || undefined;
    const conversationId = payload.conversationId?.trim() || undefined;
    const inputHash = hashRunInput(claim, {
      intake, memoryRecall: clientMemoryRecall, kind, priorRound: payload.priorRound ?? null,
      parentRunId: parentRunId ?? null, conversationId: conversationId ?? null, caseId: payload.caseId ?? null,
    });
    const unlock = await lockAdmission(`${ownerHash}:${clientRequestId}`);
    let started: ReturnType<typeof runs.start>;
    let ticket: NonNullable<typeof req.checkTicket>;
    try {
      const existing = runs.findExisting(ownerHash, clientRequestId);
      if (existing) {
        if (existing.inputHash !== inputHash) return sendJson(res, 409, { message: "同一个请求编号对应了不同的材料", runId: existing.runId });
        return background ? sendJson(res, 202, { ...runMeta(existing), reused: true }) : streamEvents(req, res, existing, 0);
      }
      if (parentRunId) {
        const parent = runs.get(parentRunId);
        if (!parent || parent.ownerHash !== ownerHash) return sendJson(res, 403, { message: "不能关联其他浏览器的调查" });
        if (conversationId && parent.conversationId !== conversationId) return sendJson(res, 409, { message: "父调查不属于这个会话" });
      }
      let allowed = false;
      await freeCheckGate(req, res, (error?: unknown) => { if (error) throw error; allowed = true; });
      if (!allowed || !req.checkTicket) return;
      ticket = req.checkTicket;
      started = runs.start({
        caseId: kind === "follow-up" ? generateCaseId(claim) : payload.caseId || generateCaseId(claim),
        ownerHash, clientRequestId, inputHash, conversationId, parentRunId, kind,
        input: { claim: payload.claim, intake: payload.intake ?? null, memoryRecall: payload.memoryRecall ?? null, priorRound: payload.priorRound ?? null },
      });
      if (started.kind !== "created") {
        releaseFreeCheck(ticket);
        if (started.kind === "conflict") return sendJson(res, 409, { message: "同一个请求编号对应了不同的材料", runId: started.existing.runId });
        return background ? sendJson(res, 202, { ...runMeta(started.run), reused: true }) : streamEvents(req, res, started.run, 0);
      }
    } finally { unlock(); }
    const createdRun = started.run;
    if (kind === "initial" && isTextOnlyIntake(intake)) {
      let reusedResult = false;
      try {
        const reusable = findReusableResult(runs, claim);
        if (reusable) {
          commitReusedResult(runs, { runId: createdRun.runId, claim }, reusable);
          reusedResult = true;
        }
      } catch (error) {
        console.error(`[investigations] reusing an earlier result failed, checking afresh runId=${createdRun.runId}`, error);
      }
      if (reusedResult) {
        releaseFreeCheck(ticket);
        delete req.checkTicket;
        const finished = runs.get(createdRun.runId) ?? createdRun;
        return background ? sendJson(res, 202, { ...runMeta(finished), reused: false }) : streamEvents(req, res, finished);
      }
    }
    const request = {
      claim, ticket, intake, intakeMetadata, clientMemoryRecall, clientFollowUpReuse,
      run: { runId: createdRun.runId, caseId: createdRun.caseId, createdAt: createdRun.createdAt },
    };
    if (!background) return runInvestigation(investigationDeps, request, res);
    setImmediate(() => {
      void runInvestigation(investigationDeps, request).catch(error => {
        console.error(`[investigations] background execution failed runId=${createdRun.runId}`, error);
        releaseFreeCheck(ticket);
        try { runs.finish(createdRun.runId, "interrupted"); }
        catch (storageError) { console.error("[investigations] failed to persist execution failure", storageError); }
      });
    });
    // Execution owns the ticket once scheduled, even if writing the acceptance response fails.
    delete req.checkTicket;
    sendJson(res, 202, { ...runMeta(createdRun), reused: false });
  }

  return {
    ...createShareHandlers({ getRun: runId => runs.get(runId), getResult: runId => runs.getResult(runId) }),
    orchestrateStreamHandler: guarded((req, res, next) => startInvestigation(req, res, next, false)),
    createInvestigationHandler: guarded((req, res, next) => startInvestigation(req, res, next, true)),
    healthHandler, cancelInvestigationHandler, getInvestigationHandler, investigationEventsHandler,
    listInvestigationsHandler, investigationResultHandler, investigationMaterialHandler, deleteInvestigationHandler,
  };
}
