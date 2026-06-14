/**
 * sourceIndependence.ts — 来源独立性判断
 *
 * MVP 简化方案：基于 URL domain + 标题相似度去重
 * 后续迭代：引入 NLP 内容相似度分析
 */

import type { SearchResultSource } from "./schemas";

export interface SourceGroup {
  canonicalUrl: string;
  canonicalTitle: string;
  domain: string;
  sources: SearchResultSource[];
  isDuplicate: boolean;
  originalSourceUrl?: string;
}

/**
 * 判断两个来源是否为同一来源的转载
 * MVP 方案：domain 相同 + 标题相似度 > 0.7
 */
export function isSameSource(a: SearchResultSource, b: SearchResultSource): boolean {
  // 1. Domain 不同 → 视为独立来源
  if (normalizeDomain(a.domain) !== normalizeDomain(b.domain)) {
    return false;
  }

  // 2. URL 完全相同 → 同一来源
  if (normalizeUrl(a.url) === normalizeUrl(b.url)) {
    return true;
  }

  // 3. 标题相似度检查
  const titleSimilarity = calculateStringSimilarity(a.title, b.title);
  if (titleSimilarity > 0.75) {
    return true;
  }

  return false;
}

/**
 * 对多个来源进行去重分组
 */
export function groupSourcesByIndependence(
  sources: SearchResultSource[]
): SourceGroup[] {
  const groups: SourceGroup[] = [];

  for (const source of sources) {
    let foundGroup = false;

    for (const group of groups) {
      const representative = group.sources[0];
      if (isSameSource(representative, source)) {
        group.sources.push(source);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      groups.push({
        canonicalUrl: source.url,
        canonicalTitle: source.title,
        domain: source.domain,
        sources: [source],
        isDuplicate: false,
      });
    }
  }

  // 标记重复组
  groups.forEach((group) => {
    if (group.sources.length > 1) {
      group.isDuplicate = true;
      // 找最早的作为原始来源
      const earliest = [...group.sources].sort((a, b) => {
        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : Infinity;
        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : Infinity;
        return dateA - dateB;
      })[0];
      group.originalSourceUrl = earliest.url;
    }
  });

  return groups;
}

/**
 * 计算独立性评分
 */
export function calculateIndependenceScore(
  totalSources: number,
  independentGroups: number
): number {
  if (totalSources === 0) return 0;
  const ratio = independentGroups / totalSources;
  // 基础分 40 + 比例分 60
  return Math.round(40 + ratio * 60);
}

/**
 * 来源分级
 */
export function getSourceTier(domain: string, sourceType?: string): number {
  const domainTierMap: Record<string, number> = {
    "gov.cn": 1,
    "edu.cn": 1,
    "ac.cn": 1,
    "gov": 1,
    "edu": 1,
    "ac.uk": 1,
    "nih.gov": 1,
    "who.int": 1,
  };

  const typeTierMap: Record<string, number> = {
    "官方": 1,
    "学术": 1,
    "媒体": 2,
    "自媒体": 3,
    "论坛": 4,
    "未知": 4,
  };

  // 检查 domain 后缀
  for (const [suffix, tier] of Object.entries(domainTierMap)) {
    if (domain.endsWith(suffix)) return tier;
  }

  // 检查 sourceType
  if (sourceType && typeTierMap[sourceType]) {
    return typeTierMap[sourceType];
  }

  return 3; // 默认普通媒体
}

// ── 内部辅助 ────────────────────────────────────────────────────

function normalizeDomain(domain?: string): string {
  if (!domain) return "";
  return domain.toLowerCase().replace(/^www\./, "").trim();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * 简化的字符串相似度（Levenshtein-based）
 */
function calculateStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
