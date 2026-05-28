/**
 * sherlockStyleSearch.ts — 多平台溯源搜索引擎
 *
 * 设计灵感来自 sherlock-project/sherlock：
 * - 数据驱动的平台配置 catalog（类似 sherlock 的 data.json）
 * - 查询模板插值 {?} 替换为搜索关键词
 * - 并行搜索多个信源平台
 * - 每个平台有独立的 detection strategy（status_code / message / response_url）
 *
 * 当前为 hackathon 演示实现：平台配置真实，搜索结果基于关键词匹配模拟。
 */

declare const process: { env: Record<string, string | undefined> } | undefined;

export interface SourceConfig {
  id: string;
  name: string;
  icon: string;
  category: "health" | "tech" | "society" | "finance" | "general";
  description: string;
  searchUrlTemplate: string;
  detectionStrategy: {
    type: "status_code" | "message" | "response_url";
    expected: number | string;
  };
  trustLevel: "high" | "medium" | "low";
  queryKeywords: string[]; // 用于演示匹配的关键词
}

export interface SourceHit {
  sourceId: string;
  sourceName: string;
  sourceIcon: string;
  matchedUrl: string;
  detectionMethod: string;
  trustLevel: string;
  matchedKeywords: string[];
  factCheckResult?: "true" | "false" | "partial" | "unverified";
  summary: string;
}

export interface SherlockSearchRequest {
  claim: string;
  keywords: string[];
  nodeTitle: string;
}

export interface SherlockSearchResponse {
  controllerNote: string;
  runTitle: string;
  traceText: string;
  hits: SourceHit[];
  sourcesSearched: number;
  sourcesMatched: number;
  canSay: string[];
  cannotSay: string[];
  model: string;
}

// ───────────────────────────────────────────────────────────────
// 平台配置 Catalog（类似 sherlock 的 site_list.json）
// ───────────────────────────────────────────────────────────────

