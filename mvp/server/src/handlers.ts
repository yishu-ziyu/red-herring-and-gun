/**
 * handlers.ts — Express HTTP adapter + Case Pipeline / Agent Loop 编排接线。
 *
 * 只做三件事：路由分发、SSE 流式输出、调 runCasePipeline（ADR-003 生产路径）。
 * LLM provider 调用 → lib/llmGateway.js；搜索矩阵 → lib/searchProviders.js；
 * 视觉摄入 → lib/visionIntake.js；兜底报告 → lib/reportFallback.js；
 * 公式评分 → lib/formulaScore.js；HTTP 工具 → lib/httpUtils.js。
 * 产品规则不写在 HTTP 层；域深度在 mvp/server/src/lib/。
 */

import dns from "node:dns/promises";

import { searchClaimAcrossSources } from "./lib/sherlockStyleSearch.js";

import { type AtomSearchBundle } from "./lib/atomSearch.js";

import { runCasePipeline, type PipelineStep, type RunAgentFn } from "./lib/casePipeline/index.js";

import { createLoopLlm, modelFromChoice, wantsAgentLoop } from "./lib/agentLoop/index.js";
import { runClaimLoopPi } from "./lib/agentLoop/runClaimLoopPi.js";

import { makeRewriteQueryCall } from "./lib/evidenceLoop/index.js";

import { getMemoryCandidateStore } from "./lib/memoryCandidateHandlers.js";

import type { MemoryCandidateHit } from "./lib/memoryCandidateTypes.js";

import { ProviderFallbackError } from "./lib/providerRouter.js";

import { listAvailableModels, validateModelChoice } from "./lib/availableModels.js";

import { probeModelServiceHealth } from "./lib/modelServiceHealth.js";

import { attachCondensedSnippets } from "./lib/sourceCondenser.js";

import { lookupImageOrigin, visionHintsFromExtraction } from "./lib/imageOrigin/index.js";

import { commitFreeCheck, releaseFreeCheck } from "./lib/checkQuota.js";

import { applyFactDeskPostProcessToReport } from "./lib/factDeskPostProcess.js";

import { buildClaimReviewJsonLd } from "./lib/claimReview.js";

import { readJson, sendJson, wait, getTimeoutMs, withTimeout } from "./lib/httpUtils.js";

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
  callSearchProvider,
  getProviderLabel,
  getSearchToolName,
  retrieveAtomSources,
} from "./lib/searchProviders.js";

import {
  callLocalProvider,
  callLocalProviderRecursive,
  callOpenAI,
  callOpenAIRecursive,
} from "./lib/llmGateway.js";

import {
  runReportComposerWithFallback,
  buildConsensusDebate,
  buildDeterministicFinalReport,
} from "./lib/reportFallback.js";

import { makeSearch360ReverseImage } from "./lib/reverseImage/search360ReverseImage.js";

import { applyContextCrossCheckToReport } from "./lib/contextCrossCheck.js";

import { createOrchestrateAdapter } from "./lib/orchestrate.js";

// ───────────────────────────────────────────────────────────────
// 错误信息泄漏修复：把任意异常收敛成"用户可读友好文案 + 结构化诊断"。
// message 只承载用户可读文案；原始诊断放 detail / providerErrors，绝不上屏。
// 供顶层 error 出口与 agent_error 出口共用，也让后端回归测试能直接钉死。
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
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const providerErrors =
    error instanceof ProviderFallbackError && error.providerErrors?.length
      ? error.providerErrors
      : undefined;
  // ProviderFallbackError.message 已是友好文案，直接复用；其余一律用 fallback 兜底。
  const userFacing = error instanceof ProviderFallbackError && raw ? raw : fallback;
  return {
    message: userFacing,
    ...(raw && raw !== userFacing ? { detail: raw } : {}),
    ...(providerErrors ? { providerErrors } : {}),
  };
}


// Express handlers extracted from vite.config.ts
// All LLM provider calls and agent orchestration logic

