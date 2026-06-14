import type { Search360Response, Search360Source } from "../schemas";

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

export function normalizeCaseIntake(raw: unknown): CaseIntakePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;

  return {
    text: typeof input.text === "string" ? input.text : "",
    links: Array.isArray(input.links)
      ? input.links
          .filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === "object" && typeof (link as Record<string, unknown>).url === "string")
          .map((link) => ({
            url: String(link.url),
            hostname: typeof link.hostname === "string" ? link.hostname : undefined,
            scrapedContent: typeof link.scrapedContent === "string" ? link.scrapedContent.slice(0, 12000) : undefined,
            scrapeStatus: link.scrapeStatus === "success" || link.scrapeStatus === "error" ? link.scrapeStatus : undefined,
            scrapeError: typeof link.scrapeError === "string" ? link.scrapeError : undefined,
          }))
      : [],
    images: Array.isArray(input.images)
      ? input.images
          .filter((image): image is Record<string, unknown> => Boolean(image) && typeof image === "object" && typeof (image as Record<string, unknown>).dataUrl === "string")
          .slice(0, 4)
          .map((image) => ({
            name: typeof image.name === "string" ? image.name : undefined,
            type: typeof image.type === "string" ? image.type : undefined,
            size: typeof image.size === "number" ? image.size : undefined,
            dataUrl: String(image.dataUrl),
          }))
      : [],
  };
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

export function composeClaimWithVision(
  claim: string,
  intake: CaseIntakePayload,
  visualExtraction: Record<string, unknown>
) {
  const links = intake.links.map((link) =>
    link.scrapedContent
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

export function build360SupportQuery(claim: string) {
  return `${claim} 证据 来源 官方说明 原始出处`;
}

export function build360ContradictQuery(claim: string) {
  return `${claim} 辟谣 反例 争议 无法证实 误读`;
}

export function getSearchToolName(result: { _source?: string } | undefined) {
  if (result?._source === "parallel-search") return "360 Search + Parallel Search";
  if (result?._source === "anysearch-search") return "AnySearch";
  if (result?._source === "metaso-search") return "Metaso Search";
  if (result?._source === "tavily-search") return "Tavily Search";
  if (result?._source === "exa-search") return "Exa Search";
  if (result?._source === "tool-error") return "Search Tool";
  return "360 Search";
}

export function build360SearchFailure(query: string, message: string): Search360Response {
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

function truncateText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function compactSource(source: Search360Source | Record<string, unknown>, index: number): Search360Source {
  const item = source as Search360Source & Record<string, unknown>;
  return {
    id: item.id ?? `S${index + 1}`,
    title: String(item.title || `来源 ${index + 1}`),
    url: String(item.url || ""),
    snippet: String(truncateText(item.snippet || item.summary || item.content || "", 700) || ""),
    credibility: item.credibility,
    sourceType: item.sourceType,
    credibilityScore: typeof item.credibilityScore === "number" ? item.credibilityScore : undefined,
    sourceTier: typeof item.sourceTier === "number" ? item.sourceTier : undefined,
    freshnessScore: typeof item.freshnessScore === "number" ? item.freshnessScore : undefined,
    domain: typeof item.domain === "string" ? item.domain : undefined,
    evidenceRole: item.evidenceRole,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
    publishedTimestamp: typeof item.publishedTimestamp === "number" ? item.publishedTimestamp : undefined,
  };
}

export function compactSearchResultForAgent(
  result: Search360Response | null | undefined,
  sourceLimit = 8
): Search360Response | undefined {
  if (!result) return undefined;
  if (result._source === "tool-error" || result._source === "demo-fallback") return result;

  const sources = (Array.isArray(result.sources) ? result.sources : [])
    .slice(0, sourceLimit)
    .map((source, index) => compactSource(source, index));
  const supportingEvidence = (Array.isArray(result.supportingEvidence) ? result.supportingEvidence : [])
    .slice(0, Math.ceil(sourceLimit / 2))
    .map((source, index) => compactSource(source, index));
  const contradictingEvidence = (Array.isArray(result.contradictingEvidence) ? result.contradictingEvidence : [])
    .slice(0, Math.ceil(sourceLimit / 2))
    .map((source, index) => compactSource(source, index));

  return {
    ...result,
    answer: String(truncateText(result.answer, 2200) || ""),
    sources,
    supportingEvidence,
    contradictingEvidence,
    unresolvedEvidenceGaps: (result.unresolvedEvidenceGaps ?? []).slice(0, 6),
    relatedQuestions: (result.relatedQuestions ?? []).slice(0, 6),
    traceText: typeof result.traceText === "string" ? String(truncateText(result.traceText, 900)) : result.traceText,
  };
}

export function summarizeSearchResultForStream(
  result: Search360Response | null | undefined,
  sourceLimit = 5
) {
  if (!result) return undefined;

  const sources = (Array.isArray(result.sources) ? result.sources : [])
    .slice(0, sourceLimit)
    .map((source, index) => {
      const item = compactSource(source, index);
      return {
        id: item.id,
        title: item.title,
        url: item.url,
        domain: item.domain,
        credibility: item.credibility,
        credibilityScore: item.credibilityScore,
        sourceType: item.sourceType,
        evidenceRole: item.evidenceRole,
        publishedAt: item.publishedAt,
        // 把 奕枢风格 浓缩摘要带到流里,UI 端 ReadingSourceList 优先用它
        condensedSnippet: typeof source.condensedSnippet === "string" && source.condensedSnippet.trim()
          ? source.condensedSnippet.trim()
          : undefined,
      };
    });

  return {
    _source: result._source,
    model: result.model,
    answerPreview: String(truncateText(result.answer, 600) || ""),
    sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
    supportCount: Array.isArray(result.supportingEvidence) ? result.supportingEvidence.length : 0,
    contradictCount: Array.isArray(result.contradictingEvidence) ? result.contradictingEvidence.length : 0,
    unresolvedEvidenceGaps: (result.unresolvedEvidenceGaps ?? []).slice(0, 4),
    relatedQuestions: (result.relatedQuestions ?? []).slice(0, 4),
    traceTextPreview: typeof result.traceText === "string" ? String(truncateText(result.traceText, 350)) : undefined,
    sources,
  };
}
