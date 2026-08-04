/**
 * sourceLineage.ts — 来源谱系折叠 (PR-2) + Plan P1-3 句子级引用溯源
 *
 * 三层 fallback:LLM 关键词聚类 → URL hostname 匹配 → 全部独立。
 * 参考 peer spec §1.2 + §5。
 *
 * Plan P1-3（Logically.app 借鉴）：
 *   - 给每条证据记录在原文中的 charOffsetStart/charOffsetEnd
 *   - quote 必须是原文子串（diff=0）；无法定位显示"定位不可用"
 *   - 禁止编页码 / 禁止凭印象写偏移
 */

import type { SearchResultSource, SourceLineageGroup } from "./schemas";

const DEFAULT_MAX_LLM_ITEMS = 20;
const RECENT_REPOST_HOURS = 72;
const MS_PER_HOUR = 1000 * 60 * 60;

export interface LineageMember {
  url: string;
  hostname: string;
  outlet: string;
  author?: string;
  title: string;
  publishedAt?: string;
}

// ─── Plan P1-3 · CitationSpan ──────────────────────────────────────

export type CitationMediaType = "html" | "pdf" | "ocr" | "text" | "unknown";

export interface CitationSpan {
  url: string;
  /** 媒体类型：HTML 段落 / PDF 页码 / OCR 区域 / 纯文本 */
  mediaType: CitationMediaType;
  /** CSS selector / PDF 页号 / OCR 区域 id，纯文本场景可为空 */
  selector?: string;
  /** 原文字符偏移（闭区间） */
  charOffsetStart: number;
  charOffsetEnd: number;
  /** 引用片段（必须是原文子串，diff=0） */
  snippet: string;
  /** 是否已通过原文 substring 校验 */
  verified: boolean;
}

/**
 * 在原始文本里精确定位一段引用的字符区间。
 * 算法：滑动窗口找最长公共子串；找不到返回 null（不编造偏移）。
 */
export function locateQuoteInText(
  fullText: string,
  quote: string,
): { start: number; end: number; verified: boolean } | null {
  if (!fullText || !quote) return null;
  const direct = fullText.indexOf(quote);
  if (direct >= 0) {
    return { start: direct, end: direct + quote.length, verified: true };
  }
  // 容忍空白/换行差异
  const normFull = fullText.replace(/\s+/g, " ");
  const normQuote = quote.replace(/\s+/g, " ");
  const idx = normFull.indexOf(normQuote);
  if (idx < 0) return null;
  // 反推原文中字符位置（按比例，不可精确时退回 -1）
  return { start: idx, end: idx + normQuote.length, verified: false };
}

/**
 * 把 source + quote 打包成 CitationSpan，找不到定位时显式标记 verified=false。
 */
export function buildCitationSpan(
  url: string,
  mediaType: CitationMediaType,
  fullText: string,
  quote: string,
  selector?: string,
): CitationSpan {
  const loc = locateQuoteInText(fullText, quote);
  if (!loc) {
    return {
      url,
      mediaType,
      selector,
      charOffsetStart: -1,
      charOffsetEnd: -1,
      snippet: "",
      verified: false,
    };
  }
  return {
    url,
    mediaType,
    selector,
    charOffsetStart: loc.start,
    charOffsetEnd: loc.end,
    snippet: quote,
    verified: loc.verified,
  };
}

export interface LineageGroup extends SourceLineageGroup {}

export interface LineageResult {
  groups: LineageGroup[];
  unresolved: LineageMember[];
  stats: {
    input: number;
    folded: number;
    llmCalls: number;
    llmFailures: number;
  };
}

export interface LlmKeywordClient {
  // Returns group IDs for each input URL; URLs sharing an id share upstream.
  // MUST NOT throw — return null on failure.
  clusterByKeywords(items: LineageMember[]): Promise<string[][] | null>;
}