export const FACT_CHECK_SOURCES: SourceConfig[] = [
  {
    id: "weibo_piyao",
    name: "微博辟谣",
    icon: "📢",
    category: "general",
    description: "微博官方辟谣平台，覆盖社会、健康、科技等多类谣言",
    searchUrlTemplate: "https://service.account.weibo.com/search?keyword={?}",
    detectionStrategy: { type: "message", expected: "rumor_refuted" },
    trustLevel: "high",
    queryKeywords: ["谣言", "辟谣", "假的", "不实", "网传"],
  },
  {
    id: "tencent_jiaozhen",
    name: "腾讯较真",
    icon: "🔎",
    category: "general",
    description: "腾讯新闻旗下事实查证平台，医学类核查较权威",
    searchUrlTemplate: "https://vp.fact.qq.com/search?keyword={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["健康", "医学", "疾病", "治疗", "致癌", "辐射", "中毒"],
  },
  {
    id: "science_piyao",
    name: "科学辟谣",
    icon: "🔬",
    category: "tech",
    description: "中国科协官方科学辟谣平台，专注科学类谣言",
    searchUrlTemplate: "https://piyao.kepuchina.cn/search?keyword={?}",
    detectionStrategy: { type: "message", expected: "science_verified" },
    trustLevel: "high",
    queryKeywords: ["科学", "辐射", "5G", "基因", "转基因", "疫苗", "化工"],
  },
  {
    id: "china_joint_piyao",
    name: "联合辟谣平台",
    icon: "🏛️",
    category: "society",
    description: "中央网信办指导的互联网联合辟谣平台",
    searchUrlTemplate: "https://www.piyao.org.cn/search.shtml?keyword={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["社会", "政策", "政府", "地铁", "停运", "封城", "通知"],
  },
  {
    id: "dingxiang_doctor",
    name: "丁香医生",
    icon: "🩺",
    category: "health",
    description: "泛健康领域科普平台，医学内容质量较高",
    searchUrlTemplate: "https://dxy.com/search?keyword={?}",
    detectionStrategy: { type: "message", expected: "health_article" },
    trustLevel: "medium",
    queryKeywords: ["健康", "养生", "食物", "隔夜", "致癌", "营养", "维生素"],
  },
  {
    id: "guokr",
    name: "果壳",
    icon: "🥜",
    category: "tech",
    description: "科技主题泛科普社区，辟谣类文章较活跃",
    searchUrlTemplate: "https://www.guokr.com/search/all/?keyword={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "medium",
    queryKeywords: ["科技", "辐射", "5G", "WiFi", "手机", "科学"],
  },
  {
    id: "caijing_piyao",
    name: "财经辟谣",
    icon: "💰",
    category: "finance",
    description: "财经类谣言核查，关注投资、汇率、股市相关",
    searchUrlTemplate: "https://finance.sina.com.cn/search?keyword={?}",
    detectionStrategy: { type: "message", expected: "finance_news" },
    trustLevel: "medium",
    queryKeywords: ["人民币", "贬值", "美元", "汇率", "股市", "投资", "理财"],
  },
  {
    id: "zhihu_factcheck",
    name: "知乎辟谣",
    icon: "📚",
    category: "general",
    description: "知乎社区事实核查话题下的优质回答聚合",
    searchUrlTemplate: "https://www.zhihu.com/search?type=content&q={?}+辟谣",
    detectionStrategy: { type: "response_url", expected: "zhihu.com/question" },
    trustLevel: "medium",
    queryKeywords: ["知乎", "如何评价", "是真的吗", "辟谣"],
  },
  // ── 国际平台 ──
  {
    id: "snopes",
    name: "Snopes",
    icon: "🔍",
    category: "general",
    description: "全球知名的事实核查网站，覆盖都市传说、谣言、假新闻",
    searchUrlTemplate: "https://www.snopes.com/?s={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["snopes", "fact", "check", "rumor"],
  },
  {
    id: "politifact",
    name: "PolitiFact",
    icon: "🏛️",
    category: "society",
    description: "美国政治类事实核查权威机构，以Truth-O-Meter评级著称",
    searchUrlTemplate: "https://www.politifact.com/search/?q={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["politifact", "politics", "policy", "election"],
  },
  {
    id: "factcheck_org",
    name: "FactCheck.org",
    icon: "📰",
    category: "general",
    description: "美国宾大安纳伯格公共政策中心旗下新闻事实核查平台",
    searchUrlTemplate: "https://www.factcheck.org/search/?q={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["factcheck", "news", "media", "report"],
  },
  {
    id: "reuters_factcheck",
    name: "Reuters Fact Check",
    icon: "📡",
    category: "general",
    description: "路透社旗下专业事实核查团队，专注社交媒体谣言核实",
    searchUrlTemplate: "https://www.reuters.com/fact-check/?q={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["reuters", "fact", "check", "verify"],
  },
  // ── 中文平台新增 ──
  {
    id: "pengpai_mingcha",
    name: "澎湃明查",
    icon: "📰",
    category: "general",
    description: "澎湃新闻旗下事实核查栏目，专注国际议题与热点事件",
    searchUrlTemplate: "https://www.thepaper.cn/searchResult.jsp?searchWord={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["澎湃", "明查", "调查", "核实"],
  },
  {
    id: "guancha_piyao",
    name: "观察者网辟谣",
    icon: "👁️",
    category: "society",
    description: "观察者网辟谣频道，聚焦社会热点与政治类谣言",
    searchUrlTemplate: "https://www.guancha.cn/search.shtml?q={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "medium",
    queryKeywords: ["观察者", "辟谣", "调查", "核实"],
  },
  {
    id: "baidu_piyao",
    name: "百度辟谣",
    icon: "🔍",
    category: "general",
    description: "百度联合权威机构打造的辟谣信息平台",
    searchUrlTemplate: "https://piyao.baidu.com/search?query={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "medium",
    queryKeywords: ["百度", "辟谣", "搜索", "核实"],
  },
  {
    id: "sogou_piyao",
    name: "搜狗辟谣",
    icon: "🐶",
    category: "general",
    description: "搜狗搜索旗下辟谣聚合平台，汇集多方权威信源",
    searchUrlTemplate: "https://www.sogou.com/web?query={?}+辟谣",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "medium",
    queryKeywords: ["搜狗", "辟谣", "搜索", "核实"],
  },
  // ── 专业平台 ──
  {
    id: "who_rumor_buster",
    name: "WHO 谣言粉碎机",
    icon: "🌍",
    category: "health",
    description: "世界卫生组织官方谣言粉碎专栏，专注健康与疫情类信息",
    searchUrlTemplate: "https://www.who.int/search?query={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["WHO", "谣言", "健康", "疫情", "疫苗"],
  },
  {
    id: "cdc_health_alert",
    name: "CDC 健康提醒",
    icon: "🏥",
    category: "health",
    description: "美国疾病控制与预防中心健康提醒与疾病信息",
    searchUrlTemplate: "https://search.cdc.gov/search/?query={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["CDC", "健康", "疾病", "预防", "指南"],
  },
  {
    id: "fda_safety_alert",
    name: "FDA 安全通报",
    icon: "💊",
    category: "health",
    description: "美国食品药品监督管理局药品与安全通报",
    searchUrlTemplate: "https://www.fda.gov/search?search_api_fulltext={?}",
    detectionStrategy: { type: "status_code", expected: 200 },
    trustLevel: "high",
    queryKeywords: ["FDA", "药物", "安全", "警告", "召回"],
  },
];

