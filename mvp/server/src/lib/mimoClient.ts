/**
 * mimoClient.ts — MiMo LLM API 客户端（Anthropic 兼容协议）
 *
 * 用于 Sherlock 搜索引擎：调用 MiMo LLM 生成智能搜索结果，
 * 模拟在多个事实核查平台上的搜索结果。
 */

import { FACT_CHECK_SOURCES, type SourceHit } from "./sherlockStyleSearch.js";
// 审查 P3-2 修复：extractAnthropicText / extractJsonObject 从共享模块引入，
// 不再在本文件维护独立副本（原 line 292-348 本地定义已删除）。
import { extractAnthropicText, extractJsonObject } from "./anthropicParse.js";

// ───────────────────────────────────────────────────────────────
// 类型定义
// ───────────────────────────────────────────────────────────────

export interface MimoSherlockHit {
  sourceId: string;
  sourceName: string;
  sourceIcon: string;
  matchedUrl: string;
  detectionMethod: string;
  trustLevel: string;
  matchedKeywords: string[];
  factCheckResult: "true" | "false" | "partial" | "unverified";
  summary: string;
}

export interface MimoSherlockResult {
  hits: MimoSherlockHit[];
  sourcesMatched: number;
  controllerNote: string;
  traceText: string;
  canSay: string[];
  cannotSay: string[];
}

// ───────────────────────────────────────────────────────────────
// 配置
// ───────────────────────────────────────────────────────────────

declare const process: { env: Record<string, string | undefined> } | undefined;

function getMimoConfig() {
  const apiKey =
    (typeof process !== "undefined" && process.env.MIMO_API_KEY) ||
    "";
  const baseUrl = (
    (typeof process !== "undefined" && process.env.MIMO_BASE_URL) ||
    "https://token-plan-cn.xiaomimimo.com/anthropic"
  ).replace(/\/$/, "");
  const model =
    (typeof process !== "undefined" && process.env.MIMO_MODEL) ||
    "mimo-v2.5-pro";

  return { apiKey, baseUrl, model };
}

const MIMO_CLUSTERS = [
  "https://token-plan-cn.xiaomimimo.com/anthropic",
  "https://token-plan-sgp.xiaomimimo.com/anthropic",
  "https://token-plan-ams.xiaomimimo.com/anthropic",
];

// ───────────────────────────────────────────────────────────────
// System Prompt
// ───────────────────────────────────────────────────────────────

function buildSherlockSystemPrompt(): string {
  const sourceCatalog = FACT_CHECK_SOURCES.map(
    (s) =>
      `- ${s.id} (${s.name}, ${s.icon}): ${s.category}类平台，可信度${s.trustLevel}。${s.description}`
  ).join("\n");

  return [
    "你是一个事实核查平台聚合器。你的任务是根据用户提供的 claim 和 keywords，",
    "模拟在多个事实核查平台上的搜索结果。",
    "",
    "你需要分析 claim 的主题类别（health/tech/society/finance/general），",
    "然后返回在相关平台上可能找到的核查结果。",
    "",
    "可用平台列表：",
    sourceCatalog,
    "",
    "输出规则：",
    "1. hits 数组中每个元素代表一个平台的搜索结果。",
    "2. 只返回与 claim 主题相关的平台结果，不要为所有平台都生成命中。",
    "3. factCheckResult 必须是 true/false/partial/unverified 之一。",
    "4. trustLevel 必须是 high/medium/low 之一。",
    "5. summary 应该简洁说明该平台对此 claim 的核查结论。",
    "6. matchedKeywords 列出 claim 中与该平台匹配的关键词。",
    "7. matchedUrl 使用对应平台的 searchUrlTemplate，将关键词填入。",
    "8. controllerNote 说明整体搜索结果概况。",
    "9. traceText 用一句话总结搜索过程。",
    "10. canSay 列出基于搜索结果可以说的事项。",
    "11. cannotSay 列出基于搜索结果不能说的事项。",
    "",
    "输出必须是纯 JSON 对象，不要 Markdown，不要代码块。",
  ].join("\n");
}

function buildSherlockUserPrompt(claim: string, keywords: string[]): string {
  return JSON.stringify(
    {
      claim,
      keywords,
      task: "在事实核查平台上搜索此 claim 的核查结果",
      outputFormat: {
        hits: [
          {
            sourceId: "平台标识",
            sourceName: "平台名称",
            sourceIcon: "emoji",
            matchedUrl: "搜索URL",
            detectionMethod: "匹配方式说明",
            trustLevel: "high|medium|low",
            matchedKeywords: ["匹配的关键词"],
            factCheckResult: "true|false|partial|unverified",
            summary: "核查结果摘要",
          },
        ],
        sourcesMatched: "命中平台数量",
        controllerNote: "中控说明",
        traceText: "一句话追踪",
        canSay: ["可以说的事项"],
        cannotSay: ["不能说的事项"],
      },
    },
    null,
    2
  );
}

