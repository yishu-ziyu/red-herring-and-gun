/**
 * EvidenceMatrixCSS.tsx — 方案 A：纯 CSS Transition
 *
 * 设计概念：「证据卷宗展开」
 * - 摒弃表格，改为纵向卷宗卡片
 * - 卡片 stagger 进入动画
 * - 搜索引擎结果以彩色标签横向展示
 * - 共识状态用圆环动画表示
 */

import { useEffect, useState } from "react";
import type { EvidenceConsensusReport, MultiSearchJob } from "../../lib/schemas";

interface Props {
  consensusReport: EvidenceConsensusReport;
  searchJobs: MultiSearchJob[];
}

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  "360_search": { label: "360", color: "#2563eb" },
  "any_search": { label: "Any", color: "#7c3aed" },
  "metaso_search": { label: "Metaso", color: "#059669" },
  "tavily_search": { label: "Tavily", color: "#dc2626" },
  "exa_search": { label: "Exa", color: "#ea580c" },
};

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    "可进入推理": { bg: "#f0fdf4", border: "#86efac", text: "#166534", icon: "✓" },
    "存疑": { bg: "#fefce8", border: "#fde047", text: "#854d0e", icon: "?" },
    "需人工复核": { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", icon: "!" },
  };
  const c = config[status] || config["存疑"];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 12px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
        fontFamily: 'var(--font-sans)',
      }}
    >
      {c.icon} {status}
    </span>
  );
}

function ConsensusRing({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";

  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e8e4d9" strokeWidth={5} />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          fontWeight: 700,
          color,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {score}%
      </div>
    </div>
  );
}

export function EvidenceMatrixCSS({ consensusReport }: Props) {
  const [visibleCards, setVisibleCards] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    consensusReport.propositionResults.forEach((result, index) => {
      const timer = setTimeout(() => {
        setVisibleCards((prev) => new Set([...prev, result.propositionId]));
      }, index * 350);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  }, [consensusReport.propositionResults]);

  return (
    <div className="em-css-container">
      {/* 标题区 */}
      <div className="em-css-header">
        <span className="em-css-header-icon">📊</span>
        <h3 className="em-css-header-title">证据矩阵 — 多搜索引擎交叉验证</h3>
      </div>

      {/* 统计卡片 */}
      <div className="em-css-stats">
        {[
          { label: "可进入推理", value: consensusReport.overallStats.readyForReasoning, color: "#16a34a" },
          { label: "存疑", value: consensusReport.overallStats.doubtful, color: "#d97706" },
          { label: "需人工复核", value: consensusReport.overallStats.needsManualReview, color: "#dc2626" },
          { label: "独立来源", value: consensusReport.overallStats.totalIndependentSources, color: "#2B7FD8" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className="em-css-stat-card"
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <div className="em-css-stat-value" style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div className="em-css-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 卷宗卡片列表 */}
      <div className="em-css-cards">
        {consensusReport.propositionResults.map((result, index) => {
          const isVisible = visibleCards.has(result.propositionId);
          const supports = result.providerResults.filter((r) => r.supportsProposition === true);
          const contradicts = result.providerResults.filter((r) => r.contradictsProposition === true);
          const undecided = result.providerResults.filter(
            (r) => r.supportsProposition === null && r.contradictsProposition === null && r.status !== "failed"
          );
          const failed = result.providerResults.filter((r) => r.status === "failed");

          return (
            <div
              key={result.propositionId}
              className={`em-css-card ${isVisible ? "em-css-card--visible" : ""}`}
              style={{ transitionDelay: `${index * 0.08}s` }}
            >
              {/* 卡片头部 */}
              <div className="em-css-card-header">
                <div className="em-css-card-index">A{index + 1}</div>
                <div className="em-css-card-title">{result.propositionText}</div>
                <StatusBadge status={result.status} />
              </div>

              {/* 搜索引擎标签 */}
              <div className="em-css-card-tags">
                {supports.map((r, i) => (
                  <span
                    key={`s-${i}`}
                    className="em-css-tag em-css-tag--support"
                    style={{ animationDelay: `${0.2 + i * 0.08}s` }}
                  >
                    <span className="em-css-tag-dot" style={{ background: "#16a34a" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">{r.sourceCount}来源</span>
                  </span>
                ))}
                {contradicts.map((r, i) => (
                  <span
                    key={`c-${i}`}
                    className="em-css-tag em-css-tag--contradict"
                    style={{ animationDelay: `${0.3 + i * 0.08}s` }}
                  >
                    <span className="em-css-tag-dot" style={{ background: "#dc2626" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">{r.sourceCount}来源</span>
                  </span>
                ))}
                {undecided.map((r, i) => (
                  <span
                    key={`u-${i}`}
                    className="em-css-tag em-css-tag--undecided"
                    style={{ animationDelay: `${0.4 + i * 0.08}s` }}
                  >
                    <span className="em-css-tag-dot" style={{ background: "#888888" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">未判定</span>
                  </span>
                ))}
                {failed.map((r, i) => (
                  <span
                    key={`f-${i}`}
                    className="em-css-tag em-css-tag--failed"
                    style={{ animationDelay: `${0.5 + i * 0.08}s` }}
                  >
                    <span className="em-css-tag-dot" style={{ background: "#e8e4d9" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">失败</span>
                  </span>
                ))}
              </div>

              {/* 卡片底部 */}
              <div className="em-css-card-footer">
                <div className="em-css-card-meta">
                  <span>独立来源 {result.evidenceIndependence.independentSources}/{result.evidenceIndependence.totalSources}</span>
                  <span>反证：{result.counterEvidenceCoverage.verdict}</span>
                </div>
                <ConsensusRing score={result.evidenceIndependence.independenceScore} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="em-css-legend">
        <span>图例：</span>
        <span><span className="em-css-legend-dot" style={{ background: "#16a34a" }} /> 支持</span>
        <span><span className="em-css-legend-dot" style={{ background: "#dc2626" }} /> 反驳</span>
        <span><span className="em-css-legend-dot" style={{ background: "#888888" }} /> 未判定</span>
        <span><span className="em-css-legend-dot" style={{ background: "#e8e4d9" }} /> 失败</span>
      </div>
    </div>
  );
}

export default EvidenceMatrixCSS;
