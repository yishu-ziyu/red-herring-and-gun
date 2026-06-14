/**
 * sourceCredibility.ts — 信源可信度评估
 *
 * 基于域名/平台规则的简单信源可信度评估。
 * 用于证据分级和报告生成。
 */

import type { EvidenceRole, Search360Source, SearchSourceType } from "./schemas";

export type CredibilityLevel = "高" | "中" | "低" | "未知";

export interface CredibilityResult {
  level: CredibilityLevel;
  domain: string;
  reason: string;
  category: "官方" | "学术" | "媒体" | "自媒体" | "论坛" | "未知";
  score: number;
  tier: number;
}

// 高可信度来源
const HIGH_CREDIBILITY_DOMAINS = [
  // 政府/官方
  "gov.cn", "gov.hk", "gov.mo", "gov.tw",
  "mof.gov.cn", "ndrc.gov.cn", "samr.gov.cn",
  // 学术
  "edu.cn", "ac.cn", "cas.cn",
  // 权威媒体
  "people.com.cn", "xinhuanet.com", "cctv.com",
  "china.com.cn", "chinadaily.com.cn",
  // 国际组织
  "who.int", "un.org", "worldbank.org",
  // 学术数据库
  "cnki.net", "wanfangdata.com.cn", "pubmed.ncbi.nlm.nih.gov",
];

// 中等可信度来源
const MEDIUM_CREDIBILITY_DOMAINS = [
  // 主流商业媒体
  "sina.com.cn", "sohu.com", "163.com", "qq.com",
  "ifeng.com", "thepaper.cn", "caixin.com",
  // 专业垂直媒体
  "36kr.com", "tmtpost.com", "jiemian.com",
  // 百科/知识
  "baike.baidu.com", "zhihu.com",
];

// 低可信度来源
const LOW_CREDIBILITY_DOMAINS = [
  // 自媒体平台
  "weibo.com", "mp.weixin.qq.com", "toutiao.com",
  "douyin.com", "kuaishou.com", "bilibili.com",
  // 论坛
  "tieba.baidu.com", "zhihu.com/question", "douban.com",
  // 未知/可疑
  "blogspot.com", "wordpress.com",
];

export function extractSourceDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function matchDomain(domain: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith("*")) {
      return domain.endsWith(pattern.slice(1));
    }
    return domain === pattern || domain.endsWith(`.${pattern}`);
  });
}

export function assessSourceCredibility(source: string): CredibilityResult {
  const domain = extractSourceDomain(source);

  // 官方来源
  if (matchDomain(domain, HIGH_CREDIBILITY_DOMAINS)) {
    return {
      level: "高",
      domain,
      reason: "官方或权威学术来源，可信度高。",
      category: domain.includes("gov") || domain.includes("edu") ? "官方" : "学术",
      score: 92,
      tier: 1,
    };
  }

  // 主流媒体
  if (matchDomain(domain, MEDIUM_CREDIBILITY_DOMAINS)) {
    return {
      level: "中",
      domain,
      reason: "主流商业媒体，需交叉验证。",
      category: "媒体",
      score: 68,
      tier: 3,
    };
  }

  // 自媒体/论坛
  if (matchDomain(domain, LOW_CREDIBILITY_DOMAINS)) {
    return {
      level: "低",
      domain,
      reason: "自媒体或社交平台内容，原始性和准确性需谨慎对待。",
      category: domain.includes("weibo") || domain.includes("douyin") ? "自媒体" : "论坛",
      score: 32,
      tier: 6,
    };
  }

  // 未知来源
  return {
    level: "未知",
    domain,
    reason: "无法识别来源类型，建议寻找更权威的出处。",
    category: "未知",
    score: 45,
    tier: 4,
  };
}

function scoreLevelFromCredibility(score: number): "高" | "中" | "低" {
  if (score >= 75) return "高";
  if (score >= 50) return "中";
  return "低";
}

export function sourceTypeFromCredibilityCategory(category: CredibilityResult["category"]): SearchSourceType {
  if (category === "官方" || category === "学术" || category === "媒体" || category === "自媒体" || category === "论坛") {
    return category;
  }
  return "未知";
}

