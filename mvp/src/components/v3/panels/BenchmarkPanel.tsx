import { useEffect, useMemo, useState } from "react";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import type { BenchmarkMetrics, KnowledgeBaseEntry } from "../../../lib/schemas";
import type { HandoffRun } from "../../../store/reasoningStore";

interface BenchmarkPanelProps {
  handoffRuns: HandoffRun[];
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectSources(cases: KnowledgeBaseEntry[]) {
  const counts = new Map<string, number>();
  cases.forEach((entry) => {
    entry.handoffSteps.forEach((step) => {
      ["sources", "verifiedSources"].forEach((key) => {
        const value = step.output[key];
        if (!Array.isArray(value)) return;
        value.forEach((item) => {
          if (typeof item !== "string" || !item.trim()) return;
          const source = item.trim().slice(0, 42);
          counts.set(source, (counts.get(source) ?? 0) + 1);
        });
      });
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([source]) => source);
}

export function BenchmarkPanel({ handoffRuns }: BenchmarkPanelProps) {
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);
  const [metrics, setMetrics] = useState<BenchmarkMetrics>({
    totalCases: handoffRuns.length,
    accuracyRate: 0,
    avgLatencyMs: 0,
    coverageByType: {},
    topSources: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      const [stats, cases] = await Promise.all([
        knowledgeBase.getStats(),
        knowledgeBase.listCases(),
      ]);
      if (cancelled) return;

      const totalRuns = handoffRuns.length;
      const passingRuns = handoffRuns.filter((run) => getNumber(run.finalReport?.credibilityScore) !== null).length;
      const avgLatencyMs = totalRuns > 0
        ? Math.round(handoffRuns.reduce((sum, run) => sum + run.totalLatencyMs, 0) / totalRuns)
        : 0;
      const coverageByType = Object.fromEntries(
        Object.entries(stats.typeDistribution).map(([type, total]) => [
          type,
          { total, correct: cases.filter((entry) => entry.rumorType === type && entry.credibilityScore >= 40).length },
        ])
      );

      setMetrics({
        totalCases: stats.totalCases || totalRuns,
        accuracyRate: totalRuns > 0 ? Math.round((passingRuns / totalRuns) * 100) : 0,
        avgLatencyMs,
        coverageByType,
        topSources: collectSources(cases),
      });
    }

    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [handoffRuns, knowledgeBase]);

  return (
    <div className="benchmark-panel">
      <div className="benchmark-heading">
        <span>Benchmark</span>
        <h2>核查质量面板</h2>
      </div>

      <div className="benchmark-metric-grid">
        <article>
          <span>案例数</span>
          <strong>{metrics.totalCases}</strong>
        </article>
        <article>
          <span>结构化完成率</span>
          <strong>{metrics.accuracyRate}%</strong>
        </article>
        <article>
          <span>平均耗时</span>
          <strong>{metrics.avgLatencyMs ? `${Math.round(metrics.avgLatencyMs / 1000)}s` : "-"}</strong>
        </article>
      </div>

      <section className="benchmark-section">
        <h3>类型覆盖</h3>
        {Object.entries(metrics.coverageByType).length > 0 ? (
          <div className="benchmark-coverage-list">
            {Object.entries(metrics.coverageByType).map(([type, value]) => (
              <div key={type} className="benchmark-coverage-row">
                <span>{type}</span>
                <div aria-hidden="true">
                  <i style={{ width: `${Math.max(8, Math.min(100, (value.correct / Math.max(value.total, 1)) * 100))}%` }} />
                </div>
                <em>{value.correct}/{value.total}</em>
              </div>
            ))}
          </div>
        ) : (
          <p>完成一次深度核查后会生成类型覆盖数据。</p>
        )}
      </section>

      <section className="benchmark-section">
        <h3>高频来源</h3>
        {metrics.topSources.length > 0 ? (
          <div className="benchmark-source-list">
            {metrics.topSources.map((source) => (
              <span key={source}>{source}</span>
            ))}
          </div>
        ) : (
          <p>暂无可复用来源。</p>
        )}
      </section>
    </div>
  );
}
