/**
 * sourceLineage.ts — 来源谱系折叠 (PR-2)
 *
 * 三层 fallback:LLM 关键词聚类 → URL hostname 匹配 → 全部独立。
 * 参考 peer spec §1.2 + §5。
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