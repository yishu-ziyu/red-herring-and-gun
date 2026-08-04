/**
 * blindSpotAnalysis.ts — Plan P1-6 · 盲点视图（Ground News 借鉴）
 *
 * 输入：证据链（含 hostname / outlet）
 * 输出：来源类型分布 + 立场分布 + 样本量判断
 *
 * 关键不变量（plan §4）：
 *   - 缺席 ≠ 反对（某些来源未报道某事件不代表其否定）
 *   - 同源转载折叠后再统计
 *   - 独立来源 <3 时显示「样本不足」不强行结论
 *   - 不得通过域名硬编码推断政治立场
 */

export interface SourceBucket {
  hostname: string;
  outlet: string;
  /** 复转载计数（同源转载折叠） */
  count: number;
  /** 该来源在证据链中支持/反对/中性的次数 */
  support: number;
  contradict: number;
  neutral: number;
  /** 是否独立来源（折叠后只计 1） */
  independent: boolean;
}

export interface BlindSpotReport {
  buckets: SourceBucket[];
  /** 独立来源数 */
  independentCount: number;
  /** 总证据条数（含转载） */
  totalEvidence: number;
  /** 来源类型分布 */
  byType: Record<string, number>;
  /** 样本是否足够（>=3 独立来源） */
  hasEnoughSample: boolean;
  /** 缺口描述（给 UI 用） */
  caveats: string[];
}

const SAMPLE_MIN = 3;

/** 简化版来源类型分类（基于 hostname 后缀 / 关键词）；不强制政治立场 */
function classifyType(hostname: string): string {
  const h = hostname.toLowerCase();
  if (/\.gov(\.|$)|gouv|government/i.test(h)) return "政府/官方";
  if (/\.edu(\.|$)|\.ac\./i.test(h)) return "学术/教育";
  if (/(xinhua|people\.com\.cn|qq\.com|sohu\.com|163\.com|sina\.com\.cn|ifeng|chinadaily)/i.test(h))
    return "中文媒体";
  if (/(nytimes|washingtonpost|bbc|theguardian|reuters|apnews|bloomberg|npr)/i.test(h))
    return "国际媒体";
  if (/(weibo|zhihu|douyin|bilibili|xiaohongshu|mp\.weixin)/i.test(h)) return "社交平台/UGC";
  if (/(nature|springer|elsevier|arxiv|ieee|acm|wiley)/i.test(h)) return "学术期刊";
  if (/(github|gitlab)/i.test(h)) return "代码托管";
  return "其他";
}

/**
 * 把 evidence 列表按 hostname 折叠，并产出盲点视图。
 *
 * @param evidence 含 hostname + support/contradict/neutral 信号的列表
 */
export function buildBlindSpotReport(
  evidence: ReadonlyArray<{
    hostname: string;
    outlet?: string;
    signal: "support" | "contradict" | "neutral";
  }>,
): BlindSpotReport {
  const byHost = new Map<string, SourceBucket>();
  let total = 0;

  for (const e of evidence) {
    const host = (e.hostname ?? "").toLowerCase().replace(/^www\./, "").trim();
    if (!host) continue;
    total += 1;
    if (!byHost.has(host)) {
      byHost.set(host, {
        hostname: host,
        outlet: e.outlet ?? host,
        count: 0,
        support: 0,
        contradict: 0,
        neutral: 0,
        independent: true, // 折叠后再决定
      });
    }
    const b = byHost.get(host)!;
    b.count += 1;
    if (e.signal === "support") b.support += 1;
    else if (e.signal === "contradict") b.contradict += 1;
    else b.neutral += 1;
  }

  const buckets = Array.from(byHost.values()).sort((a, b) => b.count - a.count);

  // 计算 byType
  const byType: Record<string, number> = {};
  for (const b of buckets) {
    const t = classifyType(b.hostname);
    byType[t] = (byType[t] ?? 0) + b.count;
  }

  // 独立来源：折叠后每个 host 计 1
  const independentCount = buckets.length;

  const caveats: string[] = [];
  if (independentCount < SAMPLE_MIN) {
    caveats.push(
      `独立来源不足（${independentCount}/${SAMPLE_MIN}），样本不足以支撑立场分布结论。`,
    );
  }
  if (total === 0) {
    caveats.push("暂无证据来源。");
  }

  return {
    buckets,
    independentCount,
    totalEvidence: total,
    byType,
    hasEnoughSample: independentCount >= SAMPLE_MIN,
    caveats,
  };
}

/**
 * UI 渲染用：将盲点报告转为简单的中文摘要。
 */
export function summarizeBlindSpot(report: BlindSpotReport): string {
  if (report.totalEvidence === 0) {
    return "暂无证据来源。";
  }
  const topTypes = Object.entries(report.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${t}(${n})`)
    .join("、");
  const head = `共 ${report.totalEvidence} 条证据，来自 ${report.independentCount} 个独立来源；主要类型：${topTypes}。`;
  if (!report.hasEnoughSample) {
    return head + "（样本不足，仅供参考。）";
  }
  return head;
}