export function scoreFreshnessFromTimestamp(timestamp?: number): number {
  if (!timestamp || !Number.isFinite(timestamp)) return 50;

  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays < 30) return 100;
  if (ageDays < 180) return 80;
  if (ageDays < 365) return 60;
  if (ageDays < 1095) return 40;
  if (ageDays < 1825) return 25;
  return 10;
}

export function parseSourceTimestamp(source: unknown): number | undefined {
  if (!source || typeof source !== "object") return undefined;
  const item = source as Record<string, unknown>;
  const raw =
    item.publishedTimestamp ||
    item.publishTimestamp ||
    item.timestamp ||
    item.pub_time ||
    item.publish_time ||
    item.published_at ||
    item.publishDate ||
    item.date ||
    item.time;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }

  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function inferEvidenceRoleFromText(input: {
  title?: string;
  snippet?: string;
  query?: string;
  direction?: "support" | "contradict" | "neutral";
}): EvidenceRole {
  if (input.direction === "support") return "支持";
  if (input.direction === "contradict") return "反驳";

  const text = `${input.title ?? ""} ${input.snippet ?? ""} ${input.query ?? ""}`.toLowerCase();
  if (/(辟谣|不实|虚假|假的|误读|反驳|谣言|无法证实|未证实|不准确|夸大)/.test(text)) return "反驳";
  if (/(官方回应|证实|确认|证明|依据|来源|公告|通报)/.test(text)) return "支持";
  if (/(背景|科普|解释|解读|上下文)/.test(text)) return "背景";
  if (/(线索|网传|爆料|社交|帖子)/.test(text)) return "线索";
  return "限定";
}

export function enrichSearch360Source(
  source: Search360Source,
  index = 0,
  options: { query?: string; direction?: "support" | "contradict" | "neutral"; raw?: unknown } = {}
): Search360Source {
  const domain = source.domain || extractSourceDomain(source.url || source.title);
  const credibility = assessSourceCredibility(source.url || domain || source.title);
  const publishedTimestamp = source.publishedTimestamp ?? parseSourceTimestamp(options.raw ?? source);
  const freshnessScore = source.freshnessScore ?? scoreFreshnessFromTimestamp(publishedTimestamp);
  const credibilityScore = source.credibilityScore ?? Math.max(0, Math.min(100, credibility.score - Math.max(0, index - 2) * 3));

  return {
    ...source,
    id: source.id ?? `S${index + 1}`,
    domain,
    sourceType: source.sourceType ?? sourceTypeFromCredibilityCategory(credibility.category),
    credibility: source.credibility ?? scoreLevelFromCredibility(credibilityScore),
    credibilityScore,
    sourceTier: source.sourceTier ?? credibility.tier,
    freshnessScore,
    publishedTimestamp,
    evidenceRole: source.evidenceRole ?? inferEvidenceRoleFromText({
      title: source.title,
      snippet: source.snippet,
      query: options.query,
      direction: options.direction,
    }),
  };
}

export function calculateSourceDiversity(domains: string[]): number {
  const normalized = domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return 0;

  const uniqueCount = new Set(normalized).size;
  return Math.round(Math.min(1, uniqueCount / Math.max(1, normalized.length * 0.5)) * 100);
}

/**
 * 批量评估多个来源，返回平均可信度
 */
export function assessSourcesCredibility(sources: string[]): {
  averageLevel: CredibilityLevel;
  results: CredibilityResult[];
  highCount: number;
  mediumCount: number;
  lowCount: number;
} {
  const results = sources.map((s) => assessSourceCredibility(s));

  const highCount = results.filter((r) => r.level === "高").length;
  const mediumCount = results.filter((r) => r.level === "中").length;
  const lowCount = results.filter((r) => r.level === "低").length;

  let averageLevel: CredibilityLevel = "未知";
  if (highCount > mediumCount + lowCount) {
    averageLevel = "高";
  } else if (mediumCount >= highCount && mediumCount >= lowCount) {
    averageLevel = "中";
  } else if (lowCount > 0) {
    averageLevel = "低";
  }

  return { averageLevel, results, highCount, mediumCount, lowCount };
}