// ───────────────────────────────────────────────────────────────
// 查询模板插值（类似 sherlock 的 {?} 替换）
// ───────────────────────────────────────────────────────────────

export function interpolateQuery(template: string, keywords: string[]): string {
  const query = keywords.slice(0, 3).join("+");
  return template.replace(/{\?}/g, encodeURIComponent(query));
}

// ───────────────────────────────────────────────────────────────
// 关键词提取（简单规则，提取名词性关键词）
// ───────────────────────────────────────────────────────────────

export function extractKeywords(claim: string): string[] {
  const stopWords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "吗", "吧", "呢", "啊", "哦", "嗯", "对", "能", "都", "还", "让", "但", "而", "为", "以", "及", "与", "或", "如果", "因为", "所以", "虽然", "但是", "或者", "并且", "像", "被", "把", "给", "跟", "同", "比", "从", "向", "往", "于", "即", "将", "应该", "可能", "也许", "大概", "一定", "必须", "会", "能", "可以", "已经", "正在", "曾经", "过", "着", "了", "的", "地", "得",
  ]);

  const words = claim
    .replace(/[，。！？、；：""''（）【】《》]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 5);
}

// ───────────────────────────────────────────────────────────────
// 并行搜索调度（智能版：优先 MiMo LLM，回退到关键词匹配模拟）
// ───────────────────────────────────────────────────────────────

export async function searchClaimAcrossSources(
  claim: string,
  keywords?: string[],
): Promise<SherlockSearchResponse> {
  const searchKeywords = keywords && keywords.length > 0 ? keywords : extractKeywords(claim);

  // 如果 MiMo API Key 存在，优先调用 LLM 生成智能搜索结果
  const mimoApiKey =
    (typeof import.meta.env !== "undefined" && import.meta.env.MIMO_API_KEY) ||
    (typeof process !== "undefined" && process.env.MIMO_API_KEY) ||
    "";

  if (mimoApiKey) {
    try {
      const mimoResult = await callMimoForSherlockSearch(claim, searchKeywords);
      return {
        controllerNote: mimoResult.controllerNote,
        runTitle: "多平台溯源搜索（MiMo 智能搜索）",
        traceText: mimoResult.traceText,
        hits: mimoResult.hits.map((hit) => ({
          sourceId: hit.sourceId,
          sourceName: hit.sourceName,
          sourceIcon: hit.sourceIcon,
          matchedUrl: hit.matchedUrl,
          detectionMethod: hit.detectionMethod,
          trustLevel: hit.trustLevel,
          matchedKeywords: hit.matchedKeywords,
          factCheckResult: hit.factCheckResult,
          summary: hit.summary,
        })),
        sourcesSearched: FACT_CHECK_SOURCES.length,
        sourcesMatched: mimoResult.sourcesMatched,
        canSay: mimoResult.canSay.length > 0
          ? mimoResult.canSay
          : [`在 ${mimoResult.sourcesMatched} 个平台上找到相关核查记录`, "可以引用平台结果作为证据线索"],
        cannotSay: mimoResult.cannotSay.length > 0
          ? mimoResult.cannotSay
          : [
              "不能直接等同于权威结论",
              "需要进一步核查原始报道和研究报告",
              "平台结果可能存在滞后或覆盖不全",
            ],
        model: "mimo-llm-sherlock-search",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MiMo API 调用失败";
      // 静默回退到模拟模式，但保留 trace 说明
      return performSimulatedSearch(claim, searchKeywords, `MiMo 调用失败（${message}），回退到模拟模式。`);
    }
  }

  // 无 MiMo API Key，使用模拟关键词匹配
  return performSimulatedSearch(claim, searchKeywords);
}

// ───────────────────────────────────────────────────────────────
// 模拟搜索（回退模式）
// ───────────────────────────────────────────────────────────────

function performSimulatedSearch(
  claim: string,
  searchKeywords: string[],
  fallbackNote?: string,
): SherlockSearchResponse {
  const hits: SourceHit[] = [];

  for (const source of FACT_CHECK_SOURCES) {
    const matchedKeywords = searchKeywords.filter((kw) =>
      source.queryKeywords.some((qk) => qk.includes(kw) || kw.includes(qk)),
    );

    if (matchedKeywords.length > 0) {
      const matchedUrl = interpolateQuery(source.searchUrlTemplate, searchKeywords);
      const factCheckResult = simulateFactCheckResult(claim, source.category);

      hits.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceIcon: source.icon,
        matchedUrl,
        detectionMethod: `${source.detectionStrategy.type}=${source.detectionStrategy.expected}`,
        trustLevel: source.trustLevel,
        matchedKeywords,
        factCheckResult,
        summary: buildHitSummary(source, claim, factCheckResult),
      });
    }
  }

  // 按可信度排序
  hits.sort((a, b) => {
    const levelOrder = { high: 3, medium: 2, low: 1 };
    return levelOrder[b.trustLevel as keyof typeof levelOrder] - levelOrder[a.trustLevel as keyof typeof levelOrder];
  });

  const sourcesMatched = hits.length;

  return {
    controllerNote: fallbackNote
      ? `Sherlock-style 多平台溯源搜索（${fallbackNote}）：从 ${FACT_CHECK_SOURCES.length} 个平台中匹配到 ${sourcesMatched} 个相关信源。`
      : `Sherlock-style 多平台溯源搜索：从 ${FACT_CHECK_SOURCES.length} 个平台中匹配到 ${sourcesMatched} 个相关信源。`,
    runTitle: "多平台溯源搜索",
    traceText: `我对"${claim.slice(0, 30)}..."发起了 Sherlock 式多平台并行溯源搜索，命中 ${sourcesMatched} 个平台。`,
    hits,
    sourcesSearched: FACT_CHECK_SOURCES.length,
    sourcesMatched,
    canSay: sourcesMatched > 0
      ? [`在 ${sourcesMatched} 个平台上找到相关核查记录`, "可以引用平台结果作为证据线索"]
      : ["未在已知平台上找到直接核查记录"],
    cannotSay: [
      "不能直接等同于权威结论",
      "需要进一步核查原始报道和研究报告",
      "平台结果可能存在滞后或覆盖不全",
    ],
    model: "sherlock-style-parallel-search",
  };
}