export function createHandlers(env: Record<string, string>) {
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const codexBin = env.CODEX_BIN || process.env.CODEX_BIN || "/usr/local/bin/codex";
  const codexModel = env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5";

  // 多 Agent Orchestrate 编排（组装/状态栏/Skills/自证/改写/交叉二审）收在 lib/orchestrate。
  const { makeRunAgent, makeSelfProofCaller, makeRewriteCaller, makeCrossExamCaller } =
    createOrchestrateAdapter({ env, codexBin });

  async function handler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const llmResult = apiKey
        ? await callOpenAI({ apiKey, baseUrl, model, payload })
        : await callLocalProvider({ codexBin, model: codexModel, payload, env });
      return sendJson(res, 200, llmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知 LLM 调用错误";
      return sendJson(res, 502, { message });
    }
  }

  async function recursiveHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const llmResult = apiKey
        ? await callOpenAIRecursive({ apiKey, baseUrl, model, payload })
        : await callLocalProviderRecursive({ codexBin, model: codexModel, payload, env });
      return sendJson(res, 200, llmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知递归搜索错误";
      return sendJson(res, 502, { message });
    }
  }

  async function sherlockHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    try {
      const result = await searchClaimAcrossSources(payload.claim, payload.keywords);
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sherlock 搜索错误";
      return sendJson(res, 502, { message });
    }
  }

  async function search360Handler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    if (!query) return sendJson(res, 400, { message: "缺少 query 参数" });

    try {
      const result = await withTimeout(
        callParallelSearchProviders({ env, query, model: payload.model, refProm: payload.refProm }),
        getTimeoutMs(env, "SEARCH_TOTAL_TIMEOUT_MS", 20000),
        "并行搜索服务"
      );
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
      return sendJson(res, 504, { message });
    }
  }

  async function searchProviderHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();

    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }

    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
    if (!query) return sendJson(res, 400, { message: "缺少 query 参数" });
    if (!provider) return sendJson(res, 400, { message: "缺少 provider 参数" });

    try {
      const result = await withTimeout(
        callSearchProvider({ env, provider, query, model: payload.model, refProm: payload.refProm }),
        getTimeoutMs(env, "SEARCH_PROVIDER_ENDPOINT_TIMEOUT_MS", 15000),
        getProviderLabel(provider)
      );
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} 未返回真实结果`;
      return sendJson(res, 504, { message });
    }
  }

  async function get360SearchForClaim(claim: string) {
    try {
      return await retrieveAtomSources(env, claim);
    } catch (error) {
      const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
      return build360SearchFailure(claim, message);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // GET /api/models/list — 返回 server 端已配 key 的所有 model 候选
  // 用于前端 ModelPicker 渲染下拉选项
  // ───────────────────────────────────────────────────────────────

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
        message: "暂时无法确认模型服务是否可用。这次可能较久，也可能给不出最终判断；仍会尽量检索公开材料。",
      });
    }
  }

  // ───────────────────────────────────────────────────────────────
  function makeImageOriginLookup(
    intake: CaseIntakePayload | null,
    visualExtraction: Record<string, unknown> | undefined
  ) {
    if (!intake?.images.length) return undefined;
    const hints = visionHintsFromExtraction(visualExtraction);
    const images = intake.images
      .filter((image): image is CaseIntakeImagePayload & { dataUrl: string } => typeof image.dataUrl === "string")
      .map((image) => ({ mimeType: image.type, dataUrl: image.dataUrl }));
    // Reverse-image 适配器（360 图搜）：配置了 KEY + PUBLIC_BASE_URL 才启用，
    // 否则 undefined → lookupImageOrigin 自动降级为「原图没查到」，绝不发明图源。
    const reverseImageSearch = makeSearch360ReverseImage(env);
    return () =>
      lookupImageOrigin({
        images,
        ocrTexts: hints.ocrTexts,
        sourceHints: hints.sourceHints,
        reverseImageSearch,
      });
  }

  function makeSearchOneAtom() {
    let reuseHitsPromise: Promise<MemoryCandidateHit[]> | undefined;
    return async (atom: string) => {
      if (!reuseHitsPromise) {
        reuseHitsPromise = getMemoryCandidateStore()
          .searchAccepted(atom)
          .catch(() => []);
      }
      const reuseHits = await reuseHitsPromise;
      let result: Record<string, unknown>;
      try {
        result = await retrieveAtomSources(env, atom, reuseHits);
      } catch (error) {
        const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
        result = build360SearchFailure(atom, message);
      }
      try {
        await attachCondensedSnippets(env, atom, result);
      } catch {
        /* 浓缩失败不阻断 */
      }
      return result;
    };
  }

  function makeReportRunner(runAgent: RunAgentFn) {
    return async ({
      claim,
      steps,
      search360Result,
      atomSearchBundle,
      onFallback,
    }: {
      claim: string;
      steps: PipelineStep[];
      search360Result: unknown;
      atomSearchBundle: AtomSearchBundle;
      onFallback?: (step: any) => void;
    }) =>
      runReportComposerWithFallback({
        claim,
        steps,
        search360Result,
        runAgent: (agentId, s, search) => runAgent(agentId, s as any, search, atomSearchBundle),
        onFallback,
      });
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

  /** POST /api/agent/batch — 一次核查多条（newsroom 批量）。逐条走 pi agent 循环，判决纪律不变。 */
  async function batchHandler(req: any, res: any, next: any) {
    if (req.method !== "POST") return next();
    let payload: any;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { message: "无法解析请求 JSON" });
    }
    const claims = Array.isArray(payload.claims)
      ? payload.claims
          .map((c: unknown) => (typeof c === "string" ? c.trim() : ""))
          .filter((c: string) => c.length > 0)
          .slice(0, 20)
      : [];
    if (claims.length === 0) {
      return sendJson(res, 400, { message: "缺少 claims（至少一条）" });
    }
    if (claims.some((c: string) => c.length > 2000)) {
      return sendJson(res, 400, { message: "单条最多 2000 字" });
    }
    const modelChoice = payload.modelChoice;
    const mcValidation = validateModelChoice(env, modelChoice);
    if (!mcValidation.ok) {
      return sendJson(res, 400, { message: mcValidation.error || "modelChoice 非法" });
    }
    const intake = normalizeCaseIntake(payload.intake);
    const maxToolCalls = typeof payload.maxToolCalls === "number" ? payload.maxToolCalls : 24;
    try {
      const results = [];
      for (const one of claims) {
        const loop = await runClaimLoopPi({
          claim: one,
          env,
          maxToolCalls,
          callSelfProofModel: makeSelfProofCaller(one, modelChoice),
        });
        results.push({
          claim: one,
          verdictType: loop.finalReport.verdictType,
          credibilityScore: loop.finalReport.credibilityScore,
          conclusion: loop.finalReport.conclusion,
          faceVerdict: loop.finalReport.faceVerdict,
          finalReport: loop.finalReport,
        });
      }
      return sendJson(res, 200, { results, execution: "loop", count: results.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "批量核查失败";
      return sendJson(res, 502, { message });
    }
  }

  const PIPELINE_TOTAL_TIMEOUT_MS = Number(env.ORCHESTRATE_TOTAL_TIMEOUT_MS || 90_000);

  /** 整体核查超时兜底：不憋用户，先给「还没查完」的中间结论（unverified + error-boundary）。 */
  function buildTimedOutReport(c: string): Record<string, unknown> {
    const report = buildDeterministicFinalReport(c, [], undefined, "核查超过时限，先给中间结论。");
    report._source = "error-boundary";
    return report;
  }

  async function orchestrateHandler(req: any, res: any, next: any) {
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

    try {
      if (intake?.images.length) {
        const visionResult = await callStepFunVisionForIntake({ env, claim, intake });
        visualExtraction = asRecord(visionResult.output);
        claim = composeClaimWithVision(claim, intake, visualExtraction);
      }

      if (wantsAgentLoop(payload, env)) {
        const loop = await runClaimLoopPi({
          claim,
          env,
          callSelfProofModel: makeSelfProofCaller(claim, modelChoice),
          lookupImageOrigin: makeImageOriginLookup(intake, visualExtraction),
        });
        commitFreeCheck(res, ticket);
        return sendJson(res, 200, {
          steps: [],
          finalReport: loop.finalReport,
          execution: "loop",
        });
      }

      const runAgent = makeRunAgent({
        claim,
        modelChoice,
        intakeMetadata,
        visualExtraction,
        clientMemoryRecall,
      });

      const result = await withTimeout(
        runCasePipeline({
          claim,
          runAgent,
          searchOne: makeSearchOneAtom(),
          lookupImageOrigin: makeImageOriginLookup(intake, visualExtraction),
          callSelfProofModel: makeSelfProofCaller(claim, modelChoice),
          runReport: (args) => makeReportRunner(runAgent)(args),
          evidenceLoop: { callRewriteModel: makeRewriteQueryCall(makeRewriteCaller(modelChoice)) },
          crossExam: { callRaw: makeCrossExamCaller(modelChoice) },
          hooks: {
            searchMode: "parallel",
            onSelfProof: (info) => {
              console.log(
                `[agent_self_proof] claim=${JSON.stringify(claim).slice(0, 120)} kept=${info.kept.length} dropped=${info.dropped.length}`
              );
            },
            onAtomSearchResult: (_atom, _result) => {
              /* aggregate log after pipeline via result */
            },
            onEvidenceLoopStopped: (info) => {
              console.log(
                `[evidence_loop] atom=${JSON.stringify(info.atom).slice(0, 80)} rounds=${info.rounds} reason=${info.reason}`
              );
            },
        },
        finalizeReport: (fctx: Parameters<typeof pipelineFinalize>[0]) =>
          pipelineFinalize(fctx, visualExtraction),
        memoryCandidateStore: getMemoryCandidateStore(),
      }),
        PIPELINE_TOTAL_TIMEOUT_MS,
        "整体核查"
      );

      console.log(
        `[atom_search] sources=${(result.atomSearchBundle.aggregate.sources || []).length} memoryCandidates=${result.memoryCandidates.length}`
      );

      commitFreeCheck(res, ticket);
      return sendJson(res, 200, {
        steps: result.steps,
        finalReport: result.finalReport,
        memoryCandidates: result.memoryCandidates,
      });
    } catch (error) {
      releaseFreeCheck(ticket);
      // 整体超时 → 给「还没查完」的中间结论，不 502
      if (error instanceof Error && error.message.includes("整体核查")) {
        const timedOut = buildTimedOutReport(claim);
        applyContextCrossCheckToReport(timedOut, { claim, visualExtraction });
        return sendJson(res, 200, { steps: [], finalReport: timedOut, memoryCandidates: [] });
      }
      const message = error instanceof Error ? error.message : "Orchestrate 调用错误";
      return sendJson(res, 502, { message, steps: [] });
    }
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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
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
          const visionResult = await callStepFunVisionForIntake({ env, claim, intake });
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

      if (wantsAgentLoop(payload, env)) {
        const loop = await runClaimLoopPi({
          claim,
          env,
          callSelfProofModel: makeSelfProofCaller(claim, modelChoice),
          lookupImageOrigin: makeImageOriginLookup(intake, visualExtraction),
          onEvent: sendEvent,
        });
        sendEvent({
          type: "complete",
          claim,
          steps: [],
          finalReport: loop.finalReport,
          timestamp: Date.now(),
        });
        commitFreeCheck(res, ticket);
        res.end();
        return;
      }

      const runAgent = makeRunAgent({
        claim,
        modelChoice,
        intakeMetadata,
        visualExtraction,
        clientMemoryRecall,
        onStart: (agentId, agentConfig) => {
          sendEvent({
            type: "agent_start",
            agent: agentId,
            agentName: agentConfig.name,
            agentIcon: agentConfig.icon,
            model: agentConfig.model || "",
            timestamp: Date.now(),
          });
        },
        onThought: (agentId, agentConfig, content, seq, done) => {
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
        onComplete: (step) => {
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
        onError: (agentId, agentConfig, error) => {
          const { message, detail, providerErrors } = toFriendlyError(
            error,
            `${agentConfig.name} 真实模型调用失败`
          );
          sendEvent({
            type: "agent_error",
            agent: agentId,
            agentName: agentConfig.name,
            agentIcon: agentConfig.icon,
            error: message,
            ...(detail ? { detail } : {}),
            ...(providerErrors ? { providerErrors } : {}),
            timestamp: Date.now(),
          });
        },
      });

      const result = await withTimeout(runCasePipeline({
        claim,
        runAgent,
        searchOne: makeSearchOneAtom(),
        lookupImageOrigin: makeImageOriginLookup(intake, visualExtraction),
        callSelfProofModel: makeSelfProofCaller(claim, modelChoice),
        evidenceLoop: { callRewriteModel: makeRewriteQueryCall(makeRewriteCaller(modelChoice)) },
        crossExam: { callRaw: makeCrossExamCaller(modelChoice, (data) => sendEvent(data)) },
        runReport: (args) =>
          makeReportRunner(runAgent)({
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
          }),
        hooks: {
          searchMode: "sequential",
          onSelfProof: (info) => {
            console.log(
              `[agent_self_proof] claim=${JSON.stringify(claim).slice(0, 120)} kept=${info.kept.length} dropped=${info.dropped.length}`
            );
          },
          onAtomSearchStart: (atom) => {
            sendEvent({
              type: "tool_start",
              toolName: "Atom Search",
              query: atom,
              timestamp: Date.now(),
            });
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
                debate: {
                  ...debate,
                  status: "running",
                  rounds: [],
                  finalConsensus: "事实核查与溯源还在对证据，先不写结论。",
                },
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
            sendEvent({
              type: "consensus_debate_final",
              phase: "handoff",
              debate,
              timestamp: Date.now(),
            });
          },
          onReportReviewStart: (info) => {
            sendEvent({
              type: "tool_start",
              toolName: info.toolName,
              query: info.query,
              timestamp: Date.now(),
            });
          },
          onReportReviewResult: (info) => {
            sendEvent({
              type: "tool_result",
              toolName: info.toolName,
              query: info.query,
              result: {
                passed: info.passed,
                score: info.score,
                issues: info.issues,
                checks: info.checks,
              },
              timestamp: Date.now(),
            });
          },
          onMemoryWriteStart: (info) => {
            sendEvent({
              type: "tool_start",
              toolName: info.toolName,
              query: info.query,
              timestamp: Date.now(),
            });
          },
          onMemoryWriteResult: (info) => {
            sendEvent({
              type: "tool_result",
              toolName: info.toolName,
              query: info.query,
              result: {
                proposedCandidateCount: info.proposedCandidateCount,
              },
              timestamp: Date.now(),
            });
          },
        },
        finalizeReport: (fctx: Parameters<typeof pipelineFinalize>[0]) =>
          pipelineFinalize(fctx, visualExtraction),
        memoryCandidateStore: getMemoryCandidateStore(),
      }),
        PIPELINE_TOTAL_TIMEOUT_MS,
        "整体核查"
      );

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
      commitFreeCheck(res, ticket);
      res.end();
    } catch (error) {
      releaseFreeCheck(ticket);
      // 整体超时 → 给「还没查完」的中间结论，不发 error
      if (error instanceof Error && error.message.includes("整体核查")) {
        const timedOut = buildTimedOutReport(claim);
        applyContextCrossCheckToReport(timedOut, { claim, visualExtraction });
        commitFreeCheck(res, ticket);
        sendEvent({
          type: "complete",
          claim,
          steps: [],
          finalReport: timedOut,
          memoryCandidates: [],
          timestamp: Date.now(),
        });
        res.end();
        return;
      }
      const { message, detail, providerErrors } = toFriendlyError(error, "Orchestrate Stream 调用错误");
      sendEvent({
        type: "error",
        message,
        ...(detail ? { detail } : {}),
        ...(providerErrors ? { providerErrors } : {}),
        timestamp: Date.now(),
      });
      res.end();
    }
  }

  // ───────────────────────────────────────────────────────────────
  // POST /api/agent/test-llm — BYO key 连接性探针（不落库，不记 key）
  // 强约束：
  //   - 仅放行 https:// 站点（dev 允许 http://localhost）
  //   - prod 拒绝任何 loopback / 内网 IP
  //   - 5s 超时 + AbortController
  //   - 永不记录 apiKey
  // ───────────────────────────────────────────────────────────────

  /** 覆盖 IPv4 私网/保留段、IPv6 ULA/链路本地、以及内网惯用主机名。 */
  function isPrivateAddressText(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
      return true;
    }
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const a = Number(v4[1]);
      const b = Number(v4[2]);
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true; // 含云 metadata 169.254.169.254
      if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
      if (a >= 224) return true; // 组播/保留段
      return false;
    }
    if (h.includes(":")) {
      if (h === "::" || h === "::1") return true;
      if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
      if (/^fe[89ab][0-9a-f]:/.test(h) || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
      return false;
    }
    return false;
  }

  /** 域名可能解析到内网 IP（含 DNS rebinding），生产环境必须解析后再核验。 */
  async function baseUrlTargetsPrivateNetwork(baseUrl: string): Promise<boolean> {
    let hostname = "";
    try {
      hostname = new URL(baseUrl).hostname;
    } catch {
      return true; // 非法 URL 一律拦
    }
    if (isPrivateAddressText(hostname)) return true;
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      return resolved.some((row) => isPrivateAddressText(row.address));
    } catch {
      // DNS 解析失败：交给后续 fetch 自然报错，不在这里放结论
      return false;
    }
  }

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

    const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1");
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
    handler,
    recursiveHandler,
    sherlockHandler,
    search360Handler,
    searchProviderHandler,
    modelsListHandler,
    modelsHealthHandler,
    orchestrateHandler,
    orchestrateStreamHandler,
    testLlmHandler,
    batchHandler,
  };
}
