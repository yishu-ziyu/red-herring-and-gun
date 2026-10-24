import { topicTokens } from "../atomSearchQuery.js";
import { canonicalizeUrl } from "../publicWeb.js";
import type { SearchProviderId, SearchSource } from "./providers.js";

const RRF_K = 60;

const DENY_HOSTS = ["bit.ly", "t.cn", "tinyurl.com", "doubleclick.net", "googlesyndication.com"];

/** 解放军「钢铁长城」比喻，不是文物/工程长城。按命题文本绑定时拿掉，不当依据。 */
const WALL_METAPHOR_RE = /钢铁长城|(?:解放军|人民军队).{0,16}保卫祖国.{0,12}长城/;

const DEBUNK_RE = /(辟谣|不实|假消息|谣言|官方声明|从未发布|系编造|联合辟谣)/;
const OFFICIAL_URL_RE = /piyao\.org\.cn|news\.cn|xinhuanet|gmw\.cn|people\.com\.cn|\.gov\.cn/;
const OFFICIAL_TITLE_RE = /警方通报|公安|文旅局|联合辟谣平台/;

export type Hit = { provider: SearchProviderId; sources: SearchSource[] };

/** One page seen by one or more providers, under its canonical URL. */
export type Candidate = SearchSource & { providerOrigins: SearchProviderId[]; rrf: number };

function credibilityTier(c?: string): number {
  switch (c) {
    case "高":
      return 3;
    case "中":
      return 2;
    case "低":
      return 0;
    default:
      return 1;
  }
}

function isBetterCopy(a: SearchSource, b: SearchSource): boolean {
  const ta = credibilityTier(a.credibility);
  const tb = credibilityTier(b.credibility);
  return ta > tb || (ta === tb && a.snippet.length > b.snippet.length);
}

/**
 * Same page under different tracking parameters is one candidate. One query's results, provider
 * after provider in provider order, form one ranked list; reciprocal-rank fusion over the lists
 * scores how many queries and providers agree on a page.
 */
export function mergeHits(hitsByQuery: Hit[][]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const hits of hitsByQuery) {
    let index = 0;
    for (const hit of hits) {
      for (const source of hit.sources) {
        const rrf = 1 / (RRF_K + index + 1);
        index += 1;
        const url = canonicalizeUrl(source.url);
        if (!url) continue;
        const prev = byUrl.get(url);
        if (!prev) {
          byUrl.set(url, { ...source, url, providerOrigins: [hit.provider], rrf });
          continue;
        }
        byUrl.set(url, {
          ...(isBetterCopy(source, prev) ? source : prev),
          url,
          providerOrigins: prev.providerOrigins.includes(hit.provider) ? prev.providerOrigins : [...prev.providerOrigins, hit.provider],
          rrf: prev.rrf + rrf,
        });
      }
    }
  }
  return [...byUrl.values()];
}

function isDeniedHost(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return DENY_HOSTS.some((denied) => host === denied || host.endsWith(`.${denied}`));
}

function isOffTopicSource(atom: string, source: SearchSource): boolean {
  const blob = `${source.title} ${source.snippet}`;
  if (!atom.trim() || !blob.trim()) return false;
  return /长城/.test(atom) && !/钢铁长城|解放军|人民军队/.test(atom) && WALL_METAPHOR_RE.test(blob);
}

/** Roundup pages often omit the rumor keywords in the title; still prefer 典型案例/警方通报 when the atom is that class of tiny rumor. */
function patternBoost(atom: string, text: string): number {
  if (/P图|p图|侮辱/.test(atom) && /P图|侮辱|典型案例/.test(text)) return 6;
  if (/出轨/.test(atom) && /出轨|不实言论|典型案例/.test(text)) return 6;
  if (/电瓶车/.test(atom) && /电瓶车|非洲|境外|典型案例/.test(text)) return 6;
  return 0;
}

/**
 * Drops denied hosts and off-topic pages, then keeps the topK best. Pages are first put in order
 * of topical fit (debunk and official signals count only when the page overlaps the atom, then
 * provider agreement breaks ties); that order is 60% of the final score and page usability the other 40%.
 */
export function rankSources(atom: string, candidates: Candidate[], topK: number): SearchSource[] {
  const tokens = topicTokens(atom);
  const scored = candidates
    .filter((c) => !isDeniedHost(c.url) && !isOffTopicSource(atom, c))
    .map((c) => {
      const text = `${c.title} ${c.snippet}`;
      const overlap = tokens.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
      const debunk = DEBUNK_RE.test(text);
      const urlAndTitle = `${c.url} ${c.title}`;
      const official = OFFICIAL_URL_RE.test(urlAndTitle) || OFFICIAL_TITLE_RE.test(urlAndTitle);
      const fit = (overlap > 0 ? (debunk ? 10 : 0) + (official ? 5 : 0) : 0) + overlap * 3 + patternBoost(atom, `${text} ${c.url}`);
      const snippetLength = c.snippet.trim().length;
      const usability =
        40 +
        credibilityTier(c.credibility) * 15 +
        (snippetLength === 0 ? -20 : snippetLength < 40 ? -8 : snippetLength >= 80 ? 10 : 0) +
        (c.title.trim() ? 5 : -15) +
        (debunk ? 22 : 0) +
        (official ? 12 : 0);
      return { c, fit, usability: Math.max(0, Math.min(100, usability)) };
    })
    .sort((a, b) => b.fit - a.fit || b.c.rrf - a.c.rrf)
    .map((row, rank) => ({ ...row, score: 0.6 * Math.max(0, 100 - rank * 12) + 0.4 * row.usability }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, topK)).map(({ c }) => {
    const { providerOrigins, rrf, ...source } = c;
    return source;
  });
}
