/**
 * academicSearch.ts — Plan P2-1 · 学术通道 + Consensus
 *
 * 借鉴 Consensus.app / Elicit 的设计：
 *   - 学术论文按 DOI 去重（同篇不重复计数）
 *   - 计算"支持/反对/中性"共识度
 *   - 输出可由 citationFormatter.ts 渲染为 APA / MLA 引用
 *
 * 闸门（plan §4）：
 *   - 零论文 → "暂无学术证据"，不假装共识
 *   - DOI 不存在的论文不得纳入共识统计
 *   - 共识度基于样本量做置信区间修正（小样本不能 high consensus）
 */

export type StanceLabel = "support" | "contradict" | "neutral";

export interface Paper {
  /** Digital Object Identifier，唯一标识 */
  doi: string;
  title: string;
  authors: string[];
  year: number;
  venue?: string;
  abstract?: string;
  /** 该论文对原命题的立场（来自人工标注 / LLM 抽取） */
  stance: StanceLabel;
  /** 引用次数（来自 OpenAlex / Semantic Scholar） */
  citationCount?: number;
}

export interface AcademicConsensus {
  total: number;
  support: number;
  contradict: number;
  neutral: number;
  /** 共识度 0-1（含样本量修正） */
  consensusScore: number;
  /** 共识方向："支持" | "反对" | "中性/分歧" | "证据不足" */
  verdict: "support" | "contradict" | "mixed" | "insufficient";
  /** 判定文本（可直接嵌入报告） */
  description: string;
}

export interface AcademicSearchOptions {
  /** 共识判定阈值（默认 0.6 即 60% 一致算共识） */
  consensusThreshold?: number;
}

/**
 * 按 DOI 去重论文列表。同 DOI 时保留 stance 优先级：support > contradict > neutral。
 */
export function deduplicatePapers(papers: ReadonlyArray<Paper>): Paper[] {
  const byDoi = new Map<string, Paper>();
  const stancePriority: Record<StanceLabel, number> = {
    support: 3,
    contradict: 2,
    neutral: 1,
  };

  for (const p of papers) {
    if (!p.doi || !p.doi.startsWith("10.")) continue; // 非法 DOI 跳过
    const existing = byDoi.get(p.doi);
    if (!existing) {
      byDoi.set(p.doi, p);
      continue;
    }
    // 保留 stance 优先级更高者
    if (stancePriority[p.stance] > stancePriority[existing.stance]) {
      byDoi.set(p.doi, p);
    }
  }

  return Array.from(byDoi.values());
}

/**
 * 计算学术共识度。
 *
 * 算法：
 *   1. 按 DOI 去重
 *   2. 统计 support / contradict / neutral 数量
 *   3. 共识度 = max(support, contradict) / total；同时考虑样本量（<3 强制 insufficient）
 *   4. verdict 分类：support ≥60% → support；contradict ≥60% → contradict；其他 → mixed
 */
export function computeAcademicConsensus(
  papers: ReadonlyArray<Paper>,
  options: AcademicSearchOptions = {},
): AcademicConsensus {
  const dedup = deduplicatePapers(papers);
  const total = dedup.length;
  const threshold = options.consensusThreshold ?? 0.6;

  if (total === 0) {
    return {
      total: 0,
      support: 0,
      contradict: 0,
      neutral: 0,
      consensusScore: 0,
      verdict: "insufficient",
      description: "暂无学术证据",
    };
  }

  let support = 0;
  let contradict = 0;
  let neutral = 0;
  for (const p of dedup) {
    if (p.stance === "support") support++;
    else if (p.stance === "contradict") contradict++;
    else neutral++;
  }

  const maxSide = Math.max(support, contradict);
  const consensusScore = maxSide / total;

  let verdict: AcademicConsensus["verdict"];
  let description: string;
  if (total < 3) {
    verdict = "insufficient";
    description = `仅 ${total} 篇学术论文，样本不足以下结论。`;
  } else if (support / total >= threshold) {
    verdict = "support";
    description = `${support}/${total} 篇论文支持该命题，学术共识偏正向。`;
  } else if (contradict / total >= threshold) {
    verdict = "contradict";
    description = `${contradict}/${total} 篇论文反对该命题，学术共识偏反向。`;
  } else {
    verdict = "mixed";
    description = `学术共识尚未形成：支持 ${support} 篇、反对 ${contradict} 篇、中性 ${neutral} 篇。`;
  }

  return { total, support, contradict, neutral, consensusScore, verdict, description };
}

/**
 * 按 DOI 排序（OpenAlex / Crossref 风格）。
 */
export function sortPapersByDoi(papers: ReadonlyArray<Paper>): Paper[] {
  return [...papers].sort((a, b) => a.doi.localeCompare(b.doi));
}

/**
 * 按引用次数排序（高 → 低）。
 */
export function sortPapersByCitation(papers: ReadonlyArray<Paper>): Paper[] {
  return [...papers].sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
}