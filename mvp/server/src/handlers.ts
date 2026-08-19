import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { searchClaimAcrossSources } from "./lib/sherlockStyleSearch.js";
import { AGENT_CONFIGS, buildAgentInput } from "./lib/agentConfigs.js";
import { type AtomSearchBundle } from "./lib/atomSearch.js";
import { mergeParallelSearchPayloads } from "./lib/atomSearchQuery.js";
import { applyExclusionLayerToReport } from "./lib/reportAssembly/index.js";
import { runCasePipeline, type PipelineStep, type RunAgentFn } from "./lib/casePipeline/index.js";
import { makeRewriteQueryCall } from "./lib/evidenceLoop/index.js";
import { getMemoryCandidateStore } from "./lib/memoryCandidateHandlers.js";
import type { MemoryCandidateHit } from "./lib/memoryCandidateTypes.js";
import { buildQueriesWithReuse } from "./lib/queryReuse.js";
import {
  callAgentWithFallback,
  providerOrderForAgent,
  AgentTextProviderId,
  ProviderFallbackError,
} from "./lib/providerRouter.js";
import { buildAgentStatusBar } from "./lib/contextStatusBar.js";
import { formatSkillsForPrompt, selectAgentSkills } from "./lib/agentSkills.js";
import { listAvailableModels, validateModelChoice } from "./lib/availableModels.js";
import { probeModelServiceHealth } from "./lib/modelServiceHealth.js";
import { attachCondensedSnippets } from "./lib/sourceCondenser.js";
import { computeCredibilityScore, labelForScore, type CredibilityScoreResult } from "./lib/credibilityScore.js";
import { commitFreeCheck, gateFreeCheck, releaseFreeCheck } from "./lib/checkQuota.js";
// 审查 P3-2 修复：Anthropic 文本/JSON 提取统一从共享模块引入，不再各处独立定义。
import { extractAnthropicText, extractJsonObject } from "./lib/anthropicParse.js";
import { applyFactDeskPostProcessToReport } from "./lib/factDeskPostProcess.js";
import { buildClaimReviewJsonLd } from "./lib/claimReview.js";
import {
  splitReasoningSentences,
  thoughtInterSentenceDelayMs,
} from "../../src/lib/reasoningThoughts.js";

const execFileAsync = promisify(execFile);

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// ───────────────────────────────────────────────────────────────
// 审查 P3-1 + P2-1 修复：抽取 computeFormulaScore 共享 helper
// 两个 handler（orchestrate / orchestrateStream）原本各自复制一份
// 公式覆盖块；同时把硬编码 direction:"support" 改为基于 search360Result
// 的 contradictingEvidence URL 交叉匹配做方向分类。
// 失败时返回 null，调用方回退到 LLM 分数。
// ───────────────────────────────────────────────────────────────
function normalizeSearchCredibility(src: any): "高" | "中" | "低" {
  const raw = src?.credibility;
  if (raw === "高" || raw === "中" || raw === "低") return raw;
  // credibilityScore 数字兜底：>=75 高，>=50 中，否则低
  const num = typeof src?.credibilityScore === "number" ? src.credibilityScore : undefined;
  if (typeof num === "number") return num >= 75 ? "高" : num >= 50 ? "中" : "低";
  return "低";
}

function classifySearchDirection(
  src: any,
  contradictUrls: Set<string>
): "support" | "contradict" | "neutral" {
  // 1. URL 命中 contradictingEvidence → contradict
  const srcUrl = typeof src?.url === "string" ? src.url : "";
  if (srcUrl && contradictUrls.has(srcUrl)) return "contradict";
  // 2. evidenceRole / direction 字段优先
  const role = src?.evidenceRole ?? src?.direction;
  if (role === "反驳" || role === "contradict") return "contradict";
  if (role === "支持" || role === "support") return "support";
  // 3. 标题/摘要文本启发式：含辟谣/不实等关键词 → contradict
  const text = `${src?.title ?? ""} ${src?.snippet ?? ""}`.toLowerCase();
  if (/(辟谣|不实|虚假|假的|误读|反驳|谣言|无法证实|未证实|不准确|夸大)/.test(text)) return "contradict";
  if (/(官方回应|证实|确认|证明|依据|来源|公告|通报)/.test(text)) return "support";
  return "neutral";
}

