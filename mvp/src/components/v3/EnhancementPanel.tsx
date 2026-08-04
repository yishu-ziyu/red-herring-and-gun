/**
 * EnhancementPanel.tsx — Plan Item 1 · P1 → Mission Control UI 接入
 *
 * 渲染 P1 整波 6 个模块的输出：
 *   - P1-1 KPA Key Points（support/oppose/context 立场分布）
 *   - P1-2 Kialo 子命题树（DFS 渲染）
 *   - P1-3 句子级引用溯源（每个 source 的 quote + 原文 span 偏移）
 *   - P1-4 来源历史信誉（hostname → unrated/positive/mixed/negative）
 *   - P1-5 谬误诊断（5 类常见谬误 + 原文 quote）
 *   - P1-6 盲点视图（独立来源统计 + 样本量判断）
 *
 * 设计：useEffect 异步加载；空态优雅降级（不显示该模块）。
 */

import { useEffect, useMemo, useState } from "react";
import type { FinalReport, DemoCase } from "../../lib/schemas";
import {
  buildEnhancements,
  type EnhancementBundle,
  FALLACY_TYPE_LABELS,
} from "../../lib/missionControlEnhancements";
import { iterateSubclaimTree } from "../../lib/subclaimTree";

interface EnhancementPanelProps {
  report: FinalReport;
  caseData?: DemoCase;
}

export function EnhancementPanel({ report, caseData }: EnhancementPanelProps) {
  const [bundle, setBundle] = useState<EnhancementBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    buildEnhancements(report, caseData).then((result) => {
      if (!cancelled) {
        setBundle(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [report, caseData]);

  const stanceSummary = useMemo(() => {
    if (!bundle) return null;
    const { stanceCounts } = bundle;
    return {
      ...stanceCounts,
      total: stanceCounts.support + stanceCounts.oppose + stanceCounts.context + stanceCounts.unstated,
    };
  }, [bundle]);

  if (loading || !bundle || !stanceSummary) {
    return (
      <div className="enhancement-panel" aria-label="增强分析面板">
        <div className="enhancement-panel-loading">分析中…</div>
      </div>
    );
  }

  return (
    <div className="enhancement-panel" aria-label="增强分析面板">
      <h3 className="enhancement-panel-title">P1 整波增强分析</h3>

      {/* P1-1 KPA */}
      {bundle.ranKpa && bundle.keyPoints.length > 0 ? (
        <section className="enhancement-section" data-testid="enhancement-kpa">
          <h4 className="enhancement-section-title">
            <span className="enhancement-tag">P1-1 KPA</span>
            关键论点抽取
          </h4>
          <ul className="enhancement-kpa-list">
            {bundle.keyPoints.slice(0, 5).map((kp) => (
              <li key={kp.id} className={`enhancement-kpa-item enhancement-kpa-${kp.stance}`}>
                <span className={`enhancement-stance enhancement-stance-${kp.stance}`}>
                  {kp.stance === "support" ? "支持" : kp.stance === "oppose" ? "反对" : "上下文"}
                </span>
                <span className="enhancement-kpa-text">{kp.text}</span>
                <span className="enhancement-kpa-conf">{(kp.confidence * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-2 子命题树 */}
      {bundle.subclaimTree.byId.size > 0 ? (
        <section className="enhancement-section" data-testid="enhancement-subclaim-tree">
          <h4 className="enhancement-section-title">
            <span className="enhancement-tag">P1-2 Kialo</span>
            子命题树
            <span className="enhancement-tree-count">
              ({stanceSummary.total} 个节点 · 深度 {bundle.subclaimTree.roots[0]?.depth ?? 0})
            </span>
          </h4>
          <ul className="enhancement-tree">
            {Array.from(iterateSubclaimTree(bundle.subclaimTree.roots)).map((node) => (
              <li
                key={node.subclaim.id}
                className="enhancement-tree-node"
                style={{ paddingLeft: `${node.depth * 16}px` }}
              >
                <span className="enhancement-tree-bullet" aria-hidden>•</span>
                <span className="enhancement-tree-text">{node.subclaim.text}</span>
                <span className="enhancement-tree-type">{node.subclaim.type}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-3 引用溯源 */}
      {bundle.citationSpans.length > 0 ? (
        <section className="enhancement-section" data-testid="enhancement-citations">
          <h4 className="enhancement-section-title">
            <span className="enhancement-tag">P1-3 引用</span>
            句子级引用溯源 ({bundle.citationSpans.length})
          </h4>
          <ul className="enhancement-citations">
            {bundle.citationSpans.slice(0, 5).map((s, i) => (
              <li key={i} className="enhancement-citation-item">
                <a
                  className="enhancement-citation-url"
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {s.url.length > 60 ? s.url.slice(0, 57) + "…" : s.url}
                </a>
                <span className={`enhancement-citation-verified ${s.verified ? "is-verified" : "is-unverified"}`}>
                  {s.verified ? "✓ 原文命中" : "○ 模糊匹配"}
                </span>
                <span className="enhancement-citation-snippet">「{s.snippet}」</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-4 来源信誉 */}
      {bundle.sourceReputations.length > 0 ? (
        <section className="enhancement-section" data-testid="enhancement-reputations">
          <h4 className="enhancement-section-title">
            <span className="enhancement-tag">P1-4 信誉</span>
            来源历史信誉
          </h4>
          <ul className="enhancement-reputations">
            {bundle.sourceReputations.map((r) => (
              <li key={r.hostname} className="enhancement-reputation-item">
                <span className="enhancement-reputation-host">{r.hostname}</span>
                <span className={`enhancement-reputation-label enhancement-reputation-${r.label}`}>
                  {labelText(r.label)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-5 谬误诊断 */}
      {bundle.fallacies.findings.length > 0 ? (
        <section className="enhancement-section" data-testid="enhancement-fallacies">
          <h4 className="enhancement-section-title">
            <span className="enhancement-tag">P1-5 谬误</span>
            逻辑谬误诊断 ({bundle.fallacies.findings.length})
          </h4>
          <ul className="enhancement-fallacies">
            {bundle.fallacies.findings.slice(0, 5).map((f, i) => (
              <li key={i} className="enhancement-fallacy-item">
                <span className="enhancement-fallacy-type">
                  {FALLACY_TYPE_LABELS[f.type]}
                </span>
                <span className="enhancement-fallacy-rationale">{f.rationale}</span>
                <span className="enhancement-fallacy-quote">「{f.quote}」</span>
                <span className="enhancement-fallacy-conf">{(f.confidence * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-6 盲点视图 */}
      <section className="enhancement-section" data-testid="enhancement-blindspot">
        <h4 className="enhancement-section-title">
          <span className="enhancement-tag">P1-6 盲点</span>
          盲点视图
          <span
            className={`enhancement-blindspot-tag ${
              bundle.blindSpot.hasEnoughSample ? "is-enough" : "is-short"
            }`}
          >
            {bundle.blindSpot.hasEnoughSample ? "样本足够" : "样本不足"}
          </span>
        </h4>
        <p className="enhancement-blindspot-summary">{bundle.blindSpotSummary}</p>
        {bundle.blindSpot.caveats.length > 0 ? (
          <ul className="enhancement-blindspot-caveats">
            {bundle.blindSpot.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function labelText(label: string): string {
  return label === "positive" ? "正向" : label === "mixed" ? "混合" : label === "negative" ? "负向" : "未评级";
}