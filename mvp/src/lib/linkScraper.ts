/**
 * linkScraper.ts — 链接内容抓取模块
 *
 * 使用 r.jina.ai（免费，无需 API Key，返回 Clean Markdown）
 * 支持 CORS，可直接在前端调用。
 */

import type { CaseLink } from "./caseIntake";

export interface ScrapedLink extends CaseLink {
  scrapedContent: string;
  scrapedAt: number;
  scrapeStatus: "success" | "error";
  scrapeError?: string;
}

const JINA_AI_BASE = "https://r.jina.ai/";
const FETCH_TIMEOUT_MS = 15000;

/**
 * 抓取单个链接的内容。
 */
async function scrapeSingleLink(link: CaseLink): Promise<ScrapedLink> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${JINA_AI_BASE}${link.url}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
      },
    });

    window.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    return {
      ...link,
      scrapedContent: content.trim(),
      scrapedAt: Date.now(),
      scrapeStatus: "success",
    };
  } catch (error) {
    window.clearTimeout(timeoutId);

    const errorMessage = error instanceof Error ? error.message : "抓取失败";
    return {
      ...link,
      scrapedContent: "",
      scrapedAt: Date.now(),
      scrapeStatus: "error",
      scrapeError: errorMessage,
    };
  }
}

/**
 * 并行抓取所有链接内容。
 */
export async function scrapeLinks(links: CaseLink[]): Promise<ScrapedLink[]> {
  if (links.length === 0) return [];
  return Promise.all(links.map(scrapeSingleLink));
}

/**
 * 将抓取结果格式化为可供 Agent 分析用的文本。
 */
export function formatScrapedContent(links: ScrapedLink[]): string {
  const successfulLinks = links.filter((l) => l.scrapeStatus === "success" && l.scrapedContent);
  if (successfulLinks.length === 0) return "";

  return successfulLinks
    .map(
      (link, index) =>
        `--- 链接 ${index + 1}: ${link.url} ---\n${link.scrapedContent}\n--- 链接 ${index + 1} 结束 ---`
    )
    .join("\n\n");
}
