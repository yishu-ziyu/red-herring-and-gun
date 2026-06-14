import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { searchClaimAcrossSources } from "./lib/sherlockStyleSearch.js";
import { AGENT_CONFIGS, buildAgentInput } from "./lib/agentConfigs.js";
import { callAgentWithFallback, AgentTextProviderId } from "./lib/providerRouter.js";
import { listAvailableModels, validateModelChoice } from "./lib/availableModels.js";
import { attachCondensedSnippets } from "./lib/sourceCondenser.js";

const execFileAsync = promisify(execFile);

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
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是红鲱鱼与枪的视觉材料预处理 Agent。只做 OCR、图像描述和可核查声明提取；只返回 JSON。" },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1200,
      temperature: 0.1,
    }),
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
      const result = await callParallelSearchProviders({ env, query, model: payload.model, refProm: payload.refProm });
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "并行搜索服务未返回真实结果";
      return sendJson(res, 502, { message });
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
      const result = await callSearchProvider({ env, provider, query, model: payload.model, refProm: payload.refProm });
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} 未返回真实结果`;
      return sendJson(res, 502, { message });
    }
  }

  async function get360SearchForClaim(claim: string) {
    try {
      return await callParallelSearchProviders({ env, query: claim });
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

  // ───────────────────────────────────────────────────────────────
  // 多 Agent Orchestrate Handler（串行 handoff）
  // ───────────────────────────────────────────────────────────────

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
    // B3: modelChoice 校验（不合法 → 400, 不开始 LLM 调用）
    const modelChoice = payload.modelChoice;
    const mcValidation = validateModelChoice(env, modelChoice);
    if (!mcValidation.ok) {
      return sendJson(res, 400, { message: mcValidation.error || "modelChoice 非法" });
    }
    const intake = normalizeCaseIntake(payload.intake);
    const intakeMetadata = buildCaseIntakeMetadata(intake);
    const clientMemoryRecall = normalizeClientMemoryRecall(payload.memoryRecall);
    let visualExtraction: Record<string, unknown> | undefined;

    // Helper: run a single agent
    async function runAgent(agentId: string, steps: any[], search360Result?: any): Promise<any> {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }

      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, claim, steps);
      if (intakeMetadata) agentInput.intake = intakeMetadata;
      if (visualExtraction) agentInput.visualExtraction = visualExtraction;
      if (clientMemoryRecall) agentInput.memoryRecall = clientMemoryRecall;
      if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        agentInput.search360 = search360Result;
      }
      if (agentId === "report_composer") {
        agentInput.evidenceInputs = buildReportEvidenceInputs(steps, search360Result);
      }

      let output: Record<string, unknown>;
      let modelUsed: string;

      try {
        // B2-B5: 用户在前端 picker 里指定的 model（per-agent）
        const modelOverride = modelChoice && typeof modelChoice === "object"
          ? (modelChoice as Record<string, { provider: string; model: string }>)[agentConfig.id]
          : undefined;
        const result = await callAgentWithFallback({
          agentId: agentConfig.id,
          systemPrompt: agentConfig.systemPrompt,
          userContent: JSON.stringify(agentInput, null, 2),
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
          modelOverride: modelOverride as { provider: AgentTextProviderId; model: string } | undefined,
        });
        output = result.output;
        modelUsed = result.model;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 调用失败";
        throw new Error(`${agentConfig.name} 真实模型调用失败：${message}`);
      }

      return {
        agent: agentConfig.id,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        systemPrompt: agentConfig.systemPrompt,
        input: agentInput,
        output,
        model: modelUsed,
        latencyMs: Date.now() - stepStart,
        timestamp: Date.now(),
        status: "completed",
      };
    }

    try {
      if (intake?.images.length) {
        const visionResult = await callStepFunVisionForIntake({ env, claim, intake });
        visualExtraction = visionResult.output;
        claim = composeClaimWithVision(claim, intake, visualExtraction);
      }

      const steps: any[] = [];

      // Phase 1: RumorDetector (serial)
      const rumorStep = await runAgent("rumor_detector", steps);
      steps.push(rumorStep);
      const search360Result = await get360SearchForClaim(claim);
      // 浓缩来源为 奕枢风格 摘要(挂到 source.condensedSnippet,失败静默)
      await attachCondensedSnippets(env, claim, search360Result);

      // Phase 2: FactChecker + SourceValidator (parallel)
      const [factStep, sourceStep] = await Promise.all([
        runAgent("fact_checker", steps, search360Result),
        runAgent("source_validator", steps, search360Result),
      ]);
      steps.push(factStep, sourceStep);

      // Phase 3: ReportComposer (serial)
      const reportStep = await runAgent("report_composer", steps, search360Result);
      steps.push(reportStep);

      const finalReport = reportStep.output;

      return sendJson(res, 200, {
        claim,
        steps,
        finalReport,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Orchestrate 调用错误";
      return sendJson(res, 502, { message, steps: [] });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 多 Agent Orchestrate Stream Handler（SSE 实时流）
  // ───────────────────────────────────────────────────────────────

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
    // B3: modelChoice 校验（不合法 → 400, 不开始 LLM 调用）
    const modelChoice = payload.modelChoice;
    const mcValidation = validateModelChoice(env, modelChoice);
    if (!mcValidation.ok) {
      return sendJson(res, 400, { message: mcValidation.error || "modelChoice 非法" });
    }
    const intake = normalizeCaseIntake(payload.intake);
    const intakeMetadata = buildCaseIntakeMetadata(intake);
    const clientMemoryRecall = normalizeClientMemoryRecall(payload.memoryRecall);
    let visualExtraction: Record<string, unknown> | undefined;

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Helper: run a single agent and stream events
    async function runAgentWithStream(agentId: string, steps: any[], search360Result?: any): Promise<any> {
      const agentConfig = AGENT_CONFIGS.find((a) => a.id === agentId);
      if (!agentConfig) {
        throw new Error(`Unknown agent: ${agentId}`);
      }

      // Notify frontend: agent started
      sendEvent({
        type: "agent_start",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        model: agentConfig.model || "",
        timestamp: Date.now(),
      });

      const stepStart = Date.now();
      const agentInput = buildAgentInput(agentId, claim, steps);
      if (intakeMetadata) agentInput.intake = intakeMetadata;
      if (visualExtraction) agentInput.visualExtraction = visualExtraction;
      if (clientMemoryRecall) agentInput.memoryRecall = clientMemoryRecall;
      if (search360Result && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
        agentInput.search360 = search360Result;
      }
      if (agentId === "report_composer") {
        agentInput.evidenceInputs = buildReportEvidenceInputs(steps, search360Result);
      }

      let output: Record<string, unknown>;
      let modelUsed: string;

      try {
        // B2-B5: 用户在前端 picker 里指定的 model（per-agent）
        const modelOverride = modelChoice && typeof modelChoice === "object"
          ? (modelChoice as Record<string, { provider: string; model: string }>)[agentConfig.id]
          : undefined;
        const result = await callAgentWithFallback({
          agentId: agentConfig.id,
          systemPrompt: agentConfig.systemPrompt,
          userContent: JSON.stringify(agentInput, null, 2),
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env,
          codexBin,
          reasoningEffort: "high",
          modelOverride: modelOverride as { provider: AgentTextProviderId; model: string } | undefined,
        });
        output = result.output;
        modelUsed = result.model;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Agent 调用失败";
        sendEvent({
          type: "agent_error",
          agent: agentId,
          agentName: agentConfig.name,
          agentIcon: agentConfig.icon,
          error: `${agentConfig.name} 真实模型调用失败：${msg}`,
          timestamp: Date.now(),
        });
        throw new Error(`${agentConfig.name} 真实模型调用失败：${msg}`);
      }

      const step = {
        agent: agentConfig.id,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        systemPrompt: agentConfig.systemPrompt,
        input: agentInput,
        output,
        model: modelUsed,
        latencyMs: Date.now() - stepStart,
        timestamp: Date.now(),
        status: "completed" as const,
      };

      // Notify frontend: agent completed
      sendEvent({
        type: "agent_complete",
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        output,
        model: modelUsed,
        latencyMs: step.latencyMs,
        timestamp: Date.now(),
      });

      return step;
    }

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
          visualExtraction = visionResult.output;
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

      const steps: any[] = [];

      // Phase 1: RumorDetector (serial — downstream agents depend on its output)
      const rumorStep = await runAgentWithStream("rumor_detector", steps);
      steps.push(rumorStep);
      sendEvent({
        type: "tool_start",
        toolName: "360 Search",
        query: claim,
        timestamp: Date.now(),
      });
      const search360Result = await get360SearchForClaim(claim);
      // 浓缩来源为 奕枢风格 摘要(挂到 source.condensedSnippet,失败静默)
      await attachCondensedSnippets(env, claim, search360Result);
      const searchToolName = getSearchToolName(search360Result);
      if (search360Result._source === "tool-error") {
        sendEvent({
          type: "tool_error",
          toolName: searchToolName,
          query: claim,
          error: search360Result.traceText,
          result: search360Result,
          timestamp: Date.now(),
        });
      } else {
        sendEvent({
          type: "tool_result",
          toolName: searchToolName,
          query: claim,
          model: search360Result.model,
          result: search360Result,
          timestamp: Date.now(),
        });
      }

      // Phase 2: FactChecker + SourceValidator (parallel — both only need claim + rumorDetector output)
      const [factStep, sourceStep] = await Promise.all([
        runAgentWithStream("fact_checker", steps, search360Result),
        runAgentWithStream("source_validator", steps, search360Result),
      ]);
      steps.push(factStep, sourceStep);

      const debate = buildConsensusDebate(factStep, sourceStep, search360Result);
      if (debate.status !== "not_needed") {
        sendEvent({
          type: "consensus_debate_round",
          phase: "handoff",
          debate: {
            ...debate,
            status: "running",
            rounds: [],
            finalConsensus: "FactChecker 与 SourceValidator 已进入交叉质询，中控暂不允许报告收束。",
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
              finalConsensus: "正在根据质询结果收紧可说与不可说的边界。",
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

      // Phase 3: ReportComposer (serial — needs outputs from all previous agents)
      const reportStep = await runAgentWithStream("report_composer", steps, search360Result);
      steps.push(reportStep);

      const finalReport = reportStep.output;

      sendEvent({
        type: "complete",
        claim,
        steps,
        finalReport,
        totalLatencyMs: steps.reduce((sum, s) => sum + s.latencyMs, 0),
        timestamp: Date.now(),
      });

      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Orchestrate Stream 错误";
      sendEvent({ type: "error", message });
      res.end();
    }
  }

  return {
    handler,
    recursiveHandler,
    sherlockHandler,
    search360Handler,
    searchProviderHandler,
    modelsListHandler,
    orchestrateHandler,
    orchestrateStreamHandler,
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
    "你是红鲱鱼与枪（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
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
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明证据许可：可以说什么、不能说什么。",
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
    "你是溯证 Agent 的中控 LLM。",
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
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、可以说和不能说。",
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
    "你是红鲱鱼与枪（信息真相猎人）的中控 LLM。",
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
    "你是红鲱鱼与枪（信息真相猎人）的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "返回线索、frontier、停止原因、可以说和不能说。",
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
    "你是红鲱鱼与枪（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "输出必须是符合 JSON schema 的中文 JSON。",
  ].join("\n");

  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 web search 工具寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
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
    "你是溯证 Agent 的中控 LLM。",
    "用户已经在 Canvas 中选择了一个节点。你只围绕这个节点做一轮递归证据搜索调度。",
    "你的目标是把搜索结果整理成线索、可继续探索的 frontier、以及应停止的线索。",
    "不要替用户自动继续展开 frontier。不要直接给最终答案。",
    "每条线索都要说明证据许可：可以说什么、不能说什么。",
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

function extractAnthropicText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    return extractAnthropicContent(data);
  }

  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const dataText = line.slice(5).trim();
    if (!dataText || dataText === "[DONE]") continue;

    try {
      const event = JSON.parse(dataText);
      const deltaText = event?.delta?.text;
      if (typeof deltaText === "string") parts.push(deltaText);
      const blockText = event?.content_block?.text;
      if (event?.type === "content_block_start" && typeof blockText === "string") parts.push(blockText);
    } catch {
      continue;
    }
  }

  return parts.join("");
}

function extractAnthropicContent(data: any) {
  const parts: string[] = [];
  for (const item of data?.content ?? []) {
    if (typeof item?.text === "string") parts.push(item.text);
  }
  return parts.join("");
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

function buildCodexPrompt(payload: any) {
  const modeInstruction = {
    search: "用户选择联网搜索。你可以使用 Codex 的 web search 能力寻找当前节点需要的候选材料，并总结来源角色。",
    evidence_audit: "用户选择证据审计。重点判断当前节点可以说什么、不能说什么，以及还缺哪类证据。",
    counter: "用户选择反证生成。重点生成替代解释、反例或会削弱原推断的检查路径。",
    rewrite: "用户选择局部改写。只围绕当前节点给出更谨慎的局部表达，不生成全局最终答案。",
    rumor_check: "用户选择谣言专项核查。重点识别信息中的谣言特征（绝对化表述、匿名信源、情绪煽动等），并给出针对性核查建议。",
  }[payload.mode as string] ?? "围绕当前节点做局部推理。";

  return [
    "你是红鲱鱼与枪（信息真相猎人）的中控 LLM。",
    "你的职责不是替用户直接完成整张论证图，而是在用户选中的当前节点上做一次局部调度。",
    "你必须选择合适的子 Agent，并返回可接回 Canvas 的局部结果。",
    "不要自动扩展整张图，不要替用户决定下一条主线。",
    "不要编造确定结论；把不确定性、证据需求、禁止推断说清楚。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 中控为什么选择这个调度方向。",
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
    "你是溯证 Agent 的中控 LLM。",
    "用户在 Canvas 中选中一个节点，并要求从这里做递归证据搜索。",
    "你只做一轮：search -> extract -> normalize -> dedupe -> score -> frontier。",
    "不要自动继续展开 frontier。frontier 只是交给用户选择的下一步。",
    "最终回答必须是一个中文 JSON 对象，不要 Markdown，不要代码块。",
    "",
    "字段含义：",
    "- controllerNote: 中控为什么从这个节点启动递归搜索。",
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
    controllerNote: pickString("controllerNote", "中控 LLM 已根据当前节点选择局部调度方向。"),
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
    controllerNote: pickString("controllerNote", "中控 LLM 已从当前节点启动一轮递归证据搜索。"),
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

function readJson(req: any) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
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

function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "360 Search + Parallel Search";
  if (result?._source === "anysearch-search") return "AnySearch";
  if (result?._source === "metaso-search") return "Metaso Search";
  if (result?._source === "tavily-search") return "Tavily Search";
  if (result?._source === "exa-search") return "Exa Search";
  if (result?._source === "tool-error") return "Search Tool";
  return "360 Search";
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

async function call360AiSearch({
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
  const apiKey = getSearch360ApiKey(env);
  if (!apiKey) throw new Error("未配置 360 API key");

  const selectedModel = model || env.SEARCH360_MODEL || process.env.SEARCH360_MODEL || "360gpt-pro";
  try {
    const response = await fetch("https://api.360.cn/v1/search/aisearch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: query }],
        stream: false,
        enable_corner_markers: true,
        enable_web_page_safety: true,
        max_refer_search_items: 12,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || response.statusText;
      throw new Error(`360 AI Search 调用失败：${detail}`);
    }

    return normalize360SearchResponse(data, query, selectedModel);
  } catch (error) {
    const aiSearchError = error instanceof Error ? error.message : "360 AI Search 调用失败";
    return await call360MWebSearch({ env, apiKey, query, refProm, previousError: aiSearchError });
  }
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
    traceText: `${has360Success ? "搜索 Agent 已调用 360 Search，并行补充其它检索源" : "360 Search 未返回可用结果，搜索 Agent 已继续调用其它检索源做交叉验证"}：${providerSummary}。${failures.length ? `失败：${failures.join("；")}` : ""}`,
    _source: "parallel-search",
  };
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
  const response = await fetch("https://api.anysearch.com/mcp", {
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
  });

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

  const response = await fetch("https://api.tavily.com/search", {
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
  });

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
  const response = await fetch("https://metaso.cn/api/v1/search", {
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
  });

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
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type,
      numResults: Number(env.EXA_MAX_RESULTS || process.env.EXA_MAX_RESULTS || 6),
      contents: {
        text: { maxCharacters: 1000 },
        highlights: true,
        summary: { query: "提取与原始 claim 真假、来源和反证相关的要点。" },
      },
    }),
  });

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
  const sources = rawItems.slice(0, 8).map((source: any, index: number) => ({
    title: String(source?.title || `Tavily 来源 ${index + 1}`),
    url: String(source?.url || ""),
    snippet: String(source?.content || source?.raw_content || ""),
    credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
  }));

  return {
    answer: String(data?.answer || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `tavily-search:${data?.auto_parameters?.search_depth || "basic"}`,
    traceText: `Tavily Search 返回 ${sources.length} 条来源，请求 ID：${data?.request_id || "unknown"}。`,
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
  const sources = items.slice(0, 8).map((source: any, index: number) => ({
    title: String(source?.title || source?.name || source?.site_name || `Metaso 来源 ${index + 1}`),
    url: String(source?.url || source?.link || source?.href || source?.web_url || ""),
    snippet: String(source?.snippet || source?.summary || source?.content || source?.text || source?.description || ""),
    credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
  }));

  return {
    answer: String(data?.answer || data?.summary || data?.data?.answer || data?.data?.summary || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Metaso Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `metaso-search:${scope}`,
    traceText: `Metaso Search 返回 ${sources.length} 条来源。`,
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
  const sources = rawItems.slice(0, 8).map((source: any, index: number) => ({
    title: String(source.title || `AnySearch 来源 ${index + 1}`),
    url: String(source.url || ""),
    snippet: String(source.snippet || ""),
    credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
  }));

  return {
    answer: sources.map((source) => `【${source.title}】${source.snippet}`).join("\n") || text,
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["AnySearch 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: "anysearch:mcp-search",
    traceText: `AnySearch 返回 ${sources.length} 条来源。`,
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
  const sources = rawItems.slice(0, 8).map((source: any, index: number) => ({
    title: String(source?.title || `Exa 来源 ${index + 1}`),
    url: String(source?.url || source?.id || ""),
    snippet: String(source?.summary || source?.text || source?.highlights?.[0] || ""),
    credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
  }));

  return {
    answer: String(data?.context || sources.map((source) => `【${source.title}】${source.snippet}`).join("\n")),
    sources,
    unresolvedEvidenceGaps: sources.length > 0 ? [] : ["Exa Search 未返回可引用来源。"],
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `exa-search:${data?.searchType || type}`,
    traceText: `Exa Search 返回 ${sources.length} 条来源，请求 ID：${data?.requestId || "unknown"}。`,
    _source: "exa-search",
  };
}

function normalize360SearchResponse(data: any, query: string, model: string) {
  const answer =
    data?.answer ||
    data?.choices?.[0]?.message?.content ||
    data?.data?.answer ||
    `360 AI Search 已返回“${query}”的搜索结果。`;
  const rawSources =
    data?.sources ||
    data?.references ||
    data?.refer_search_items ||
    data?.data?.sources ||
    data?.data?.references ||
    [];
  const sources = Array.isArray(rawSources)
    ? rawSources.slice(0, 8).map((source: any, index: number) => ({
        title: String(source?.title || source?.name || source?.site_name || `来源 ${index + 1}`),
        url: String(source?.url || source?.link || source?.href || ""),
        snippet: String(source?.snippet || source?.summary || source?.content || ""),
        credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
      }))
    : [];
  const relatedQuestions = Array.isArray(data?.relatedQuestions || data?.related_questions || data?.questions)
    ? (data.relatedQuestions || data.related_questions || data.questions).filter((item: unknown): item is string => typeof item === "string")
    : [`${query} 官方回应`, `${query} 辟谣`];

  return {
    answer: String(answer),
    sources,
    relatedQuestions,
    model: `360-ai-search:${model}`,
    traceText: `360 AI Search 返回 ${sources.length} 条来源。`,
    _source: "360-ai-search",
  };
}

async function call360MWebSearch({
  env,
  apiKey,
  query,
  refProm,
  previousError,
}: {
  env: Record<string, string>;
  apiKey: string;
  query: string;
  refProm?: string;
  previousError: string;
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
  url.searchParams.set("trusted_sources", "1");
  url.searchParams.set("exclude_aigc", "true");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || response.statusText;
    throw new Error(`${previousError}；360 智搜 ${selectedRefProm} 调用失败：${detail}`);
  }

  return normalize360MWebSearchResponse(data, query, selectedRefProm);
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
  const sources = items.slice(0, 8).map((source: any, index: number) => ({
    title: String(source?.title || source?.name || source?.site_name || `360 智搜来源 ${index + 1}`),
    url: String(source?.url || source?.link || source?.href || source?.display_url || ""),
    snippet: String(source?.summary_ai || source?.summary || source?.snippet || source?.content || source?.desc || ""),
    credibility: index === 0 ? "高" : index <= 3 ? "中" : "低",
  }));
  const answer = sources.length > 0
    ? sources.map((source) => `【${source.title}】${source.snippet}`).filter(Boolean).join("\n")
    : `360 智搜已返回“${query}”的检索响应，但未解析到标准来源列表。`;

  return {
    answer,
    sources,
    relatedQuestions: [`${query} 官方回应`, `${query} 辟谣`, `${query} 原始来源`],
    model: `360-mwebsearch:${refProm}`,
    traceText: `360 智搜 ${refProm} 返回 ${sources.length} 条来源。`,
    _source: "360-ai-search",
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
      neededEvidence: ["需要真实模型分诊后才能生成证据需求。"],
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