export function computeFormulaScore(
  rumorOut: any,
  factOut: any,
  sourceOut: any,
  search360Result: any
): CredibilityScoreResult | null {
  try {
    // 收集 contradictingEvidence 的 URL 集合用于交叉匹配方向
    const contradictList: any[] = Array.isArray(search360Result?.contradictingEvidence)
      ? search360Result.contradictingEvidence
      : [];
    const contradictUrls = new Set<string>(
      contradictList
        .map((item: any) => (typeof item?.url === "string" ? item.url : ""))
        .filter(Boolean)
    );

    const searchSources = (search360Result?.sources ?? []).slice(0, 8).map((src: any) => ({
      direction: classifySearchDirection(src, contradictUrls),
      credibility: normalizeSearchCredibility(src),
    }));

    return computeCredibilityScore(
      {
        severity: rumorOut?.severity ?? "medium",
        rumorIndicators: Array.isArray(rumorOut?.rumorIndicators) ? rumorOut.rumorIndicators : [],
        detectedPatterns: Array.isArray(rumorOut?.detectedPatterns) ? rumorOut.detectedPatterns : [],
      },
      {
        factCheckResult: factOut?.factCheckResult ?? "unverified",
        confidence: factOut?.confidence ?? "low",
        keyFindings: Array.isArray(factOut?.keyFindings) ? factOut.keyFindings : [],
        counterEvidence: Array.isArray(factOut?.counterEvidence) ? factOut.counterEvidence : [],
        sources: Array.isArray(factOut?.sources) ? factOut.sources : [],
      },
      {
        sourceReliability: sourceOut?.sourceReliability ?? "unverified",
        verifiedSources: Array.isArray(sourceOut?.verifiedSources) ? sourceOut.verifiedSources : [],
        questionableSources: Array.isArray(sourceOut?.questionableSources) ? sourceOut.questionableSources : [],
        missingSources: Array.isArray(sourceOut?.missingSources) ? sourceOut.missingSources : [],
        verificationNotes: typeof sourceOut?.verificationNotes === "string" ? sourceOut.verificationNotes : "",
      },
      {
        sources: searchSources,
        supportingEvidence: [],
        contradictingEvidence: contradictList.map((item: any) => typeof item?.title === "string" ? item.title : "").filter(Boolean),
        unresolvedEvidenceGaps: Array.isArray(search360Result?.unresolvedEvidenceGaps) ? search360Result.unresolvedEvidenceGaps : [],
      }
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[credibilityScore] 公式计算失败，回退到 LLM 分数: ${reason}`);
    return null;
  }
}

/**
 * 把公式结果写回 finalReport，并打上 _scoreSource=formula 标记。
 *
 * 产品一致性：最终展示的 verdictType 与 credibilityScore 不得互相矛盾。
 * 公式输入来自 fact_checker 等上游步骤；report_composer 可能给出更强的最终裁决。
 * 若最终裁决为 false，分数必须落在低可信带（≤15），避免「判假但 23 分」的展示分裂。
 */
export function applyFormulaScoreToReport(finalReport: any, formulaResult: CredibilityScoreResult | null): void {
  if (!formulaResult || !finalReport || typeof finalReport !== "object") return;
  let score = formulaResult.score;
  const displayedVerdict =
    typeof finalReport.verdictType === "string" ? finalReport.verdictType : formulaResult.verdict;
  if (displayedVerdict === "false" && score > 15) {
    finalReport._scoreUncapped = score;
    finalReport._scoreVerdictCap = 15;
    score = 15;
  }
  finalReport.credibilityScore = score;
  finalReport.credibilityLabel = labelForScore(score);
  finalReport._scoreSource = "formula";
  finalReport._scoreBreakdown = formulaResult.breakdown;
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    controllerNote: { type: "string" },
    agentTitle: { type: "string" },
    agentSubtitle: { type: "string" },
    resultTitle: { type: "string" },
    resultSubtitle: { type: "string" },
    resultStatus: { type: "string", enum: ["risk", "active", "supported", "limited", "blocked", "rewrite"] },
    traceText: { type: "string" },
    inspectorSummary: { type: "string" },
    canSay: { type: "array", items: { type: "string" } },
    cannotSay: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
  },
  required: [
    "controllerNote",
    "agentTitle",
    "agentSubtitle",
    "resultTitle",
    "resultSubtitle",
    "resultStatus",
    "traceText",
    "inspectorSummary",
    "canSay",
    "cannotSay",
    "sources",
  ],
};

const recursiveResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    controllerNote: { type: "string" },
    runTitle: { type: "string" },
    traceText: { type: "string" },
    clues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          source: { type: "string" },
          role: { type: "string", enum: ["support", "limit", "counter", "context", "lead"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["id", "title", "summary", "source", "role", "confidence"],
      },
    },
    frontier: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          reasonToContinue: { type: "string" },
          nextQuestion: { type: "string" },
          estimatedValue: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["id", "title", "reasonToContinue", "nextQuestion", "estimatedValue"],
      },
    },
    stopped: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          reason: { type: "string", enum: ["duplicate", "budget", "low_confidence", "out_of_scope"] },
        },
        required: ["id", "title", "reason"],
      },
    },
    canSay: { type: "array", items: { type: "string" } },
    cannotSay: { type: "array", items: { type: "string" } },
  },
  required: ["controllerNote", "runTitle", "traceText", "clues", "frontier", "stopped", "canSay", "cannotSay"],
};

const allowedStatuses = new Set(["risk", "active", "supported", "limited", "blocked", "rewrite", "clue", "frontier", "stopped", "controller"]);

interface CaseIntakeLinkPayload {
  url: string;
  hostname?: string;
  scrapedContent?: string;
  scrapeStatus?: "success" | "error";
  scrapeError?: string;
}

interface CaseIntakeImagePayload {
  name?: string;
  type?: string;
  size?: number;
  dataUrl?: string;
}

interface CaseIntakePayload {
  text: string;
  links: CaseIntakeLinkPayload[];
  images: CaseIntakeImagePayload[];
}

interface ClientMemoryRecallPayload {
  policy: string;
  hitCount: number;
  acceptedCandidateCount: number;
  evidenceCount: number;
  hits: unknown[];
  acceptedCandidates: unknown[];
  sources: unknown[];
  relatedQuestions: string[];
  traceText: string;
}

function normalizeCaseIntake(raw: any): CaseIntakePayload | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    text: typeof raw.text === "string" ? raw.text : "",
    links: Array.isArray(raw.links)
      ? raw.links
          .filter((link: any) => link && typeof link.url === "string")
          .map((link: any) => ({
            url: link.url,
            hostname: typeof link.hostname === "string" ? link.hostname : undefined,
            scrapedContent: typeof link.scrapedContent === "string" ? link.scrapedContent.slice(0, 12000) : undefined,
            scrapeStatus: link.scrapeStatus === "success" || link.scrapeStatus === "error" ? link.scrapeStatus : undefined,
            scrapeError: typeof link.scrapeError === "string" ? link.scrapeError : undefined,
          }))
      : [],
    images: Array.isArray(raw.images)
      ? raw.images
          .filter((image: any) => image && typeof image.dataUrl === "string")
          .slice(0, 4)
          .map((image: any) => ({
            name: typeof image.name === "string" ? image.name : undefined,
            type: typeof image.type === "string" ? image.type : undefined,
            size: typeof image.size === "number" ? image.size : undefined,
            dataUrl: image.dataUrl,
          }))
      : [],
  };
}

function normalizeClientMemoryRecall(raw: any): ClientMemoryRecallPayload | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const hitCount = safeInteger(raw.hitCount);
  const acceptedCandidateCount = safeInteger(raw.acceptedCandidateCount);
  const evidenceCount = safeInteger(raw.evidenceCount);
  return {
    policy: "历史案件和记忆候选只能作为检索线索、来源经验和风险提醒；不得把旧案结论直接当作本案证据。",
    hitCount,
    acceptedCandidateCount,
    evidenceCount,
    hits: safeArray(raw.hits).slice(0, 4).map((hit) => compactJsonValue(hit, 900)),
    acceptedCandidates: safeArray(raw.acceptedCandidates).slice(0, 4).map((candidate) => compactJsonValue(candidate, 700)),
    sources: safeArray(raw.sources).slice(0, 6).map((source) => compactJsonValue(source, 700)),
    relatedQuestions: safeArray(raw.relatedQuestions).filter((item): item is string => typeof item === "string").slice(0, 6),
    traceText: typeof raw.traceText === "string" ? raw.traceText.slice(0, 500) : "",
  };
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactJsonValue(value: unknown, maxLength: number) {
  try {
    const text = JSON.stringify(value);
    if (text.length > maxLength) return `${text.slice(0, maxLength)}...`;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildCaseIntakeMetadata(intake: CaseIntakePayload | null) {
  if (!intake) return undefined;
  return {
    text: intake.text,
    links: intake.links.map((link) => ({
      url: link.url,
      hostname: link.hostname,
      scrapeStatus: link.scrapeStatus,
      scrapeError: link.scrapeError,
      scrapedContentPreview: link.scrapedContent?.slice(0, 1200),
    })),
    images: intake.images.map((image) => ({
      name: image.name,
      type: image.type,
      size: image.size,
    })),
  };
}

function buildVisionPrompt(claim: string, intake: CaseIntakePayload) {
  return [
    "请只做用户材料的视觉预处理，不判断真假。",
    "任务：读取用户上传的图片，提取图片里的可见文字、截图上下文、主体、来源线索、时间地点线索和可核查声明。",
    "如果图片是聊天记录、网页截图、社交媒体截图，请区分原文、转述、用户名/平台/时间等可见线索。",
    "不要补充图片中不可见的事实，不要用常识猜测人物生死、政策真假、医学结论或新闻结论。",
    "返回 JSON，结构为：",
    JSON.stringify({
      visualSummary: "图片材料总体说明",
      ocrTexts: ["逐条列出图片中可见文字"],
      extractedClaims: ["从图片中抽取的可核查声明"],
      sourceHints: ["可见平台、账号、网址、时间、地点等来源线索"],
      uncertaintyNotes: ["模糊、遮挡、低清晰度、无法确认的内容"],
      nextEvidenceNeeds: ["后续搜索和交叉验证需要查什么"],
    }),
    "",
    `用户输入文本：${claim || intake.text || "无"}`,
    `用户输入链接：${intake.links.map((link) => link.url).join("；") || "无"}`,
  ].join("\n");
}

// Reasoning 系列模型（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
// 三者皆会触发 400 Invalid request。仅 chat 模型才发这些字段。
export function buildStepFunRequestBody({
  model,
  messages,
  maxTokens,
  responseFormat,
  temperature,
  reasoningEffort,
}: {
  model: string;
  messages: unknown[];
  maxTokens: number;
  responseFormat?: { type: "json_object" };
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Record<string, unknown> {
  const isReasoning = /^step-3\.7-flash$/i.test(model);
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
  };
  if (!isReasoning) {
    if (responseFormat !== undefined) body.response_format = responseFormat;
    if (temperature !== undefined) body.temperature = temperature;
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort;
  }
  return body;
}

async function callStepFunVisionForIntake({
  env,
  claim,
  intake,
}: {
  env: Record<string, string>;
  claim: string;
  intake: CaseIntakePayload;
}) {
  const apiKey = env.STEPFUN_API_KEY || process.env.STEPFUN_API_KEY;
  if (!apiKey) throw new Error("缺少 STEPFUN_API_KEY，无法解析图片材料。");

  const baseUrl = (env.STEPFUN_BASE_URL || process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
  const model = env.STEPFUN_VISION_MODEL || process.env.STEPFUN_VISION_MODEL || env.STEPFUN_MODEL || process.env.STEPFUN_MODEL || "step-3.7-flash";
  const content: any[] = [{ type: "text", text: buildVisionPrompt(claim, intake) }];
  for (const image of intake.images) {
    if (!image.dataUrl) continue;
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "high",
      },
    });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildStepFunRequestBody({
        model,
        messages: [
          { role: "system", content: "你是红鲱鱼与枪的视觉材料预处理 Agent。只做 OCR、图像描述和可核查声明提取；只返回 JSON。" },
          { role: "user", content },
        ],
        maxTokens: 1200,
        responseFormat: { type: "json_object" },
        temperature: 0.1,
      })
    ),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`StepFun 视觉模型调用失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("StepFun 视觉模型没有返回可解析文本。");

  return {
    model: `stepfun-vision:${model}`,
    output: JSON.parse(extractJsonObject(text)),
  };
}

function composeClaimWithVision(claim: string, intake: CaseIntakePayload, visualExtraction: Record<string, unknown>) {
  const links = intake.links.map((link) => link.scrapedContent
    ? `链接：${link.url}\n抓取正文摘录：${link.scrapedContent.slice(0, 4000)}`
    : `链接：${link.url}${link.scrapeStatus === "error" ? `（抓取失败：${link.scrapeError || "未知错误"}）` : ""}`
  );

  return [
    claim,
    "",
    "【用户上传材料的真实工具预处理结果】",
    "以下视觉提取来自 StepFun 视觉模型，仅作为待核查材料，不是事实结论。",
    JSON.stringify(visualExtraction, null, 2),
    links.length > 0 ? `\n【链接材料】\n${links.join("\n\n")}` : "",
  ].filter(Boolean).join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Express handlers extracted from vite.config.ts
// All LLM provider calls and agent orchestration logic

export function createHandlers(env: Record<string, string>) {
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const codexBin = env.CODEX_BIN || process.env.CODEX_BIN || "/usr/local/bin/codex";
  const codexModel = env.CODEX_LOCAL_MODEL || process.env.CODEX_LOCAL_MODEL || "gpt-5.5";

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
  // 多 Agent Orchestrate — thin HTTP adapters over Case Pipeline
  // ───────────────────────────────────────────────────────────────

  /** Prefer rumor_detector stanceClaimType; default mixed for skill routing. */
  function inferClaimTypeForSkills(steps: Array<{ agent?: string; output?: Record<string, unknown> }>): string | undefined {
    const rumor = steps.find((s) => s.agent === "rumor_detector");
    const stance = rumor?.output?.stanceClaimType as { type?: string } | undefined;
    if (stance && typeof stance.type === "string" && stance.type.length > 0) {
      return stance.type;
    }
    return undefined;
  }

function makeRunAgent(opts: {
  claim: string;
  modelChoice: any;
  intakeMetadata: any;
  visualExtraction: Record<string, unknown> | undefined;
  clientMemoryRecall: any;
  onStart?: (agentId: string, agentConfig: (typeof AGENT_CONFIGS)[number]) => void;
  onThought?: (
    agentId: string,
    agentConfig: (typeof AGENT_CONFIGS)[number],
    content: string,
    seq: number,
    done: boolean
  ) => void;
  onComplete?: (step: any) => void;
  onError?: (agentId: string, agentConfig: (typeof AGENT_CONFIGS)[number], error: unknown) => void;
}): RunAgentFn {
    return async function runAgent(agentId, steps, search360Result?, atomSearchBundle?) {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      opts.onStart?.(agentId, agentConfig);
      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, opts.claim, steps as any);
      if (opts.intakeMetadata) agentInput.intake = opts.intakeMetadata;
      if (opts.visualExtraction) agentInput.visualExtraction = opts.visualExtraction;
      if (opts.clientMemoryRecall) agentInput.memoryRecall = opts.clientMemoryRecall;
      if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        agentInput.search360 = compactSearchResultForAgent(search360Result);
        if (atomSearchBundle && (agentId === "fact_checker" || agentId === "report_composer")) {
          agentInput.atomSearches = atomSearchBundle.forAgent;
        }
      }
      if (agentId === "report_composer") {
        agentInput.evidenceInputs = buildReportEvidenceInputs(steps as any, search360Result);
      }

      // Book Ch.2：状态栏 + 按需 Skills（与 client AgentRuntime 对齐）
      const claimType = inferClaimTypeForSkills(steps as any) ?? "mixed";
      const memoryRecall = opts.clientMemoryRecall as
        | { hitCount?: number; acceptedCandidateCount?: number }
        | undefined;
      const statusBar = buildAgentStatusBar({
        agentId,
        agentName: agentConfig.name,
        claim: opts.claim,
        claimType,
        stepIndex: steps.length + 1,
        totalStepsHint: 4,
        tools: [],
        memoryHitCount: memoryRecall?.hitCount ?? 0,
        acceptedCandidateCount: memoryRecall?.acceptedCandidateCount ?? 0,
        searchReady: Boolean(search360Result),
      });
      agentInput.agentStatusBar = statusBar.text;
      agentInput.agentStatusFields = statusBar.fields;
      const skills = selectAgentSkills({ agentId, claimType, maxSkills: 3 });
      const systemPrompt = `${agentConfig.systemPrompt}${formatSkillsForPrompt(skills)}`;
      agentInput.loadedSkills = skills.map((s) => s.id);
      const userContent = `${statusBar.text}\n\n${JSON.stringify(agentInput, null, 2)}`;

      let output: Record<string, unknown>;
      let modelUsed: string;
      try {
        const modelOverride =
          opts.modelChoice && typeof opts.modelChoice === "object"
            ? (opts.modelChoice as Record<string, { provider: string; model: string }>)[agentConfig.id]
            : undefined;
        const result = await callAgentWithFallback({
          agentId: agentConfig.id,
          systemPrompt,
          userContent,
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
          modelOverride: modelOverride as { provider: AgentTextProviderId; model: string } | undefined,
          options: { logger: console },
        });
        output = result.output;
        modelUsed = result.model;
        // Capture model wall-clock before SSE thought pacing (UI must show real think time).
        const modelLatencyMs = Date.now() - stepStart;
        // Real reasoning only: split + pace SSE so ThinkingReasoning can reveal sentence-by-sentence.
        if (opts.onThought && typeof result.reasoning === "string" && result.reasoning.trim()) {
          const sentences = splitReasoningSentences(result.reasoning);
          const gap = thoughtInterSentenceDelayMs(sentences.length);
          for (let index = 0; index < sentences.length; index++) {
            opts.onThought!(
              agentConfig.id,
              agentConfig,
              sentences[index],
              index,
              index === sentences.length - 1
            );
            if (index < sentences.length - 1) await sleepMs(gap);
          }
        }
        const step = {
          agent: agentConfig.id,
          agentName: agentConfig.name,
          agentIcon: agentConfig.icon,
          systemPrompt,
          input: agentInput,
          output,
          model: modelUsed,
          latencyMs: modelLatencyMs,
          timestamp: Date.now(),
          status: "completed" as const,
        };
        opts.onComplete?.(step);
        return step;
      } catch (error) {
        opts.onError?.(agentId, agentConfig, error);
        const message = error instanceof Error ? error.message : "Agent 调用失败";
        throw new Error(`${agentConfig.name} 真实模型调用失败：${message}`);
      }
    };
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

  function makeSelfProofCaller(claim: string, modelChoice: any) {
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) =>
      callAgentWithFallback({
        agentId: "rumor_detector_selfproof",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        codexBin,
        reasoningEffort: "low",
        modelOverride:
          modelChoice && modelChoice["rumor_detector"] ? modelChoice["rumor_detector"] : undefined,
        options: { logger: console },
      }).then((r) => ({ output: r.output, model: r.model }));
  }

  // Evidence loop 语义改写（ADR-004）：裸模型调用 → makeRewriteQueryCall 绑定 prompt/解析。
  // 失败回退确定性模板（evidenceLoop 内部处理），这里不需要 try/catch。
  function makeRewriteCaller(modelChoice: any) {
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) =>
      callAgentWithFallback({
        agentId: "evidence_loop_rewriter",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        codexBin,
        reasoningEffort: "low",
        modelOverride:
          modelChoice && modelChoice["fact_checker"] ? modelChoice["fact_checker"] : undefined,
        options: { logger: console },
      }).then((r) => ({ output: r.output, model: r.model }));
  }

  // Cross exam 第二意见（G3/P1）：国产优先、与主判 provider 不同源（真双模型交叉）。
  // 主判 = 主 provider order 的第一个可用项；候选里先挑异源，全同源才退回第一个可用。
  function pickCrossExamModel(
    modelChoice: any
  ): { provider: AgentTextProviderId; model: string } | undefined {
    if (modelChoice && modelChoice["cross_examiner"]) return modelChoice["cross_examiner"];
    const candidates: Array<{ provider: AgentTextProviderId; model: string; hasKey: boolean }> = [
      { provider: "stepfun", model: "step-3.7-flash", hasKey: Boolean(env.STEPFUN_API_KEY) },
      { provider: "minimax", model: "MiniMax-M3", hasKey: Boolean(env.MINIMAX_API_KEY || env.MINIMAX_TOKEN_PLAN_KEY) },
      { provider: "mimo", model: "mimo-v2.5-pro", hasKey: Boolean(env.MIMO_API_KEY) },
    ].filter((c) => c.hasKey) as Array<{ provider: AgentTextProviderId; model: string }>;
    if (candidates.length === 0) return undefined;
    const primary = providerOrderForAgent(env).find((p) => p !== "codex");
    return candidates.find((c) => c.provider !== primary) ?? candidates[0];
  }

  function makeCrossExamCaller(modelChoice: any, sendAgentEvent?: (data: object) => void) {
    const modelOverride = pickCrossExamModel(modelChoice);
    if (!modelOverride) return undefined;
    return (input: {
      systemPrompt: string;
      userContent: string;
      responseSchema: object;
      maxTokens: number;
    }) => {
      sendAgentEvent?.({
        type: "agent_start",
        agent: "cross_examiner",
        agentName: "CrossExaminer",
        query: "第二模型独立复核冲突证据",
        timestamp: Date.now(),
      });
      return callAgentWithFallback({
        agentId: "cross_examiner",
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        responseSchema: input.responseSchema,
        maxTokens: input.maxTokens,
        env,
        codexBin,
        reasoningEffort: "high",
        modelOverride,
        options: { logger: console },
      })
        .then((r) => {
          sendAgentEvent?.({
            type: "agent_complete",
            agent: "cross_examiner",
            agentName: "CrossExaminer",
            output: r.output,
            model: r.model,
            timestamp: Date.now(),
          });
          return { output: r.output, model: r.model };
        })
        .catch((error) => {
          sendAgentEvent?.({
            type: "agent_error",
            agent: "cross_examiner",
            agentName: "CrossExaminer",
            error: error instanceof Error ? error.message : "cross examiner failed",
            timestamp: Date.now(),
          });
          throw error;
        });
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

  function pipelineFinalize(ctx: {
    finalReport: Record<string, unknown>;
    claim: string;
    rumorStep: PipelineStep;
    factStep: PipelineStep;
    sourceStep: PipelineStep;
    search360Result: unknown;
  }) {
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
    const ticket = await gateFreeCheck(req, res);
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

      const runAgent = makeRunAgent({
        claim,
        modelChoice,
        intakeMetadata,
        visualExtraction,
        clientMemoryRecall,
      });

      const result = await runCasePipeline({
        claim,
        runAgent,
        searchOne: makeSearchOneAtom(),
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
        finalizeReport: pipelineFinalize,
        memoryCandidateStore: getMemoryCandidateStore(),
      });

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
    const ticket = await gateFreeCheck(req, res);
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

      const result = await runCasePipeline({
        claim,
        runAgent,
        searchOne: makeSearchOneAtom(),
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
        finalizeReport: pipelineFinalize,
        memoryCandidateStore: getMemoryCandidateStore(),
      });

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

    const isProd = process.env.NODE_ENV === "production";
    const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1");
    if (!baseUrl.startsWith("https://") && !(process.env.NODE_ENV !== "production" && isLocalhost)) {
      return sendJson(res, 400, {
        ok: false,
        error: "baseUrl 必须以 https:// 开头（dev 环境允许 http://localhost）",
      });
    }

    if (isProd && (await baseUrlTargetsPrivateNetwork(baseUrl))) {
      return sendJson(res, 400, {
        ok: false,
        error: "生产环境禁止 baseUrl 指向 loopback 或内网地址",
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
      });

      const latencyMs = Date.now() - startedAt;
      const rawText = await upstream.text();

      if (!upstream.ok) {
        return sendJson(res, 200, {
          ok: false,
          latencyMs,
          status: upstream.status,
          error: `上游返回 ${upstream.status}`,
        });
      }

      return sendJson(res, 200, {
        ok: true,
        latencyMs,
        status: upstream.status,
        echo: rawText.slice(0, 120),
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
  };
}

async function callLocalProvider({
  codexBin,
  model,
  payload,
  env,
}: {
  codexBin: string;
  model: string;
  payload: any;
  env: Record<string, string>;
}) {
  const errors: string[] = [];

  // DeepSeek 放在第一位，默认使用 v4pro，避免报告生成先被其它 provider 的 JSON/超时问题拖垮。
  const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  if (deepseekApiKey) {
    try {
      return await callDeepSeekApi({ apiKey: deepseekApiKey, baseUrl: deepseekBaseUrl, model: deepseekModel, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "DeepSeek API 调用失败");
    }
  }

  // MiMo Token Plan（Anthropic 兼容协议，多集群回退）
  const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
  const mimoModel = env.MIMO_MODEL || "mimo-v2.5-pro";
  const mimoClusters = [
    (env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
    "https://token-plan-sgp.xiaomimimo.com/anthropic",
    "https://token-plan-ams.xiaomimimo.com/anthropic",
  ];

  if (mimoApiKey) {
    for (const clusterUrl of mimoClusters) {
      try {
        return await callMimoApi({ baseUrl: clusterUrl, model: mimoModel, apiKey: mimoApiKey, payload });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MiMo API 调用失败";
        errors.push(`[${clusterUrl}] ${msg}`);
      }
    }
  }

  const anthropicConfig = await loadAnthropicConfig(env);
  if (anthropicConfig?.baseUrl && anthropicConfig.model) {
    try {
      return await callAnthropicProxy({ ...anthropicConfig, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic proxy 调用失败");
    }
  }

  try {
    return await callLocalCodex({ codexBin, model, payload });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Codex CLI 调用失败");
  }

  throw new Error(errors.join("；") || "没有可用的本地模型 provider");
}

async function callLocalProviderRecursive({
  codexBin,
  model,
  payload,
  env,
}: {
  codexBin: string;
  model: string;
  payload: any;
  env: Record<string, string>;
}) {
  const errors: string[] = [];

  // DeepSeek 放在第一位，默认使用 v4pro。
  const deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  if (deepseekApiKey) {
    try {
      return await callDeepSeekApiRecursive({ apiKey: deepseekApiKey, baseUrl: deepseekBaseUrl, model: deepseekModel, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "DeepSeek API 递归搜索调用失败");
    }
  }

  // MiMo Token Plan（多集群回退）
  const mimoApiKey = env.MIMO_API_KEY || process.env.MIMO_API_KEY;
  const mimoModel = env.MIMO_MODEL || "mimo-v2.5-pro";
  const mimoClusters = [
    (env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/anthropic").replace(/\/$/, ""),
    "https://token-plan-sgp.xiaomimimo.com/anthropic",
    "https://token-plan-ams.xiaomimimo.com/anthropic",
  ];

  if (mimoApiKey) {
    for (const clusterUrl of mimoClusters) {
      try {
        return await callMimoApiRecursive({ baseUrl: clusterUrl, model: mimoModel, apiKey: mimoApiKey, payload });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MiMo API 递归搜索调用失败";
        errors.push(`[${clusterUrl}] ${msg}`);
      }
    }
  }

  const anthropicConfig = await loadAnthropicConfig(env);
  if (anthropicConfig?.baseUrl && anthropicConfig.model) {
    try {
      return await callAnthropicProxyRecursive({ ...anthropicConfig, payload });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic proxy 递归搜索调用失败");
    }
  }

  try {
    return await callLocalCodexRecursive({ codexBin, model, payload });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Codex CLI 递归搜索调用失败");
  }

  throw new Error(errors.join("；") || "没有可用的本地模型 provider");
}

async function loadAnthropicConfig(env: Record<string, string>) {
  const explicitBaseUrl = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const explicitModel = env.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL;
  const explicitToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

  if (explicitBaseUrl && explicitModel) {
    return {
      baseUrl: explicitBaseUrl.replace(/\/$/, ""),
      model: explicitModel,
      token: explicitToken || "local",
    };
  }

  try {
    const raw = await readFile(join(homedir(), ".claude/settings.json"), "utf8");
    const settings = JSON.parse(raw);
    const claudeEnv = settings?.env ?? {};
    const baseUrl = claudeEnv.ANTHROPIC_BASE_URL;
    const model = claudeEnv.ANTHROPIC_MODEL;
    const token = claudeEnv.ANTHROPIC_AUTH_TOKEN || claudeEnv.ANTHROPIC_API_KEY || "local";

    if (typeof baseUrl === "string" && typeof model === "string") {
      return { baseUrl: baseUrl.replace(/\/$/, ""), model, token };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function callOpenAI({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是红鲱鱼与枪（信息真相猎人）的调度模型。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。判断当前节点哪些能信、哪些不能信，还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  const body: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: modeInstruction,
            claim: payload.claim,
            selectedNode: payload.node,
            userPrompt: payload.prompt,
            visibleNodeTitles: payload.visibleNodeTitles,
          },
          null,
          2,
        ),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "node_agent_expansion",
        strict: true,
        schema: responseSchema,
      },
    },
    max_output_tokens: 900,
  };

  if (payload.mode === "search") {
    body.tools = [{ type: "web_search" }];
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`OpenAI Responses API 调用失败：${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI Responses API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(text), model);
}

async function callOpenAIRecursive({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的调度模型。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明哪些能信、哪些不能信。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const body: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(buildRecursivePayload(payload), null, 2) },
    ],
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "recursive_evidence_search",
        strict: true,
        schema: recursiveResponseSchema,
      },
    },
    max_output_tokens: 1400,
  };

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`OpenAI Responses API 递归搜索失败：${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI Responses API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(text), model);
}

async function callAnthropicProxy({
  baseUrl,
  model,
  token,
  payload,
}: {
  baseUrl: string;
  model: string;
  token: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的调度模型。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": token,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildCodexPrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`本地 Anthropic proxy 调用失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("本地 Anthropic proxy 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(extractJsonObject(text)), `anthropic-local:${model}`);
}

async function callAnthropicProxyRecursive({
  baseUrl,
  model,
  token,
  payload,
}: {
  baseUrl: string;
  model: string;
  token: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的调度模型。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、能信和不能信。",
    "不要自动继续展开 frontier，不要给最终答案。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": token,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      system: systemPrompt,
      messages: [{ role: "user", content: buildRecursivePrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`本地 Anthropic proxy 递归搜索失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("本地 Anthropic proxy 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(extractJsonObject(text)), `anthropic-local:${model}`);
}

// ───────────────────────────────────────────────────────────────
// MiMo Token Plan API（Anthropic 兼容协议）
// ───────────────────────────────────────────────────────────────

async function callMimoApi({
  baseUrl,
  model,
  apiKey,
  payload,
}: {
  baseUrl: string;
  model: string;
  apiKey: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是红鲱鱼与枪（信息真相猎人）的调度模型。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildCodexPrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MiMo API 调用失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("MiMo API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(extractJsonObject(text)), `mimo:${model}`);
}

async function callMimoApiRecursive({
  baseUrl,
  model,
  apiKey,
  payload,
}: {
  baseUrl: string;
  model: string;
  apiKey: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是红鲱鱼与枪（信息真相猎人）的调度模型。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、能信和不能信。",
    "不要自动继续展开 frontier，不要给最终答案。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      system: systemPrompt,
      messages: [{ role: "user", content: buildRecursivePrompt(payload) }],
    }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MiMo API 递归搜索失败：${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error("MiMo API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(extractJsonObject(text)), `mimo:${model}`);
}

// ───────────────────────────────────────────────────────────────
// DeepSeek API（OpenAI Chat Completions 兼容协议）
// ───────────────────────────────────────────────────────────────

async function callDeepSeekApi({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是红鲱鱼与枪（信息真相猎人）的调度模型。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。判断当前节点哪些能信、哪些不能信，还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: modeInstruction,
              claim: payload.claim,
              selectedNode: payload.node,
              userPrompt: payload.prompt,
              visibleNodeTitles: payload.visibleNodeTitles,
            },
            null,
            2,
          ),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 900,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`DeepSeek API 调用失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("DeepSeek API 没有返回可解析文本。");

  return normalizeExpansionResult(JSON.parse(text), `deepseek:${model}`);
}

async function callDeepSeekApiRecursive({
  apiKey,
  baseUrl,
  model,
  payload,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  payload: any;
}) {
  const systemPrompt = [
    "你是溯证 Agent 的调度模型。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明哪些能信、哪些不能信。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(buildRecursivePayload(payload), null, 2) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1400,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`DeepSeek API 递归搜索失败：${detail}`);
  }

  const text = extractChatCompletionText(data);
  if (!text) throw new Error("DeepSeek API 没有返回可解析递归搜索文本。");

  return normalizeRecursiveResult(JSON.parse(text), `deepseek:${model}`);
}

function extractChatCompletionText(data: any) {
  return typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
}

async function callLocalCodex({
  codexBin,
  model,
  payload,
}: {
  codexBin: string;
  model: string;
  payload: any;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "suzheng-codex-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(responseSchema), "utf8");
    const prompt = buildCodexPrompt(payload);
    const args = [
      ...(payload.mode === "search" ? ["--search"] : []),
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-m",
      model,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      prompt,
    ];
    const timeout = Number(process.env.CODEX_LOCAL_TIMEOUT_MS || 180000);

    await execFileAsync(codexBin, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const raw = await readFile(outputPath, "utf8");
    return normalizeExpansionResult(JSON.parse(raw), `codex-local:${model}`);
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr.split("\n").slice(-4).join(" ") || error?.message || "未知错误";
    throw new Error(`本地 Codex 调用失败：${detail}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function callLocalCodexRecursive({
  codexBin,
  model,
  payload,
}: {
  codexBin: string;
  model: string;
  payload: any;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "suzheng-recursive-codex-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(recursiveResponseSchema), "utf8");
    const args = [
      "--search",
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-m",
      model,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      buildRecursivePrompt(payload),
    ];
    const timeout = Number(process.env.CODEX_LOCAL_TIMEOUT_MS || 180000);

    await execFileAsync(codexBin, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const raw = await readFile(outputPath, "utf8");
    return normalizeRecursiveResult(JSON.parse(raw), `codex-local:${model}`);
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr.split("\n").slice(-4).join(" ") || error?.message || "未知错误";
    throw new Error(`本地 Codex 递归搜索失败：${detail}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildCodexPrompt(payload: any) {
  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 Codex 的 web search 能力寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。判断当前节点哪些能信、哪些不能信，还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  return [
    "你是红鲱鱼与枪（信息真相猎人）的调度模型。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 为什么选择这个调度方向。",
    "- agentTitle / agentSubtitle: 被派出的子 Agent 名称和职责。",
    "- resultTitle / resultSubtitle / resultStatus: 接回 Canvas 的局部结果节点。",
    "- resultStatus 只能是 risk、active、supported、limited、blocked、rewrite 之一。",
    "- traceText: 左侧 Agent Trace 中的一句话。",
    "- inspectorSummary: 右侧 Inspector 对这次局部调用的总结。",
    "- canSay / cannotSay: 当前节点允许和禁止的表达。",
    "- sources: 如果联网或引用材料，写来源名或 URL；没有则返回空数组。",
    "",
    JSON.stringify(
      {
        task: modeInstruction,
        claim: payload.claim,
        selectedNode: payload.node,
        userPrompt: payload.prompt,
        visibleNodeTitles: payload.visibleNodeTitles,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildRecursivePayload(payload: any) {
  return {
    task: "围绕用户选择的 seed node 做一轮递归证据搜索。请搜索、提取线索、去重，并把下一步可扩展线索放入 frontier。不要自动继续下一层。",
    claim: payload.claim,
    seedNode: payload.seedNode,
    userQuestion: payload.question,
    depthLimit: payload.depthLimit,
    budgetLimit: payload.budgetLimit,
    visibleNodeTitles: payload.visibleNodeTitles,
    existingSources: payload.existingSources,
    outputRules: [
      "clues 是本轮发现的证据或上下文线索，最多 4 条。",
      "frontier 是值得用户下一步选择继续搜索的线索，最多 3 条。",
      "stopped 是不应继续扩展的线索，并说明停止原因。",
      "如果发现重复来源或重复观点，不要放入 clues，放入 stopped，reason=duplicate。",
      "canSay / cannotSay 必须围绕当前 seed node 的证据许可，不要给全局最终结论。",
    ],
  };
}

function buildRecursivePrompt(payload: any) {
  return [
    "你是溯证 Agent 的调度模型。",
    "用户在 Canvas 中选中一个节点，并要求从这里做递归证据搜索。",
    "你只做一轮：search -> extract -> normalize -> dedupe -> score -> frontier。",
    "不要自动继续展开 frontier。frontier 只是交给用户选择的下一步。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 为什么从这个节点启动递归搜索。",
    "- runTitle: 本轮递归搜索标题。",
    "- traceText: 左侧 Agent Trace 中的一句话。",
    "- clues: 本轮发现的证据线索，包含 title、summary、source、role、confidence。",
    "- frontier: 可继续扩展但等待用户选择的下一步线索。",
    "- stopped: 因重复、预算、低可信或越界而停止的线索。",
    "- canSay / cannotSay: 当前证据允许和禁止的表达。",
    "",
    JSON.stringify(buildRecursivePayload(payload), null, 2),
  ].join("\n");
}

function normalizeExpansionResult(raw: any, model: string) {
  const pickString = (key: string, fallback: string) => (typeof raw?.[key] === "string" && raw[key].trim() ? raw[key] : fallback);
  const pickArray = (key: string) => (Array.isArray(raw?.[key]) ? raw[key].filter((item: unknown) => typeof item === "string") : []);
  const status = typeof raw?.resultStatus === "string" && allowedStatuses.has(raw.resultStatus) ? raw.resultStatus : "limited";

  return {
    controllerNote: pickString("controllerNote", "已根据当前节点选择局部调度方向。"),
    agentTitle: pickString("agentTitle", "局部推理子 Agent"),
    agentSubtitle: pickString("agentSubtitle", "只处理当前节点上的局部追问。"),
    resultTitle: pickString("resultTitle", "局部推理结果"),
    resultSubtitle: pickString("resultSubtitle", "等待用户决定是否继续沿此分支发散。"),
    resultStatus: status,
    traceText: pickString("traceText", "我只在用户选中的节点上调用子 Agent，并把局部结果接回画布。"),
    inspectorSummary: pickString("inspectorSummary", "本次调用返回了当前节点的局部推理结果。"),
    canSay: pickArray("canSay"),
    cannotSay: pickArray("cannotSay"),
    sources: pickArray("sources"),
    model,
  };
}

function normalizeRecursiveResult(raw: any, model: string) {
  const pickString = (key: string, fallback: string) => (typeof raw?.[key] === "string" && raw[key].trim() ? raw[key] : fallback);
  const pickArray = (key: string) => (Array.isArray(raw?.[key]) ? raw[key] : []);
  const textArray = (key: string) => pickArray(key).filter((item: unknown) => typeof item === "string");
  const clueRoles = new Set(["support", "limit", "counter", "context", "lead"]);
  const confidenceValues = new Set(["low", "medium", "high"]);
  const valueLevels = new Set(["low", "medium", "high"]);
  const stoppedReasons = new Set(["duplicate", "budget", "low_confidence", "out_of_scope"]);

  return {
    controllerNote: pickString("controllerNote", "已从当前节点启动一轮递归证据搜索。"),
    runTitle: pickString("runTitle", "递归证据搜索"),
    traceText: pickString("traceText", "我从用户选择的节点出发，只生成本轮线索和下一批 frontier，等待用户继续选择。"),
    clues: pickArray("clues").slice(0, 4).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `clue-${index + 1}`),
      title: pickNestedString(item, "title", `证据线索 ${index + 1}`),
      summary: pickNestedString(item, "summary", "这是一条需要继续审计的证据线索。"),
      source: pickNestedString(item, "source", "未提供来源"),
      role: clueRoles.has(item?.role) ? item.role : "lead",
      confidence: confidenceValues.has(item?.confidence) ? item.confidence : "medium",
    })),
    frontier: pickArray("frontier").slice(0, 3).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `frontier-${index + 1}`),
      title: pickNestedString(item, "title", `下一步线索 ${index + 1}`),
      reasonToContinue: pickNestedString(item, "reasonToContinue", "这条线索可能帮助补足当前节点的证据边界。"),
      nextQuestion: pickNestedString(item, "nextQuestion", "继续检查这条线索能支持什么、不能支持什么。"),
      estimatedValue: valueLevels.has(item?.estimatedValue) ? item.estimatedValue : "medium",
    })),
    stopped: pickArray("stopped").slice(0, 3).map((item: any, index: number) => ({
      id: pickNestedString(item, "id", `stopped-${index + 1}`),
      title: pickNestedString(item, "title", `停止线索 ${index + 1}`),
      reason: stoppedReasons.has(item?.reason) ? item.reason : "low_confidence",
    })),
    canSay: textArray("canSay"),
    cannotSay: textArray("cannotSay"),
    model,
  };
}

function pickNestedString(item: any, key: string, fallback: string) {
  return typeof item?.[key] === "string" && item[key].trim() ? item[key] : fallback;
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;

  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("");
}

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
  res.end(JSON.stringify(body));
}

function getSearch360ApiKey(env: Record<string, string>) {
  return (
    env.QIHOO_360_API_KEY ||
    env.ZHINAO_API_KEY ||
    env.AI360_API_KEY ||
    process.env.QIHOO_360_API_KEY ||
    process.env.ZHINAO_API_KEY ||
    process.env.AI360_API_KEY ||
    ""
  );
}

function getTavilyApiKey(env: Record<string, string>) {
  return env.TAVILY_API_KEY || process.env.TAVILY_API_KEY || "";
}

function getMetasoApiKey(env: Record<string, string>) {
  return env.METASO_API_KEY || process.env.METASO_API_KEY || "";
}

function getExaApiKey(env: Record<string, string>) {
  return env.EXA_API_KEY || process.env.EXA_API_KEY || "";
}

function getAnySearchApiKey(env: Record<string, string>) {
  return env.ANYSEARCH_API_KEY || process.env.ANYSEARCH_API_KEY || "";
}

function getTimeoutMs(env: Record<string, string>, key: string, fallbackMs: number) {
  const raw = env[key] || process.env[key];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} 超时 ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getSearchFetchTimeoutMs(env: Record<string, string>) {
  return getTimeoutMs(env, "SEARCH_FETCH_TIMEOUT_MS", 10000);
}

function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "Parallel Search";
  if (result?._source === "anysearch-search") return "AnySearch";
  if (result?._source === "metaso-search") return "Metaso Search";
  if (result?._source === "tavily-search") return "Tavily Search";
  if (result?._source === "exa-search") return "Exa Search";
  if (result?._source === "360-mwebsearch") return "360 智搜";
  if (result?._source === "tool-error") return "Search Tool";
  return "Search";
}

function build360SearchFallback(query: string) {
  return {
    answer: "",
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: ["360 搜索服务未返回真实结果，系统不生成搜索摘要或证据判断。"],
    relatedQuestions: [],
    model: "demo-fallback:360",
    traceText: `360 搜索服务未返回真实结果：“${query}”暂不生成补充解释。`,
    _source: "demo-fallback",
  };
}

function build360SearchFailure(query: string, message: string) {
  return {
    answer: "",
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    unresolvedEvidenceGaps: [`360 搜索真实调用失败：${message}`],
    relatedQuestions: [],
    model: "360-ai-search:error",
    traceText: `360 搜索真实调用失败：“${query}”未产生可引用证据。原因：${message}`,
    _source: "tool-error",
  };
}

function buildReportEvidenceInputs(steps: any[], searchResult?: any) {
  const factStep = steps.find((step) => step.agent === "fact_checker");
  const sourceStep = steps.find((step) => step.agent === "source_validator");
  const sources = Array.isArray(searchResult?.sources)
    ? searchResult.sources.slice(0, 8).map((source: any, index: number) => ({
        ref: source?.id || `S${index + 1}`,
        title: source?.title || source?.name || `来源 ${index + 1}`,
        url: source?.url || source?.link || "",
        domain: source?.domain || source?.site || "",
        snippet: source?.snippet || source?.summary || source?.content || "",
        role: source?.evidenceRole || source?.role || "线索",
        credibility: source?.credibility || source?.credibilityScore || "",
      }))
    : [];

  return {
    searchSummary: {
      tool: getSearchToolName(searchResult),
      answer: typeof searchResult?.answer === "string" ? searchResult.answer.slice(0, 900) : "",
      sources,
      supportingEvidence: stringItems(searchResult?.supportingEvidence).slice(0, 5),
      contradictingEvidence: stringItems(searchResult?.contradictingEvidence).slice(0, 5),
      unresolvedEvidenceGaps: stringItems(searchResult?.unresolvedEvidenceGaps).slice(0, 5),
      relatedQuestions: stringItems(searchResult?.relatedQuestions).slice(0, 4),
    },
    factFindings: {
      result: factStep?.output?.factCheckResult ?? "unverified",
      confidence: factStep?.output?.confidence ?? "low",
      sources: stringItems(factStep?.output?.sources).slice(0, 6),
      keyFindings: stringItems(factStep?.output?.keyFindings).slice(0, 5),
      counterEvidence: stringItems(factStep?.output?.counterEvidence).slice(0, 5),
    },
    sourceAudit: {
      reliability: sourceStep?.output?.sourceReliability ?? "unverified",
      verifiedSources: stringItems(sourceStep?.output?.verifiedSources).slice(0, 5),
      questionableSources: stringItems(sourceStep?.output?.questionableSources).slice(0, 5),
      missingSources: stringItems(sourceStep?.output?.missingSources).slice(0, 5),
      notes: typeof sourceStep?.output?.verificationNotes === "string" ? sourceStep.output.verificationNotes.slice(0, 500) : "",
    },
  };
}

function compactSearchResultForAgent(searchResult: any) {
  const sources = Array.isArray(searchResult?.sources)
    ? searchResult.sources.slice(0, 8).map((source: any, index: number) => ({
        id: String(source?.id || `S${index + 1}`),
        title: String(source?.title || source?.name || `来源 ${index + 1}`).slice(0, 120),
        url: String(source?.url || source?.link || ""),
        domain: String(source?.domain || source?.site || ""),
        snippet: String(source?.condensedSnippet || source?.snippet || source?.summary || source?.content || "").slice(0, 450),
        credibility: source?.credibility || source?.credibilityScore || "",
        role: source?.evidenceRole || source?.role || "线索",
      }))
    : [];

  return {
    answer: typeof searchResult?.answer === "string" ? searchResult.answer.slice(0, 1800) : "",
    sources,
    supportingEvidence: stringItems(searchResult?.supportingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    contradictingEvidence: stringItems(searchResult?.contradictingEvidence).slice(0, 4).map((item) => item.slice(0, 240)),
    unresolvedEvidenceGaps: stringItems(searchResult?.unresolvedEvidenceGaps).slice(0, 4).map((item) => item.slice(0, 240)),
    relatedQuestions: stringItems(searchResult?.relatedQuestions).slice(0, 4),
    model: String(searchResult?.model || ""),
    traceText: String(searchResult?.traceText || "").slice(0, 700),
    _source: searchResult?._source || "search",
  };
}

async function runReportComposerWithFallback({
  claim,
  steps,
  search360Result,
  runAgent,
  onFallback,
}: {
  claim: string;
  steps: any[];
  search360Result: any;
  runAgent: (agentId: string, steps: any[], search360Result?: any) => Promise<any>;
  onFallback?: (step: any) => void;
}) {
  try {
    return await runAgent("report_composer", steps, search360Result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ReportComposer 调用失败";
    const startedAt = Date.now();
    const fallbackStep = {
      agent: "report_composer",
      agentName: "ReportComposer",
      agentIcon: "📝",
      systemPrompt: "deterministic fallback report",
      input: {
        claim,
        fallbackReason: message,
      },
      output: buildDeterministicFinalReport(claim, steps, search360Result, message),
      model: "fallback:deterministic-report",
      latencyMs: Date.now() - startedAt,
      timestamp: Date.now(),
      status: "completed",
    };
    onFallback?.(fallbackStep);
    return fallbackStep;
  }
}

export function buildDeterministicFinalReport(claim: string, steps: any[], searchResult: any, reason: string) {
  const rumorStep = steps.find((step) => step.agent === "rumor_detector");
  const factStep = steps.find((step) => step.agent === "fact_checker");
  const sourceStep = steps.find((step) => step.agent === "source_validator");
  const factResult = String(factStep?.output?.factCheckResult || "unverified");
  const sourceReliability = String(sourceStep?.output?.sourceReliability || "unverified");
  const keyFindings = stringItems(factStep?.output?.keyFindings);
  const counterEvidence = stringItems(factStep?.output?.counterEvidence);
  const verifiedSources = stringItems(sourceStep?.output?.verifiedSources);
  const questionableSources = stringItems(sourceStep?.output?.questionableSources);
  const missingSources = stringItems(sourceStep?.output?.missingSources);
  const searchSources = Array.isArray(searchResult?.sources) ? searchResult.sources.slice(0, 5) : [];
  const searchGaps = stringItems(searchResult?.unresolvedEvidenceGaps);
  const hasCounterEvidence = counterEvidence.length > 0 || stringItems(searchResult?.contradictingEvidence).length > 0;
  const hasMissingSources = missingSources.length > 0 || searchGaps.length > 0;
  const verdictType =
    factResult === "true" && !hasCounterEvidence && sourceReliability !== "low"
      ? "true"
      : factResult === "false"
        ? "false"
        : factResult === "partial" || hasCounterEvidence
          ? "mixed_misleading"
          : "unverified";
  // 审查 P2-2 修复：fallback 路径也调用 computeFormulaScore，
  // 让 rumor severity / missingSources / search evidence 等分量真正生效；
  // label 统一引用 labelForScore（基于 SCORE_LABELS），与公式路径一致。
  // computeFormulaScore 失败返回 null 时再退回 verdictType→固定分数兜底。
  const fallbackFormula = computeFormulaScore(
    rumorStep?.output,
    factStep?.output,
    sourceStep?.output,
    searchResult
  );
  const credibilityScore = fallbackFormula
    ? fallbackFormula.score
    : verdictType === "true" ? 72 :
      verdictType === "false" ? 18 :
      verdictType === "mixed_misleading" ? 45 :
      36;
  const credibilityLabel = fallbackFormula
    ? fallbackFormula.label
    : labelForScore(credibilityScore);
  const firstFinding = keyFindings[0] || String(searchResult?.answer || "").slice(0, 160) || "当前证据不足以直接确认原始说法。";
  const missingText = [...missingSources, ...searchGaps].slice(0, 2).join("；") || "仍需要更权威或原始来源复核。";
  const conclusion =
    verdictType === "true"
      ? `当前证据较支持该说法，但仍需保留来源边界：${firstFinding}`
      : verdictType === "false"
        ? `当前证据不支持该说法。`
        : verdictType === "mixed_misleading"
          ? `该说法只能信一部分：有真实片段，也有夸大或偷换。`
          : `该说法目前还查不清。`;

  const report: Record<string, unknown> = {
    verdictType,
    conclusion,
    credibilityScore,
    credibilityLabel,
    recommendation: hasMissingSources
      ? "还查不清。先把出处补上，再判断能不能信。"
      : "按现有证据判断能不能信，并标出查不清的部分。",
    summaryForPublic: `${conclusion} 本报告由兜底生成，因为最终写作模型未在服务时间内完成。`,
    whyHardToVerify: [
      reason.slice(0, 220),
      missingText,
      "搜索结果和 Agent 输出只能作为核查线索，不能替代原始材料或权威发布。",
    ],
    evidenceChain: [
      {
        layer: "原始命题",
        finding: claim.slice(0, 220),
        evidence: stringItems(rumorStep?.output?.rumorIndicators).slice(0, 3).join("；") || "未检测到足够明确的结构化谣言特征。",
        boundary: "这一步只识别表达风险，不直接判定真假。",
        sourceRefs: ["RumorDetector"],
      },
      {
        layer: "事实核查",
        finding: firstFinding,
        evidence: keyFindings.slice(0, 3).join("；") || "FactChecker 未返回足够关键发现。",
        boundary: "事实核查结果需要结合来源可靠性一起解释。",
        sourceRefs: ["FactChecker"],
      },
      {
        layer: "信源审计",
        finding: verifiedSources[0] || questionableSources[0] || missingText,
        evidence: [...verifiedSources, ...questionableSources].slice(0, 3).join("；") || "缺少可直接采信的信源列表。",
        boundary: "有来源线索不等于来源已被确认为权威。",
        sourceRefs: ["SourceValidator"],
      },
      {
        layer: "搜索来源",
        finding: searchSources[0]?.title || "搜索服务返回的来源有限。",
        evidence: searchSources.map((source: any, index: number) => `${index + 1}. ${source?.title || source?.url || "未命名来源"}`).join("；"),
        boundary: "搜索摘要只能提供交叉验证线索，不能单独推出最终事实。",
        sourceRefs: searchSources.map((source: any, index: number) => String(source?.url || source?.title || `S${index + 1}`)),
      },
      {
        layer: "结论边界",
        finding: conclusion,
        evidence: [...counterEvidence, ...searchGaps].slice(0, 3).join("；") || missingText,
        boundary: "最终写作模型超时，因此本结论采用保守兜底。",
        sourceRefs: ["FallbackReport"],
      },
    ],
    causalBoundary: "本次核查只能判断公开材料对原命题的支持程度，不能推出未被来源覆盖的因果、医学或政策结论。",
    closureActions: [
      {
        type: "archive_doubt",
        label: "保存证据边界",
        content: missingText,
        status: "ready",
      },
      {
        type: "follow_up",
        label: "补查原始来源",
        content: "优先寻找官方发布、原始研究、专业机构说明或当事方一手材料。",
        status: hasMissingSources ? "needs_review" : "ready",
      },
      {
        type: "share_public",
        label: "能信的部分",
        content: "只说证据已经撑住的部分，查不清的不要说成已经核实。",
        status: "needs_review",
      },
    ],
    confidenceDimensions: [
      buildConfidenceDimension("source_reliability", "来源可靠性", sourceReliability === "high" ? 78 : sourceReliability === "medium" ? 62 : 42, 70, sourceReliability === "high", sourceReliability),
      buildConfidenceDimension("evidence_completeness", "证据完整度", hasMissingSources ? 45 : 66, 60, !hasMissingSources, missingText),
      buildConfidenceDimension("consistency", "逻辑一致性", hasCounterEvidence ? 55 : 72, 75, !hasCounterEvidence, hasCounterEvidence ? "存在反证或冲突线索" : "未发现明显冲突"),
      buildConfidenceDimension("recency", "信息时效性", searchSources.length > 0 ? 58 : 35, 50, searchSources.length > 0, "以当前搜索返回为准"),
      buildConfidenceDimension("authority", "权威匹配度", verifiedSources.length > 0 ? 62 : 38, 65, verifiedSources.length > 0, verifiedSources[0] || "缺少明确权威来源"),
    ],
    _fallbackReason: reason,
    ...(fallbackFormula
      ? {
          _scoreSource: "formula",
          _scoreBreakdown: fallbackFormula.breakdown,
        }
      : {}),
  };

  // 排除层落库闸门：subclaimVerdicts 只覆盖可核查原子，不可核查原子单独进 nonVerifiableAtoms
  applyExclusionLayerToReport(report, rumorStep, factStep?.output?.subclaimVerdicts, searchResult?.sources);

  // Same A+F path as live LLM reports
  applyFactDeskPostProcessToReport(report, claim);
  return report;
}

function buildConfidenceDimension(
  dimension: string,
  label: string,
  score: number,
  threshold: number,
  passed: boolean,
  reason: string
) {
  return { dimension, label, score, threshold, passed, reason };
}

function buildConsensusDebate(factStep: any, sourceStep: any, searchResult?: any) {
  const factCounterEvidence = stringItems(factStep?.output?.counterEvidence);
  const contradictingSources = stringItems(factStep?.output?.contradictingSources);
  const questionableSources = stringItems(sourceStep?.output?.questionableSources);
  const missingSources = stringItems(sourceStep?.output?.missingSources);
  const searchGaps = stringItems(searchResult?.unresolvedEvidenceGaps);
  const conflicts = [
    ...factCounterEvidence,
    ...contradictingSources,
    ...questionableSources,
    ...missingSources,
    ...searchGaps,
  ];

  if (conflicts.length === 0) {
    return {
      id: `debate-${Date.now()}`,
      status: "not_needed",
      title: "未发现需要调解的智能体冲突",
      conflictCount: 0,
      rounds: [],
      finalConsensus: "FactChecker 与 SourceValidator 没有返回显著冲突，ReportComposer 可以直接按证据边界收束。",
      confidenceAdjustment: 0,
    };
  }

  const sourceChallenges = [...questionableSources, ...missingSources, ...searchGaps].slice(0, 2);
  const factResponses = [...factCounterEvidence, ...contradictingSources].slice(0, 2);
  const roundCount = Math.max(sourceChallenges.length, factResponses.length, 1);
  const rounds = Array.from({ length: roundCount }, (_, index) => ({
    challenger: "SourceValidator",
    respondent: "FactChecker",
    challenge: sourceChallenges[index] || "信源层提示：当前材料只能支持局部事实，不能直接推出强结论。",
    response: factResponses[index] || "事实层已记录反证或未解决缺口，需要降低结论强度。",
  }));

  return {
    id: `debate-${Date.now()}`,
    status: "resolved",
    title: "智能体冲突调解室",
    conflictCount: conflicts.length,
    rounds,
    finalConsensus: "进入收束前，将高风险断言降级为证据允许的谨慎表达，并把缺失来源保留为后续追查问题。",
    confidenceAdjustment: Math.max(-18, -4 * Math.min(conflicts.length, 4)),
  };
}

function stringItems(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 360 检索（生产唯一路径）。
 * 2026-08-06 实测：`/v1/search/aisearch` 持续 18–25s 超时，已下线该路径，
 * 仅保留可用的 `/v2/mwebsearch`（含 trusted_sources / exclude_aigc）。
 */
async function call360AiSearch({
  env,
  query,
  model: _model,
  refProm,
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
}) {
  const apiKey = getSearch360ApiKey(env);
  if (!apiKey) throw new Error("未配置 360 API key");
  return await call360MWebSearch({ env, apiKey, query, refProm });
}

type SearchProviderId = "360_search" | "any_search" | "metaso_search" | "tavily_search" | "exa_search";

async function callSearchProvider({
  env,
  provider,
  query,
  model,
  refProm,
}: {
  env: Record<string, string>;
  provider: string;
  query: string;
  model?: string;
  refProm?: string;
}) {
  switch (provider) {
    case "360_search":
      return await call360AiSearch({ env, query, model, refProm });
    case "any_search":
      return await callAnySearchSearch({ env, query });
    case "metaso_search":
      return await callMetasoSearch({ env, query });
    case "tavily_search":
      return await callTavilySearch({ env, query });
    case "exa_search":
      return await callExaSearch({ env, query });
    default:
      throw new Error(`未知搜索 Provider：${provider}`);
  }
}

async function callSearchProviderWithTimeout({
  env,
  provider,
  query,
  model,
  refProm,
}: {
  env: Record<string, string>;
  provider: SearchProviderId;
  query: string;
  model?: string;
  refProm?: string;
}) {
  return await withTimeout(
    callSearchProvider({ env, provider, query, model, refProm }),
    getTimeoutMs(env, "SEARCH_PROVIDER_TIMEOUT_MS", 25000),
    getProviderLabel(provider)
  );
}

async function callParallelSearchProviders({
  env,
  query,
  model,
  refProm,
}: {
  env: Record<string, string>;
  query: string;
  model?: string;
  refProm?: string;
}) {
  const providers: SearchProviderId[] = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      provider,
      result: await callSearchProviderWithTimeout({ env, provider, query, model, refProm }),
    }))
  );

  const successes: Array<{ provider: SearchProviderId; result: any }> = [];
  const failures: string[] = [];
  settled.forEach((item, index) => {
    const provider = providers[index];
    if (item.status === "fulfilled") {
      successes.push(item.value);
    } else {
      const message = item.reason instanceof Error ? item.reason.message : `${provider} 未返回真实结果`;
      failures.push(`${getProviderLabel(provider)} 真实调用失败：${message}`);
    }
  });

  if (successes.length === 0) {
    throw new Error(failures.join("；") || "所有搜索 Provider 均未返回真实结果");
  }

  const sources = successes.flatMap(({ result }) => result.sources ?? []);
  const has360Success = successes.some(({ provider }) => provider === "360_search");
  const providerSummary = successes
    .map(({ provider, result }) => `${getProviderLabel(provider)} ${result.sources?.length ?? 0} 条`)
    .join("，");
  return {
    answer: successes
      .map(({ provider, result }) => `【${getProviderLabel(provider)}】${result.answer || result.traceText || "已返回真实来源"}`)
      .join("\n\n"),
    sources,
    unresolvedEvidenceGaps: failures,
    relatedQuestions: Array.from(new Set(successes.flatMap(({ result }) => result.relatedQuestions ?? []))).slice(0, 8),
    model: successes.map(({ result }) => result.model).filter(Boolean).join(" + "),
    traceText: `${has360Success ? "并行检索含 360 智搜(mweb)" : "360 智搜未返回可用结果，已用其它源交叉"}：${providerSummary}。${failures.length ? `失败：${failures.join("；")}` : ""}`,
    _source: "parallel-search",
  };
}

/** Production per-atom search: recipe + accepted reuse query, then merge URLs. */
export async function retrieveAtomSources(
  env: Record<string, string>,
  atom: string,
  reuseHits?: MemoryCandidateHit[]
) {
  const queries = buildQueriesWithReuse(atom, reuseHits ?? []);
  const settled = await Promise.allSettled(
    queries.map((query) => callParallelSearchProviders({ env, query }))
  );
  const ok: Record<string, unknown>[] = [];
  const failures: string[] = [];
  settled.forEach((item, index) => {
    if (item.status === "fulfilled") {
      ok.push(item.value as Record<string, unknown>);
      return;
    }
    const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
    failures.push(`${queries[index]}：${message}`);
  });
  if (ok.length === 0) {
    return build360SearchFailure(atom, failures.join("；") || "检索未返回真实结果");
  }
  const merged = mergeParallelSearchPayloads(atom, ok);
  if (failures.length > 0) {
    const gaps = Array.isArray(merged.unresolvedEvidenceGaps)
      ? merged.unresolvedEvidenceGaps.filter((g): g is string => typeof g === "string")
      : [];
    merged.unresolvedEvidenceGaps = [...gaps, ...failures].slice(0, 8);
  }
  return merged;
}

function getProviderLabel(provider: SearchProviderId | string) {
  const labels: Record<string, string> = {
    "360_search": "360 Search",
    any_search: "AnySearch",
    metaso_search: "Metaso Search",
    tavily_search: "Tavily Search",
    exa_search: "Exa Search",
  };
  return labels[provider] ?? provider;
}

async function callAnySearchSearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getAnySearchApiKey(env);
  const response = await fetchWithTimeout("https://api.anysearch.com/mcp", {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query,
          max_results: Number(env.ANYSEARCH_MAX_RESULTS || process.env.ANYSEARCH_MAX_RESULTS || 6),
          zone: env.ANYSEARCH_ZONE || process.env.ANYSEARCH_ZONE || "cn",
        },
      },
    }),
  }, getSearchFetchTimeoutMs(env), "AnySearch");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`AnySearch 调用失败：${detail}`);
  }
  if (data?.error) {
    const detail = data.error?.message || JSON.stringify(data.error);
    throw new Error(`AnySearch 调用失败：${detail}`);
  }

  return normalizeAnySearchResponse(data, query);
}

async function callTavilySearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getTavilyApiKey(env);
  if (!apiKey) throw new Error("未配置 Tavily API key");

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: env.TAVILY_SEARCH_DEPTH || process.env.TAVILY_SEARCH_DEPTH || "basic",
      max_results: Number(env.TAVILY_MAX_RESULTS || process.env.TAVILY_MAX_RESULTS || 6),
      include_answer: true,
      include_raw_content: false,
      include_favicon: true,
      include_usage: true,
    }),
  }, getSearchFetchTimeoutMs(env), "Tavily Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error || data?.message || response.statusText;
    throw new Error(`Tavily Search 调用失败：${detail}`);
  }

  return normalizeTavilySearchResponse(data, query);
}

