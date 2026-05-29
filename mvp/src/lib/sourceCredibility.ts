/**
 * sourceCredibility.ts — 信源可信度评估
 *
 * 基于域名/平台规则的简单信源可信度评估。
 * 用于证据分级和报告生成。
 */

export type CredibilityLevel = "高" | "中" | "低" | "未知";

export interface CredibilityResult {
  level: CredibilityLevel;
  domain: string;
  reason: string;
  category: "官方" | "学术" | "媒体" | "自媒体" | "论坛" | "未知";
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

function extractDomain(url: string): string {
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
  const domain = extractDomain(source);

  // 官方来源
  if (matchDomain(domain, HIGH_CREDIBILITY_DOMAINS)) {
    return {
      level: "高",
      domain,
      reason: "官方或权威学术来源，可信度高。",
      category: domain.includes("gov") || domain.includes("edu") ? "官方" : "学术",
    };
  }

  // 主流媒体
  if (matchDomain(domain, MEDIUM_CREDIBILITY_DOMAINS)) {
    return {
      level: "中",
      domain,
      reason: "主流商业媒体，需交叉验证。",
      category: "媒体",
    };
  }

  // 自媒体/论坛
  if (matchDomain(domain, LOW_CREDIBILITY_DOMAINS)) {
    return {
      level: "低",
      domain,
      reason: "自媒体或社交平台内容，原始性和准确性需谨慎对待。",
      category: domain.includes("weibo") || domain.includes("douyin") ? "自媒体" : "论坛",
    };
  }

  // 未知来源
  return {
    level: "未知",
    domain,
    reason: "无法识别来源类型，建议寻找更权威的出处。",
    category: "未知",
  };
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
