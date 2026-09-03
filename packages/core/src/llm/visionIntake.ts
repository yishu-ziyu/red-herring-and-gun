/**
 * visionIntake.ts — 用户材料（文本 / 链接 / 截图）的规范化摄入与 StepFun 视觉预处理。
 * 只做 OCR 与线索提取，不判断真假。
 */

import { buildStepFunRequestBody, extractChatCompletionText } from "./agentProviders.js";

import { extractJsonObject } from "./anthropicParse.js";

export interface CaseIntakeLinkPayload {
  url: string;
  hostname?: string;
  scrapedContent?: string;
  scrapeStatus?: "success" | "error";
  scrapeError?: string;
}

export interface CaseIntakeImagePayload {
  name?: string;
  type?: string;
  size?: number;
  dataUrl?: string;
}

export interface CaseIntakePayload {
  text: string;
  links: CaseIntakeLinkPayload[];
  images: CaseIntakeImagePayload[];
}

export interface ClientMemoryRecallPayload {
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

export function normalizeCaseIntake(raw: any): CaseIntakePayload | null {
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

export function normalizeClientMemoryRecall(raw: any): ClientMemoryRecallPayload | undefined {
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

export function buildCaseIntakeMetadata(intake: CaseIntakePayload | null) {
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

export function buildVisionPrompt(claim: string, intake: CaseIntakePayload) {
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

export async function callStepFunVisionForIntake({
  env,
  claim,
  intake,
}: {
  env: Record<string, string>;
  claim: string;
  intake: CaseIntakePayload;
}) {
  const apiKey = env.STEPFUN_API_KEY;
  if (!apiKey) throw new Error("缺少 STEPFUN_API_KEY，无法解析图片材料。");

  const baseUrl = (env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
  const model = env.STEPFUN_VISION_MODEL || env.STEPFUN_MODEL || "step-3.7-flash";
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

    const data: any = await response.json().catch(() => null);
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

export function composeClaimWithVision(claim: string, intake: CaseIntakePayload, visualExtraction: Record<string, unknown>) {
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