// ───────────────────────────────────────────────────────────────
// 内部辅助
// ───────────────────────────────────────────────────────────────

function simulateFactCheckResult(
  claim: string,
  category: string,
): "true" | "false" | "partial" | "unverified" {
  const claimLower = claim.toLowerCase();

  // 简单规则模拟
  if (claimLower.includes("致癌") || claimLower.includes("中毒") || claimLower.includes("辐射导致")) {
    return "false";
  }
  if (claimLower.includes("贬值") || claimLower.includes("停运") || claimLower.includes("内部消息")) {
    return "unverified";
  }
  if (claimLower.includes("5g") || claimLower.includes("wifi")) {
    return "false";
  }
  if (category === "health" && claimLower.includes("隔夜")) {
    return "partial";
  }
  return "unverified";
}

function buildHitSummary(
  source: SourceConfig,
  claim: string,
  result?: string,
): string {
  const resultLabel: Record<string, string> = {
    true: "已核实为真",
    false: "已辟谣",
    partial: "部分属实",
    unverified: "暂无核查结论",
  };

  return `${source.name} (${source.description}) — ${resultLabel[result ?? "unverified"]}，可信度: ${source.trustLevel === "high" ? "高" : source.trustLevel === "medium" ? "中" : "低"}`;
}

// ───────────────────────────────────────────────────────────────
// 转换为 EvidenceClue（兼容现有递归搜索管道）
// ───────────────────────────────────────────────────────────────

import { callMimoForSherlockSearch } from "./mimoClient";
import type { EvidenceClue } from "./agentExpansion";

export function hitsToEvidenceClues(hits: SourceHit[], runId: string): EvidenceClue[] {
  return hits.map((hit, index) => ({
    id: `${runId}-hit-${index + 1}`,
    title: `${hit.sourceIcon} ${hit.sourceName}`,
    summary: hit.summary,
    source: hit.matchedUrl,
    role: hit.factCheckResult === "false" ? "counter" : hit.factCheckResult === "true" ? "support" : "context",
    confidence: hit.trustLevel === "high" ? "high" : hit.trustLevel === "medium" ? "medium" : "low",
  }));
}