async function callMetasoSearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getMetasoApiKey(env);
  if (!apiKey) throw new Error("未配置 Metaso API key");

  const scope = env.METASO_SEARCH_SCOPE || process.env.METASO_SEARCH_SCOPE || "webpage";
  const response = await fetchWithTimeout("https://metaso.cn/api/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      scope,
      size: Number(env.METASO_SEARCH_SIZE || process.env.METASO_SEARCH_SIZE || 10),
      includeSummary: true,
      includeRawContent: false,
      conciseSnippet: true,
    }),
  }, getSearchFetchTimeoutMs(env), "Metaso Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || response.statusText;
    throw new Error(`Metaso Search 调用失败：${detail}`);
  }
  if (data?.errCode || data?.code) {
    const detail = data?.errMsg || data?.message || data?.error || `错误码 ${data.errCode || data.code}`;
    throw new Error(`Metaso Search 调用失败：${detail}`);
  }

  return normalizeMetasoSearchResponse(data, query, scope);
}

async function callExaSearch({
  env,
  query,
}: {
  env: Record<string, string>;
  query: string;
}) {
  const apiKey = getExaApiKey(env);
  if (!apiKey) throw new Error("未配置 Exa API key");

  const type = env.EXA_SEARCH_TYPE || process.env.EXA_SEARCH_TYPE || "auto";
  const response = await fetchWithTimeout("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type,
      numResults: Number(env.EXA_MAX_RESULTS || process.env.EXA_MAX_RESULTS || 6),
      // 2026 Exa docs：highlights 作主摘要（省 token）；text 短截断作兜底
      contents: {
        highlights: true,
        text: { maxCharacters: 800 },
      },
    }),
  }, getSearchFetchTimeoutMs(env), "Exa Search");

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || response.statusText;
    throw new Error(`Exa Search 调用失败：${detail}`);
  }

  return normalizeExaSearchResponse(data, query, type);
}

