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
  /** 判定为抓取失败（空正文 / 正文过短 / 命中登录墙）：正文不可用，不拼进 claim。 */
  scrapeFailed: boolean;
}

const JINA_AI_BASE = "https://r.jina.ai/";
const FETCH_TIMEOUT_MS = 15000;

/** 少于这个字数的「正文」不足以当材料：登录墙与空页在 Jina 里常常只剩标题和空壳。 */
export const MIN_SCRAPE_CONTENT_CHARS = 200;

/**
 * 通用登录墙特征（小写匹配）。只认公开可见的「要登录才给看」提示，
 * 不做任何绕过登录的手段，也不为单个站点写专门规则。
 *
 * 不把光秃秃的 "passport" 当特征：那会误伤「护照」类正文；
 * 只认 passport.<域名> 这种登录跳转网址（见 LOGIN_WALL_REDIRECT）。
 */
const LOGIN_WALL_MARKERS = [
  "sina visitor system",
  "登录后查看",
  "登录可见",
  "登录后可见",
  "请先登录",
  "需要登录",
  "sign in to continue",
  "log in to continue",
];

/** passport 类登录跳转网址，如 passport.weibo.com / passport.163.com。 */
const LOGIN_WALL_REDIRECT = /\bpassport\.[a-z0-9-]+\.(?:com|cn|net)\b/i;

/**
 * 判定一段抓取结果能不能当正文用。能用返回 null，不能用返回失败原因。
 */
export function scrapeFailureReason(content: string): string | null {
  const text = content.trim();
  if (!text) return "抓取内容为空";
  if (text.length < MIN_SCRAPE_CONTENT_CHARS) return `抓取内容过短（${text.length} 字）`;

  const lowered = text.toLowerCase();
  const marker = LOGIN_WALL_MARKERS.find((candidate) => lowered.includes(candidate));
  if (marker) return `命中登录墙特征：${marker}`;

  const redirect = lowered.match(LOGIN_WALL_REDIRECT);
  if (redirect) return `命中登录墙跳转：${redirect[0]}`;

  return null;
}

/**
 * 抓取单个链接的内容。
 */
async function scrapeSingleLink(link: CaseLink): Promise<ScrapedLink> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${JINA_AI_BASE}${encodeURIComponent(link.url)}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = (await response.text()).trim();
    const failure = scrapeFailureReason(content);

    if (failure) {
      return {
        ...link,
        scrapedContent: "",
        scrapedAt: Date.now(),
        scrapeStatus: "error",
        scrapeFailed: true,
        scrapeError: failure,
      };
    }

    return {
      ...link,
      scrapedContent: content,
      scrapedAt: Date.now(),
      scrapeStatus: "success",
      scrapeFailed: false,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    const errorMessage = error instanceof Error ? error.message : "抓取失败";
    return {
      ...link,
      scrapedContent: "",
      scrapedAt: Date.now(),
      scrapeStatus: "error",
      scrapeFailed: true,
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
 * 只收抓取成功的正文：全部失败时返回空串，调用方就不会拼出空的
 * 「【链接抓取内容】--- 链接 1 … --- 结束」信封。
 */
export function formatScrapedContent(links: ScrapedLink[]): string {
  const usableLinks = links.filter((l) => l.scrapeStatus === "success" && !l.scrapeFailed && l.scrapedContent);
  if (usableLinks.length === 0) return "";

  return usableLinks
    .map(
      (link, index) =>
        `--- 链接 ${index + 1}: ${link.url} ---\n${link.scrapedContent}\n--- 链接 ${index + 1} 结束 ---`
    )
    .join("\n\n");
}