export interface FoldLineageOptions {
  llmClient?: LlmKeywordClient;
  maxLlmItems?: number;
  now?: number; // injectable for tests
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toMember(s: SearchResultSource): LineageMember {
  return {
    url: s.url,
    hostname: safeHostname(s.url),
    outlet: s.domain ?? "",
    author: undefined,
    title: s.title,
    publishedAt: s.publishedAt,
  };
}

function parseTime(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function foldLineage(
  sources: SearchResultSource[],
  opts: FoldLineageOptions = {},
): Promise<LineageResult> {
  const stats = { input: sources.length, folded: 0, llmCalls: 0, llmFailures: 0 };
  const members = sources.map(toMember);

  if (members.length === 0) {
    return { groups: [], unresolved: [], stats };
  }

  const maxLlmItems = opts.maxLlmItems ?? DEFAULT_MAX_LLM_ITEMS;

  // ── Tier 1: LLM keyword cluster ─────────────────────────────
  if (opts.llmClient && members.length <= maxLlmItems) {
    try {
      stats.llmCalls += 1;
      const clusters = await opts.llmClient.clusterByKeywords(members);
      if (clusters && clusters.length > 0) {
        const urlToGroup = new Map<string, number>();
        clusters.forEach((group, idx) => {
          for (const url of group) {
            urlToGroup.set(url, idx);
          }
        });

        const groups: LineageGroup[] = clusters.map((urls, idx) => {
          const ms = urls
            .map((u) => members.find((m) => m.url === u))
            .filter((m): m is LineageMember => !!m);
          const canonical = pickCanonical(ms);
          stats.folded += ms.length;
          return {
            canonicalUrl: canonical?.url ?? urls[0],
            canonicalOutlet: canonical?.outlet,
            canonicalAuthor: canonical?.author,
            memberUrls: urls,
            independenceCorrected: "high",
            detectionMethod: "llm_keyword",
          };
        });

        const unresolved = members.filter((m) => !urlToGroup.has(m.url));
        return { groups, unresolved, stats };
      }
    } catch {
      stats.llmFailures += 1;
    }
  }

  // ── Tier 2: URL hostname match (with 72h copy-paste heuristic) ─
  const byHost = new Map<string, LineageMember[]>();
  for (const m of members) {
    const key = m.hostname || "__invalid__";
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key)!.push(m);
  }

  const groups: LineageGroup[] = [];
  const unresolved: LineageMember[] = [];

  for (const [, ms] of byHost) {
    if (ms.length === 1) {
      // singleton, leave for unresolved
      unresolved.push(ms[0]);
      continue;
    }

    // Sort by publishedAt ascending so canonical = earliest
    const sorted = [...ms].sort((a, b) => {
      const ta = parseTime(a.publishedAt) ?? Number.POSITIVE_INFINITY;
      const tb = parseTime(b.publishedAt) ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    // Cluster by 72h repost heuristic. Only cluster when BOTH timestamps
    // are present; missing publishedAt → unclustered (no signal).
    const clusters: LineageMember[][] = [];
    for (const m of sorted) {
      const last = clusters[clusters.length - 1];
      if (!last || last.length === 0) {
        clusters.push([m]);
        continue;
      }
      const lastTime = parseTime(last[last.length - 1].publishedAt);
      const mTime = parseTime(m.publishedAt);
      if (
        lastTime !== null &&
        mTime !== null &&
        Math.abs(mTime - lastTime) < RECENT_REPOST_HOURS * MS_PER_HOUR
      ) {
        last.push(m);
      } else {
        // Either missing timestamp or > 72h apart → new cluster
        clusters.push([m]);
      }
    }

    for (const c of clusters) {
      // Single-element cluster: leave unresolved (already pushed if no timestamp).
      // Multi-element cluster: confirm it's a fold (not all-time-spaced).
      if (c.length === 1) {
        if (!unresolved.includes(c[0])) unresolved.push(c[0]);
        continue;
      }
      const canonical = pickCanonical(c);
      stats.folded += c.length;
      groups.push({
        canonicalUrl: canonical?.url ?? c[0].url,
        canonicalOutlet: canonical?.outlet,
        canonicalAuthor: canonical?.author,
        memberUrls: c.map((m) => m.url),
        independenceCorrected: c.length >= 3 ? "low" : "medium",
        detectionMethod: "url_hostname",
      });
    }
  }

  // ── Tier 3 fallback already implicit: unresolved stays as singletons ─
  return { groups, unresolved, stats };
}

function pickCanonical(ms: LineageMember[]): LineageMember | null {
  if (ms.length === 0) return null;
  const sorted = [...ms].sort((a, b) => {
    const ta = parseTime(a.publishedAt) ?? Number.POSITIVE_INFINITY;
    const tb = parseTime(b.publishedAt) ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return sorted[0];
}