async function callFallbackSearchProviders({
  env,
  query,
  failures,
}: {
  env: Record<string, string>;
  query: string;
  failures: string[];
}) {
  const errors = [...failures];
  const providers = [
    { label: "Metaso Search", call: () => callMetasoSearch({ env, query }) },
    { label: "Tavily Search", call: () => callTavilySearch({ env, query }) },
    { label: "Exa Search", call: () => callExaSearch({ env, query }) },
  ];

  for (const provider of providers) {
    try {
      const result: any = await provider.call();
      return {
        ...result,
        unresolvedEvidenceGaps: [
          ...errors.map((message) => `${message}，已尝试切换备用搜索。`),
          ...(result.unresolvedEvidenceGaps ?? []),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider.label} 未返回真实结果`;
      errors.push(`${provider.label} 真实调用失败：${message}`);
    }
  }

  throw new Error(errors.join("；"));
}

function normalizeTavilySearchResponse(data: any, query: string) {
  const rawItems = Array.isArray(data?.results) ? data.results : [];
  // Tavily: content 字段即摘要
  const items = rawItems.map((s: any) => ({
    ...s,
    snippet: s?.content || s?.raw_content || s?.snippet,
  }));
  const sources = mapProviderSources(items, (i) => `Tavily 来源 ${i}`);

  return {
    answer: String(data?.answer || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `tavily-search:${data?.auto_parameters?.search_depth || "basic"}`,
    traceText: `Tavily Search 返回 ${sources.length} 条可追溯来源，请求 ID：${data?.request_id || "unknown"}。`,
    _source: "tavily-search",
  };
}

function normalizeMetasoSearchResponse(data: any, query: string, scope: string) {
  const rawItems =
    data?.results ||
    data?.items ||
    data?.list ||
    data?.data?.results ||
    data?.data?.items ||
    data?.data?.list ||
    data?.data?.webpages ||
    data?.webpages ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sources = mapProviderSources(items, (i) => `Metaso 来源 ${i}`);

  return {
    answer: String(data?.answer || data?.summary || data?.data?.answer || data?.data?.summary || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Metaso Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `metaso-search:${scope}`,
    traceText: `Metaso Search 返回 ${sources.length} 条可追溯来源。`,
    _source: "metaso-search",
  };
}

function normalizeAnySearchResponse(data: any, query: string) {
  const text = String(
    data?.result?.content?.find?.((item: any) => item?.type === "text")?.text ||
    data?.result?.content?.[0]?.text ||
    ""
  );
  const rawItems = parseAnySearchMarkdownResults(text);
  const sources = mapProviderSources(rawItems, (i) => `AnySearch 来源 ${i}`);

  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n") || text,
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["AnySearch 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: "anysearch:mcp-search",
    traceText: `AnySearch 返回 ${sources.length} 条可追溯来源。`,
    _source: "anysearch-search",
  };
}

function parseAnySearchMarkdownResults(text: string) {
  const sections = text.split(/\n###\s+\d+\.\s+/).slice(1);
  return sections.map((section) => {
    const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = lines[0] ?? "";
    const urlLine = lines.find((line) => line.startsWith("- **URL**:"));
    const url = urlLine?.replace("- **URL**:", "").trim() ?? "";
    const dateLine = lines.find((line) => /^date:/i.test(line));
    const publishedAt = dateLine?.replace(/^date:/i, "").trim() ?? "";
    const snippet = lines
      .filter((line) => !line.startsWith("- **URL**:") && !/^date:/i.test(line))
      .slice(1)
      .join(" ")
      .replace(/^-\s*/, "")
      .trim();
    return { title, url, snippet, publishedAt };
  }).filter((item) => item.title || item.url || item.snippet);
}

function normalizeExaSearchResponse(data: any, query: string, type: string) {
  const rawItems = Array.isArray(data?.results) ? data.results : [];
  // Exa 2026 docs 推荐 highlights 作摘要；text 作全文补充
  const items = rawItems.map((s: any) => ({
    ...s,
    snippet:
      (Array.isArray(s?.highlights) ? s.highlights.filter(Boolean).join(" ") : "") ||
      s?.summary ||
      s?.text ||
      "",
  }));
  const sources = mapProviderSources(items, (i) => `Exa 来源 ${i}`);

  return {
    answer: String(data?.context || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Exa Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `exa-search:${data?.searchType || type}`,
    traceText: `Exa Search 返回 ${sources.length} 条可追溯来源，请求 ID：${data?.requestId || "unknown"}。`,
    _source: "exa-search",
  };
}

async function call360MWebSearch({
  env,
  apiKey,
  query,
  refProm,
}: {
  env: Record<string, string>;
  apiKey: string;
  query: string;
  refProm?: string;
}) {
  const selectedRefProm =
    refProm ||
    env.SEARCH360_REF_PROM ||
    process.env.SEARCH360_REF_PROM ||
    "aiso-max";
  const url = new URL("https://api.360.cn/v2/mwebsearch");
  url.searchParams.set("q", query);
  url.searchParams.set("ref_prom", selectedRefProm);
  url.searchParams.set("sid", randomUUID());
  url.searchParams.set("count", "8");
  url.searchParams.set("summary_len", "500");
  url.searchParams.set("freshness", "1");
  // 提供方侧轻度控噪：偏可信源、尽量排除 AIGC 页（非全量质量保证）
  url.searchParams.set("trusted_sources", "1");
  url.searchParams.set("exclude_aigc", "true");

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }, getSearchFetchTimeoutMs(env), `360 智搜 ${selectedRefProm}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`360 智搜 ${selectedRefProm} 调用失败：${detail}`);
  }
  if (data?.errno != null && Number(data.errno) !== 0) {
    throw new Error(`360 智搜 ${selectedRefProm} 调用失败：${data?.message || `errno ${data.errno}`}`);
  }

  return normalize360MWebSearchResponse(data, query, selectedRefProm);
}

/** 域名启发式：粗标可信度。不是权威鉴定，只减少「按排名瞎标高」的误导。 */
function estimateSourceCredibility(url: string): string {
  if (!url) return "未知";
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (
      host.endsWith(".gov.cn") ||
      host.endsWith(".edu.cn") ||
      /\.(gov|edu)$/.test(host) ||
      host.endsWith(".gov") ||
      host.endsWith(".edu") ||
      /(who\.int|nih\.gov|cdc\.gov|fda\.gov|nature\.com|science\.org|thelancet\.com|bmj\.com|cas\.cn|chinacdc\.cn|xinhuanet\.com|people\.com\.cn|cctv\.com)$/.test(host) ||
      host.includes("wikipedia.org")
    ) {
      return "高";
    }
    if (
      /(weixin\.qq\.com|zhihu\.com|baidu\.com|toutiao\.com|xiaohongshu\.com|douyin\.com|weibo\.com|bilibili\.com|sohu\.com|netease\.com|qq\.com)$/.test(host) ||
      host.includes("mp.weixin")
    ) {
      return "低";
    }
  } catch {
    return "未知";
  }
  return "中";
}