// ───────────────────────────────────────────────────────────────
// API 调用
// ───────────────────────────────────────────────────────────────

async function callMimoApiSingle(
  baseUrl: string,
  model: string,
  apiKey: string,
  claim: string,
  keywords: string[]
): Promise<MimoSherlockResult> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: buildSherlockSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildSherlockUserPrompt(claim, keywords),
        },
      ],
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MiMo API 调用失败 [${baseUrl}]: ${raw.slice(0, 500)}`);
  }

  const text = extractAnthropicText(raw);
  if (!text) {
    throw new Error(`MiMo API 没有返回可解析文本 [${baseUrl}]`);
  }

  const parsed = JSON.parse(extractJsonObject(text));
  return normalizeMimoResult(parsed);
}

// ───────────────────────────────────────────────────────────────
// 多集群回退
// ───────────────────────────────────────────────────────────────

export async function callMimoForSherlockSearch(
  claim: string,
  keywords: string[]
): Promise<MimoSherlockResult> {
  const { apiKey, baseUrl, model } = getMimoConfig();

  if (!apiKey) {
    throw new Error("MIMO_API_KEY 未配置");
  }

  const errors: string[] = [];
  const clusters = [baseUrl, ...MIMO_CLUSTERS.filter((c) => c !== baseUrl)];

  for (const clusterUrl of clusters) {
    try {
      return await callMimoApiSingle(clusterUrl, model, apiKey, claim, keywords);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "MiMo API 调用失败";
      errors.push(`[${clusterUrl}] ${msg}`);
    }
  }

  throw new Error(errors.join("；") || "所有 MiMo 集群均不可用");
}

// ───────────────────────────────────────────────────────────────
// 结果归一化
// ───────────────────────────────────────────────────────────────

function normalizeMimoResult(raw: any): MimoSherlockResult {
  const pickString = (key: string, fallback: string) =>
    typeof raw?.[key] === "string" && raw[key].trim() ? raw[key] : fallback;

  const pickArray = (key: string) =>
    Array.isArray(raw?.[key]) ? raw[key] : [];

  const validTrustLevels = new Set(["high", "medium", "low"]);
  const validFactCheckResults = new Set([
    "true",
    "false",
    "partial",
    "unverified",
  ]);

  const hits: MimoSherlockHit[] = pickArray("hits")
    .filter((item: any) => item && typeof item === "object")
    .map((item: any) => ({
      sourceId:
        typeof item?.sourceId === "string" && item.sourceId.trim()
          ? item.sourceId
          : "unknown",
      sourceName:
        typeof item?.sourceName === "string" && item.sourceName.trim()
          ? item.sourceName
          : "未知平台",
      sourceIcon:
        typeof item?.sourceIcon === "string" ? item.sourceIcon : "🔍",
      matchedUrl:
        typeof item?.matchedUrl === "string" && item.matchedUrl.trim()
          ? item.matchedUrl
          : "#",
      detectionMethod:
        typeof item?.detectionMethod === "string" && item.detectionMethod.trim()
          ? item.detectionMethod
          : "llm_simulated",
      trustLevel: validTrustLevels.has(item?.trustLevel)
        ? item.trustLevel
        : "medium",
      matchedKeywords: Array.isArray(item?.matchedKeywords)
        ? item.matchedKeywords.filter((k: unknown) => typeof k === "string")
        : [],
      factCheckResult: validFactCheckResults.has(item?.factCheckResult)
        ? item.factCheckResult
        : "unverified",
      summary:
        typeof item?.summary === "string" && item.summary.trim()
          ? item.summary
          : "暂无核查摘要",
    }));

  // 按可信度排序
  const levelOrder = { high: 3, medium: 2, low: 1 };
  hits.sort(
    (a, b) =>
      levelOrder[b.trustLevel as keyof typeof levelOrder] -
      levelOrder[a.trustLevel as keyof typeof levelOrder]
  );

  return {
    hits,
    sourcesMatched: hits.length,
    controllerNote: pickString(
      "controllerNote",
      `MiMo 智能搜索：在 ${FACT_CHECK_SOURCES.length} 个平台中匹配到 ${hits.length} 个相关信源。`
    ),
    traceText: pickString(
      "traceText",
      `我对 claim 发起了 MiMo 智能多平台并行溯源搜索，命中 ${hits.length} 个平台。`
    ),
    canSay: pickArray("canSay").filter(
      (item: unknown) => typeof item === "string"
    ),
    cannotSay: pickArray("cannotSay").filter(
      (item: unknown) => typeof item === "string"
    ),
  };
}

