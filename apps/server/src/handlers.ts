/**
 * handlers.ts — Express HTTP adapter + Case Pipeline / Agent Loop 编排接线。
 *
 * 只做三件事：路由分发、SSE 流式输出、调 runCasePipeline（ADR-003 生产路径）。
 * 搜索矩阵 → lib/searchProviders.js；
 * 视觉摄入 → lib/visionIntake.js；兜底报告 → lib/reportFallback.js；
 * 公式评分 → lib/formulaScore.js；HTTP 工具 → lib/httpUtils.js。
 * 产品规则不写在 HTTP 层；域深度在 mvp/server/src/lib/。
 */

import { randomUUID } from "node:crypto";

import { type AtomSearchBundle } from "./lib/atomSearch.js";

import { runCasePipeline, type CasePipelineHooks, type PipelineStep, type RunAgentFn } from "./lib/casePipeline/index.js";

import {
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "./lib/investigation/index.js";
import { createInvestigationEmitter } from "./lib/investigationEmitter.js";
import { createRunService, hashRunInput } from "./lib/runService.js";
import { readEmailAccountOptional } from "./lib/emailSession.js";
import { isTerminalStatus, openRunStore } from "./lib/runStore.js";
import { getCase, generateCaseId, type CaseEntry } from "./lib/caseStore.js";
import {
  appendFollowUpObservation,
  buildFollowUpObservation,
  type FollowUpObservationStats,
} from "./lib/followupObservation.js";

import { makeRewriteQueryCall } from "./lib/evidenceLoop/index.js";

import { createKnowledgeMemory } from "./lib/knowledgeStore.js";

import { getMemoryCandidateStore } from "./lib/memoryCandidateHandlers.js";

import type { MemoryCandidateHit } from "./lib/memoryCandidateTypes.js";

import { listAvailableModels, validateModelChoice } from "./lib/availableModels.js";

import { MODEL_UNKNOWN_MESSAGE, probeModelServiceHealth } from "./lib/modelServiceHealth.js";

import { lookupImageOrigin, visionHintsFromExtraction } from "./lib/imageOrigin/index.js";

import { commitFreeCheck, releaseFreeCheck } from "./lib/checkQuota.js";

import { applyFactDeskPostProcessToReport } from "./lib/factDeskPostProcess.js";

import { readJson, sendJson, wait, getTimeoutMs, withTimeout } from "./lib/httpUtils.js";
import { withExecutionBudget, type ExecutionBudget } from "./lib/executionBudget.js";

import { asRecord } from "./lib/valueCoerce.js";

import { isBlockedTestLlmUrl } from "./lib/ssrfGuard.js";

import { applyFormulaScoreToReport, computeFormulaScore } from "./lib/formulaScore.js";

import {
  callStepFunVisionForIntake,
  composeClaimWithVision,
  normalizeCaseIntake,
  normalizeClientMemoryRecall,
  buildCaseIntakeMetadata,
  type CaseIntakeImagePayload,
  type CaseIntakePayload,
} from "./lib/visionIntake.js";

import {
  build360SearchFailure,
  callParallelSearchProviders,
  getSearchToolName,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "./lib/searchProviders.js";

import {
  runReportComposerWithFallback,
  buildConsensusDebate,
  buildDeterministicFinalReport,
} from "./lib/reportFallback.js";

import { makeSearch360ReverseImage } from "./lib/reverseImage/search360ReverseImage.js";

import { applyContextCrossCheckToReport } from "./lib/contextCrossCheck.js";

import { createOrchestrateAdapter } from "./lib/orchestrate.js";

import { followUpReuseFromClientBrief } from "./lib/followUpReuse.js";
import { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot.js";
import {
  baseUrlTargetsPrivateNetwork,
  ByoKeyError,
  isLocalHttpUrl,
  isPrivateAddressText,
  parseByoConfig,
  searchEnvWithByoCredentials,
} from "./lib/orchestrateByo.js";

export { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot.js";

/**
 * 追问关联失败只说这一句：不区分「案件不存在」与「不是你的案件」，
 * 否则拿别人的 caseId 试一次就能问出它存不存在。三种失败共用同一文案。
 */
export const FOLLOW_UP_CASE_MISSING_MESSAGE = "追问关联的案件不存在或无权访问";

// ───────────────────────────────────────────────────────────────
// 公开 SSE 只发用户可读文案。原始 provider 诊断留在服务端 logger，
// 不再随 detail / providerErrors 下发到浏览器，避免 UI 或网络面板泄漏运维信息。
// ───────────────────────────────────────────────────────────────
export interface FriendlyErrorInfo {
  /** 用户可读友好文案（不包含原始诊断） */
  message: string;
  /** 原始诊断串（可选；仅当原始串与友好文案不同才携带） */
  detail?: string;
  /** provider 级错误明细（可选） */
  providerErrors?: string[];
}

export function toFriendlyError(error: unknown, fallback: string): FriendlyErrorInfo {
  void error;
  return { message: fallback };
}

// provider 名不得出现在公开流（产品规则：用户不看见模型 ID）。
// model 字段与「provider:model」形状的字符串值（_scoreSource 等）一并清空，
// latencyMs 整个删除；普通正文不匹配模型引用形状，不受影响。服务端 logger 保留全量诊断。
const PROVIDER_NAME_RE = /minimax|stepfun|deepseek|360gpt|ai360|mimo|anthropic|openai|moonshot|kimi/i;

const MODEL_REF_RE = /^[a-z0-9_-]+:[A-Za-z0-9._-]+$/;

function scrubProviderDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => scrubProviderDiagnostics(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // systemPrompt / userContent 是内部工程文本（含 provider 名与规则清单），
      // 前端过程层不读取，剥离后顺带大幅减小公开载荷。
      if (key === "latencyMs" || key === "systemPrompt" || key === "userContent") continue;
      if (
        typeof item === "string" &&
        PROVIDER_NAME_RE.test(item) &&
        (key === "model" || MODEL_REF_RE.test(item))
      ) {
        continue;
      }
      out[key] = scrubProviderDiagnostics(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function toPublicStreamEvent(data: object): Record<string, unknown> {
  const event = scrubProviderDiagnostics(data) as Record<string, unknown>;
  delete event.detail;
  delete event.providerErrors;
  // code=byo_key_failed 的错误文案是服务端手写的固定中文（不含密钥与诊断），
  // 必须原样到达用户——BYO 密钥失败是用户自己能修复的问题，吞成通用文案就失去 fail-closed 的意义。
  if (
    event.type === "error" &&
    event.code !== "checks_exhausted" &&
    event.code !== "byo_key_failed"
  ) {
    event.message = "这次核查没能完成，请稍后重试";
    delete event.error;
  } else if (event.type === "agent_error" || event.type === "tool_error") {
    event.error = "这一步没能完成，核查会按现有材料继续";
    delete event.message;
  }
  return event;
}


// Express handlers extracted from vite.config.ts
// All LLM provider calls and agent orchestration logic

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

function makeReportRunner(runAgent: RunAgentFn) {
  return async ({
    claim,
    steps,
    search360Result,
    atomSearchBundle,
    onFallback,
    signal,
    deadlineMs,
  }: {
    claim: string;
    steps: PipelineStep[];
    search360Result: unknown;
    atomSearchBundle: AtomSearchBundle;
    onFallback?: (step: PipelineStep) => void;
    signal?: AbortSignal;
    deadlineMs?: number;
  }) =>
    runReportComposerWithFallback({
      claim,
      steps,
      search360Result,
      runAgent: (agentId, s, search, execution) => runAgent(agentId, s as PipelineStep[], search, atomSearchBundle, execution),
      onFallback,
      signal,
      deadlineMs,
    });
}

/**
 * BYO fail-closed 报告工厂：包装 makeReportRunner，密钥失败时抛出阻断收尾，不静默回退 env 密钥。
 */
function makeRunReport(
  runAgent: RunAgentFn,
  byo: { modelName?: string } | undefined,
  byoFail: AbortController,
  sendEvent: (data: object) => void
): Parameters<typeof runCasePipeline>[0]["runReport"] {
  return async (args) => {
    const reportStep = await makeReportRunner(runAgent)({
      ...args,
      onFallback: (step) => {
        sendEvent({
          type: "agent_complete",
          agent: step.agent,
          agentName: step.agentName,
          agentIcon: step.agentIcon,
          output: step.output,
          model: step.model,
          latencyMs: step.latencyMs,
          timestamp: Date.now(),
        });
      },
    });
    // BYO fail-closed：密钥失败引发的报告兜底不算完成，抛出触发错误收尾，
    // 绝不把确定性兜底报告冒充成功结果，也绝不回退 env 密钥重烧一遍。
    if (byo && byoFail.signal.aborted) {
      throw byoFail.signal.reason instanceof Error
        ? byoFail.signal.reason
        : new ByoKeyError("你保存的模型密钥调用失败，这次核查已停止。");
    }
    return reportStep;
  };
}

/**
 * Agent 事件回调工厂：把 agent_start / agent_thought / agent_complete / agent_error 四帧
 * 的 sendEvent 调用聚在一起，入口主体只传给 byoAdapter.makeRunAgent。
 */
function makeRunAgentCallbacks(sendEvent: (data: object) => void) {
  return {
    onStart: (agentId: string, agentConfig: { name: string; icon?: string; model?: string }) => {
      sendEvent({
        type: "agent_start",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        model: agentConfig.model || "",
        timestamp: Date.now(),
      });
    },
    onThought: (agentId: string, agentConfig: { name: string; icon?: string }, content: string, seq: number, done: boolean) => {
      sendEvent({
        type: "agent_thought",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        content,
        seq,
        done,
        timestamp: Date.now(),
      });
    },
    onComplete: (step: { agent: string; agentName: string; agentIcon?: string; output: unknown; model: string; latencyMs: number }) => {
      sendEvent({
        type: "agent_complete",
        agent: step.agent,
        agentName: step.agentName,
        agentIcon: step.agentIcon,
        output: step.output,
        model: step.model,
        latencyMs: step.latencyMs,
        timestamp: Date.now(),
      });
    },
    onError: (agentId: string, agentConfig: { name: string; icon?: string }, error: unknown) => {
      const { message } = toFriendlyError(error, "核查服务暂时不可用，请稍后重试");
      sendEvent({
        type: "agent_error",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        error: message,
        timestamp: Date.now(),
      });
    },
  };
}

/**
 * 管线观测钩子工厂：把 SSE 帧发送、活动账本、检索计数封装成 CasePipelineHooks。
 * 闭包变量显式传入，入口主体只写 hooks: makePipelineHooks(…)。
 * 事件名与载荷字节级不变——这里只改形状，不改语义。
 */
function makePipelineHooks(ctx: {
  claim: string;
  sendEvent: (data: object) => void;
  emitInvestigation: (snapshot: InvestigationSnapshotV1) => void;
  emitter: ReturnType<typeof createInvestigationEmitter>;
  searchesCounter: { current: number };
}): CasePipelineHooks {
  const { claim, sendEvent, emitInvestigation, emitter, searchesCounter } = ctx;
  return {
    searchMode: "sequential",
    onInvestigationSnapshot: (snapshot) => {
      emitInvestigation(snapshot);
    },
    onSelfProof: (info) => {
      console.log(
        `[agent_self_proof] claim=${JSON.stringify(claim).slice(0, 120)} kept=${info.kept.length} dropped=${info.dropped.length}`
      );
    },
    onAtomSearchStart: (atom) => {
      searchesCounter.current += 1;
      sendEvent({ type: "tool_start", toolName: "Atom Search", query: atom, timestamp: Date.now() });
      emitter.emitSearchStarted(atom);
    },
    // 命中知识库 → 活动流一行「命中知识库（YYYY-MM-DD 已核），免于本次检索」。
    // 动作类活动：引用数组为空（该命题这次没有检索，也就没有可取的对象）；
    // 日期走 payload.originDate，读侧不从文案里猜时间。
    onKnowledgeHit: (hit) => {
      emitter.emitKnowledgeHit(hit.originDate);
    },
    onPriorRoundReuse: (hit) => {
      emitter.emitPriorRoundReuse(hit.originDate);
    },
    onAtomSearchResult: (atom, result) => {
      const searchToolName = getSearchToolName(result as any);
      if ((result as any)?._source === "tool-error") {
        sendEvent({
          type: "tool_error",
          toolName: searchToolName,
          query: atom,
          error: (result as any).traceText,
          result,
          timestamp: Date.now(),
        });
      } else {
        sendEvent({
          type: "tool_result",
          toolName: searchToolName,
          query: atom,
          model: (result as any)?.model,
          result,
          timestamp: Date.now(),
        });
      }
    },
    onEvidenceLoopRoundStart: (info) => {
      searchesCounter.current += 1;
      sendEvent({
        type: "tool_start",
        toolName: "证据追索",
        query: info.query,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          round: info.round,
          goal: info.goal,
          purpose: info.purpose,
          missingEvidence: info.missingEvidence,
          trigger: info.trigger,
        },
        timestamp: Date.now(),
      });
    },
    onEvidenceLoopRoundResult: (info) => {
      sendEvent({
        type: "tool_result",
        toolName: "证据追索",
        query: info.query,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          round: info.round,
          sourceCount: info.sourceCount,
          newSourceCount: info.newSourceCount,
          goal: info.goal,
          purpose: info.purpose,
          resultKind: info.resultKind,
          gain: info.gain,
          missingAfter: info.missingAfter,
          action: info.action,
          detail: info.detail,
        },
        timestamp: Date.now(),
      });
    },
    onEvidenceLoopStopped: (info) => {
      const reasonText: Record<string, string> = {
        "evidence-found": "缺口收窄，转入重判",
        "no-new-evidence": "继续搜也没有新证据，判停",
        "rewrite-empty": "没有可用的新查询，判停",
        "search-failed": "补查检索失败，判停",
      };
      sendEvent({
        type: "tool_result",
        toolName: "证据追索",
        query: info.atom,
        result: {
          kind: "evidence_pursuit",
          atom: info.atom,
          rounds: info.rounds,
          reason: info.reason,
          reasonText: reasonText[info.reason] ?? info.reason,
        },
        timestamp: Date.now(),
      });
    },
    afterFactSource: async ({ factStep, sourceStep, search360Result }) => {
      const debate = buildConsensusDebate(factStep, sourceStep, search360Result);
      if (debate.status !== "not_needed") {
        sendEvent({
          type: "consensus_debate_round",
          phase: "handoff",
          debate: { ...debate, status: "running", rounds: [], finalConsensus: "事实核查与溯源还在对证据，先不写结论。" },
          timestamp: Date.now(),
        });
        await wait(220);
        for (let index = 0; index < debate.rounds.length; index += 1) {
          sendEvent({
            type: "consensus_debate_round",
            phase: "handoff",
            debate: {
              ...debate,
              status: "running",
              rounds: debate.rounds.slice(0, index + 1),
              finalConsensus: "正在根据两边的证据收紧：哪些能信，哪些不能信。",
            },
            timestamp: Date.now(),
          });
          await wait(220);
        }
      }
      sendEvent({ type: "consensus_debate_final", phase: "handoff", debate, timestamp: Date.now() });
    },
    onReportReviewStart: (info) => {
      sendEvent({ type: "tool_start", toolName: info.toolName, query: info.query, timestamp: Date.now() });
    },
    onReportReviewResult: (info) => {
      sendEvent({
        type: "tool_result",
        toolName: info.toolName,
        query: info.query,
        result: { passed: info.passed, score: info.score, issues: info.issues, checks: info.checks },
        timestamp: Date.now(),
      });
    },
    onMemoryWriteStart: (info) => {
      sendEvent({ type: "tool_start", toolName: info.toolName, query: info.query, timestamp: Date.now() });
    },
    onMemoryWriteResult: (info) => {
      sendEvent({
        type: "tool_result",
        toolName: info.toolName,
        query: info.query,
        result: { proposedCandidateCount: info.proposedCandidateCount },
        timestamp: Date.now(),
      });
    },
  };
}

export function createHandlers(env: Record<string, string>) {
  const apiKey = env.OPENAI_API_KEY;
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

  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const codexBin = env.CODEX_BIN || process.env.CODEX_BIN || "/usr/local/bin/codex";
  const codexModel = env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5";

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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: object) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
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
        res.write(": keepalive\n\n");
      } catch {
        /* ignored */
      }
    }, 15_000);
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

  // ───────────────────────────────────────────────────────────────
  function makeImageOriginLookup(
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
    onSearchProgress?: (event: SearchProgressEvent) => void,
    searchEnvOverride: Record<string, string> = env,
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
    applyFormulaScoreToReport(
      ctx.finalReport,
      computeFormulaScore(
        ctx.rumorStep.output,
        ctx.factStep.output,
        ctx.sourceStep.output,
        ctx.search360Result
      )
    );
    applyFactDeskPostProcessToReport(ctx.finalReport, ctx.claim);
    applyContextCrossCheckToReport(ctx.finalReport, { claim: ctx.claim, visualExtraction });
  }

  const PIPELINE_TOTAL_TIMEOUT_MS = Number(env.ORCHESTRATE_TOTAL_TIMEOUT_MS || PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT);
  /** 超时后给管线自己收尾的宽限（Change C）；ORCHESTRATE_LATE_GRACE_MS 可覆盖，默认 120s。 */
  const PIPELINE_LATE_GRACE_MS = Number(env.ORCHESTRATE_LATE_GRACE_MS || PIPELINE_LATE_GRACE_MS_DEFAULT);

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

  async function orchestrateStreamHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    let claim = payload.claim;
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
    let visualExtraction: Record<string, unknown> | undefined;

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
    const runId = started.run.runId;
    if (isFollowUp && priorCaseId) runStore?.markFollowUp(runId, priorCaseId);
    const runSignal = runs.signalFor(runId);
    const workDeadlineMs = Date.now() + Math.max(1, PIPELINE_TOTAL_TIMEOUT_MS - 10_000);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // 不依赖反代配置：任何 nginx（含未关 proxy_buffering 的旧配置）见此头即不缓冲本响应
      "X-Accel-Buffering": "no",
    });

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
        res.write(`data: ${JSON.stringify(toPublicStreamEvent(data))}\n\n`);
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
    sendEvent({ type: "run_started", runId, caseId: started.run.caseId, timestamp: Date.now() });

    // 心跳：report_composer 等阶段可静默 ~50s，SSE 注释帧让中间代理与浏览器
    // 知道流还活着（客户端解析器只认 "data: " 行，注释天然被忽略）。
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(": keepalive\n\n");
      } catch {
        // 响应已断开：由主流程的 EPIPE/写失败路径统一收尾
      }
    }, 15_000);

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
        lookupImageOrigin: makeImageOriginLookup(intake, visualExtraction, { signal, deadlineMs: workDeadlineMs }),
        callSelfProofModel: byoAdapter.makeSelfProofCaller(claim, modelChoice),
        evidenceLoop: { callRewriteModel: makeRewriteQueryCall(byoAdapter.makeRewriteCaller(modelChoice)) },
        crossExam: { callRaw: byoAdapter.makeCrossExamCaller(modelChoice, (data) => sendEvent(data)) },
        wholeClaimAudit: { callModel: byoAdapter.makeWholeClaimAuditCaller(modelChoice) },
        knowledgeBase,
        followUpReuse: priorCase
          ? {
              priorReport: priorCase.report,
              priorClaim: priorCase.claim,
              priorCreatedAt: priorCase.createdAt,
            }
          : clientFollowUpReuse ?? undefined,
        runReport: makeRunReport(runAgent, byo, byoFail, sendEvent),
        hooks: makePipelineHooks({ claim, sendEvent, emitInvestigation, emitter, searchesCounter }),
        finalizeReport: (fctx: Parameters<typeof pipelineFinalize>[0]) =>
          pipelineFinalize(fctx, visualExtraction),
        memoryCandidateStore: getMemoryCandidateStore(),
      }), { signal: pipelineSignal, timeoutMs: PIPELINE_TOTAL_TIMEOUT_MS + PIPELINE_LATE_GRACE_MS, label: "整体核查" });
      // withTimeout 是 race：落败方的 rejection 必须被吸收，
      // 否则断连/超时触发的 abort 会变成 unhandledRejection 直接崩进程
      pipelinePromise.catch(() => {});
      const result = await (async () => {
        try {
          return await withTimeout(pipelinePromise, PIPELINE_TOTAL_TIMEOUT_MS, "整体核查");
        } catch (error) {
          // 契约 Change C：超时不再一锤定音。超时只说明「这条连接的等待到头了」，不是管线失败：
          //  1) 先告诉客户端「还在查」，用户留在页面上就继续跟着看；
          //  2) 从此这条连接不再是管线的生命线（detachedFromClient），用户离开页面也不再 abort 它；
          //  3) 再等管线自己收尾：晚完成 → 落 complete，快照与结论经刷新恢复通道取回；
          //  4) 宽限期到还没回来 → 抛出，走下面既有的「超时中断」收尾（现有文案与重查入口）。
          if (!(error instanceof Error && error.message.includes("整体核查"))) throw error;
          detachedFromClient = true;
          sendEvent({ type: "timeout_pending", timestamp: Date.now() });
          console.log(
            `[orchestrate] 总时限 ${PIPELINE_TOTAL_TIMEOUT_MS}ms 到，管线继续收尾（宽限 ${PIPELINE_LATE_GRACE_MS}ms）runId=${runId}`
          );
          return await withTimeout(pipelinePromise, PIPELINE_LATE_GRACE_MS, "整体核查");
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
      finishRun("completed");
      // 追问观测：报告已 finalize、响应还没结束——写一行计数与判词标签就完事。
      // 只在追问轮写；写不进去也不改这次 run 的结局（recordFollowUpObservation 内部兜住）。
      if (isFollowUp && priorCaseId) {
        recordFollowUpObservation({
          runId,
          caseId: started.run.caseId,
          priorCaseId,
          report: result.finalReport,
          snapshot: lastInvestigation,
          atomsSearched: result.atomSearchBundle.atomsSearched.length,
          searchesTotal: searchesCounter.current,
        });
      }
      commitFreeCheck(res, ticket);
      endResponse();
    } catch (error) {
      if (runSignal?.aborted) {
        releaseFreeCheck(ticket);
        emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, claim));
        finishRun("cancelled");
        endResponse();
        return;
      }
      // BYO key fail-closed（Evaluator 3）必须在最前：密钥失败时管线已被 byoFail 中止，
      // 不需要再走断连 abort；先发中断帧与密钥错误帧，再收尾，绝不静默回退 env 密钥重烧。
      if (byo && byoFail.signal.aborted) {
        releaseFreeCheck(ticket);
        console.error(
          `[byo-key] investigation ended fail-closed label=${byo.modelName} detail=${
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
        finishRun(runSignal?.aborted ? "cancelled" : "interrupted");
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
      if (error instanceof Error && error.message.includes("整体核查")) {
        const interrupted = interruptedInvestigationSnapshot(lastInvestigation, claim);
        emitInvestigation(interrupted);
        const timedOut = buildTimedOutReport(claim);
        timedOut.investigation = interrupted;
        applyContextCrossCheckToReport(timedOut, { claim, visualExtraction });
        // B2：先计费再收尾（原先 release 在前把 settled 置真，这里的 commit 变空操作 → 超时=白嫖）
        commitFreeCheck(res, ticket);
        sendEvent({
          type: "complete",
          claim,
          steps: [],
          finalReport: timedOut,
          memoryCandidates: [],
          timestamp: Date.now(),
        });
        finishRun("interrupted");
        endResponse();
        return;
      }
      // 客户端主动断开（刷新/关页/写失败）→ 照常计费，放弃不能变成免费重试入口；
      // 服务端真失败 → 退还这次核查
      if (error instanceof Error && (error.message.includes("client-disconnected") || error.name === "AbortError")) {
        commitFreeCheck(res, ticket);
      } else {
        releaseFreeCheck(ticket);
      }
      const { message } = toFriendlyError(error, "这次核查没能完成，请稍后重试");
      // 中断帧先行：前端拿到 phase=interrupted 的真实部分数据，再收 error 提示。
      emitInvestigation(interruptedInvestigationSnapshot(lastInvestigation, claim));
      sendEvent({
        type: "error",
        message,
        timestamp: Date.now(),
      });
      // 用户取消 → cancelled；断连或服务端问题 → interrupted。两者都不算「完成」。
      finishRun(runSignal?.aborted ? "cancelled" : "interrupted");
      res.end();
    } finally {
      clearInterval(heartbeat);
      unsubscribeRun();
    }
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