function mapProviderSources(
  items: any[],
  titleFallback: (index: number) => string
): Array<{ title: string; url: string; snippet: string; credibility: string }> {
  const out: Array<{ title: string; url: string; snippet: string; credibility: string }> = [];
  for (let index = 0; index < items.length && out.length < 8; index += 1) {
    const source = items[index];
    if (!source || typeof source !== "object") continue;
    const url = String(source?.url || source?.link || source?.href || source?.web_url || source?.display_url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue; // 无有效 URL = 不可追溯，直接丢
    out.push({
      title: String(source?.title || source?.name || source?.site_name || titleFallback(out.length + 1)).slice(0, 200),
      url,
      snippet: String(
        source?.summary_ai ||
          source?.summary ||
          source?.snippet ||
          source?.content ||
          source?.text ||
          source?.description ||
          source?.desc ||
          ""
      ).slice(0, 500),
      credibility: estimateSourceCredibility(url),
    });
  }
  return out;
}

function normalize360MWebSearchResponse(data: any, query: string, refProm: string) {
  const rawItems =
    data?.items ||
    data?.results ||
    data?.data?.items ||
    data?.data?.results ||
    data?.data?.list ||
    data?.result ||
    data?.data ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sources = mapProviderSources(items, (i) => `360 智搜来源 ${i}`);
  const answer = sources.length > 0
    ? sources.map((source) => `【${source.title}】${source.snippet}`).filter(Boolean).join("\n")
    : `360 智搜已返回“${query}”的检索响应，但未解析到可追溯来源。`;

  return {
    answer,
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `360-mwebsearch:${refProm}`,
    traceText: `360 智搜 ${refProm} 返回 ${sources.length} 条可追溯来源（已跳过失效 aisearch）。`,
    _source: "360-mwebsearch",
  };
}

function buildDemoConfidenceDimensions() {
  return [
    { dimension: "source_reliability", label: "来源可靠性", score: 0, threshold: 70, passed: false, reason: "服务未返回真实信源。" },
    { dimension: "evidence_completeness", label: "证据完整度", score: 0, threshold: 60, passed: false, reason: "服务未返回真实证据。" },
    { dimension: "consistency", label: "逻辑一致性", score: 0, threshold: 75, passed: false, reason: "没有真实 Agent 输出可供合成。" },
    { dimension: "recency", label: "信息时效性", score: 0, threshold: 50, passed: false, reason: "没有真实搜索结果可判断时效性。" },
    { dimension: "authority", label: "权威匹配度", score: 0, threshold: 65, passed: false, reason: "没有真实权威来源。" },
  ];
}

// callAgentWithFallback / 6 个 callXxxAgent 已抽到 ./lib/providerRouter.js

function buildOrchestrateDemoFallback(agentId: string, claim: string, agentInput?: Record<string, any>) {
  const fallbacks: Record<string, Record<string, unknown>> = {
    rumor_detector: {
      _source: "demo-fallback",
      claimAtoms: [],
      rumorTypes: [],
      rumorIndicators: [],
      severity: "low",
      analysis: "谣言特征检测模型未返回真实结果，系统不生成判断。",
      detectedPatterns: [],
      neededEvidence: ["需要真实模型拆题后才能生成证据需求。"],
      handoffTargets: ["fact_checker", "source_validator"],
    },
    fact_checker: {
      _source: "demo-fallback",
      factCheckResult: "unverified",
      confidence: "low",
      sources: [],
      supportingEvidence: [],
      contradictingSources: [],
      keyFindings: [],
      counterEvidence: [],
      unresolvedEvidenceGaps: ["事实核查模型未返回真实结果，系统不生成事实判断。"],
    },
    source_validator: {
      _source: "demo-fallback",
      sourceReliability: "unverified",
      verifiedSources: [],
      questionableSources: [],
      missingSources: [],
      verificationNotes: "信源验证模型未返回真实结果，系统不生成信源判断。",
    },
    report_composer: {
      _source: "demo-fallback",
      conclusion: "报告生成模型未返回真实结果，系统不生成核查结论。",
      credibilityScore: 0,
      credibilityLabel: "未出结论",
      recommendation: "请在模型和搜索服务返回真实结果后再查看核查报告。",
      summaryForPublic: "本次运行没有生成可发布结论。",
      confidenceDimensions: buildDemoConfidenceDimensions(),
    },
  };

  if (agentId === "report_composer" && agentInput) {
    return buildReportComposerFallbackFromInput(agentInput);
  }

  return fallbacks[agentId] ?? {};
}

function buildReportComposerFallbackFromInput(agentInput: Record<string, any>) {
  return {
    _source: "demo-fallback",
    _basis: "no-model-output",
    conclusion: "报告生成模型未返回真实结果，系统不生成核查结论。",
    credibilityScore: 0,
    credibilityLabel: "未出结论",
    recommendation: "请查看前序 Agent 的原始输出；如果前序输出也来自兜底，本次运行不可用于判断真伪。",
    summaryForPublic: "本次运行没有生成可发布结论。",
    confidenceDimensions: buildDemoConfidenceDimensions(),
    sourceReliability: agentInput.sourceValidation?.reliability ?? "unverified",
  };
}

// ───────────────────────────────────────────────────────────────
// Demo Fallback — ensures the hackerthon demo never breaks
// when no API key is configured or LLM providers are unavailable
// ───────────────────────────────────────────────────────────────

function buildDemoFallback(payload: any) {
  const mode = payload.mode as string;
  const nodeTitle = payload.node?.title ?? "当前节点";
  const labels: Record<string, string> = {
    search: "Searcher 子 Agent",
    evidence_audit: "Grader 子 Agent",
    counter: "Counter 子 Agent",
    rewrite: "Composer 子 Agent",
  };

  return {
    controllerNote: `用户对"${nodeTitle}"发起 ${mode}，但 Agent 服务未返回真实结果。`,
    agentTitle: labels[mode] ?? "Agent",
    agentSubtitle: "服务未返回真实结果",
    resultTitle: "未生成结果",
    resultSubtitle: "系统不会用模拟内容补全核查判断。",
    resultStatus: "blocked",
    traceText: "Agent 服务未返回真实结果，本次不生成补充解释。",
    inspectorSummary: "没有真实模型输出，不能形成可用结论或证据。",
    canSay: [],
    cannotSay: ["不能将缺失的模型输出包装成事实、证据或建议"],
    sources: [],
    model: `demo-fallback:${mode}`,
  };
}
