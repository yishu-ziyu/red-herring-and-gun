/**
 * EvidenceMatrixGSAP.tsx — 方案 B：GSAP Timeline + 滚动叙事
 *
 * 设计概念：「证据时间轴」
 * - GSAP timeline 控制整个动画节奏
 * - 统计卡片 stagger 飞入
 * - 原子命题卡片从下方滑入 + 轻微弹性
 * - 搜索引擎标签从中心 scale 展开
 * - 共识圆环 stroke-dashoffset 绘制动画
 * - 整体像一段有节奏的信息短片
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
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
        fontFamily: "var(--font-sans)",
      }}
    >
      {c.icon} {status}
    </span>
  );
}

function ConsensusRing({ score, delay }: { score: number; delay: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  const ringRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ringRef.current) return;
    gsap.fromTo(
      ringRef.current,
      { strokeDashoffset: circumference },
      { strokeDashoffset: offset, duration: 1.2, delay, ease: "power2.out" }
    );
    if (textRef.current) {
      gsap.fromTo(
        textRef.current,
        { scale: 0.5, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.5, delay: delay + 0.8, ease: "back.out(1.7)" }
      );
    }
  }, [circumference, offset, delay]);

  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e8e4d9" strokeWidth={5} />
        <circle
          ref={ringRef}
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
      <div
        ref={textRef}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          fontWeight: 700,
          color,
          fontFamily: "var(--font-sans)",
          opacity: 0,
        }}
      >
        {score}%
      </div>
    </div>
  );
}

export function EvidenceMatrixGSAP({ consensusReport }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    // 1. 容器淡入
    tl.fromTo(
      containerRef.current,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5 }
    );

    // 2. 统计卡片 stagger 飞入（带轻微弹性）
    if (statsRef.current) {
      const statCards = statsRef.current.querySelectorAll(".em-gsap-stat");
      tl.fromTo(
        statCards,
        { opacity: 0, y: 30, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.1, ease: "back.out(1.2)" },
        "-=0.2"
      );
    }

    // 3. 卷宗卡片 stagger 滑入
    if (cardsRef.current) {
      const cards = cardsRef.current.querySelectorAll(".em-gsap-card");
      cards.forEach((card, index) => {
        const tags = card.querySelectorAll(".em-gsap-tag");
        const ring = card.querySelector(".em-gsap-ring-wrapper");

        // 卡片滑入
        tl.fromTo(
          card,
          { opacity: 0, y: 50 },
          { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" },
          index === 0 ? "-=0.1" : "-=0.4"
        );

        // 标签从中心 scale 展开
        if (tags.length > 0) {
          tl.fromTo(
            tags,
            { opacity: 0, scale: 0.8, y: 10 },
            { opacity: 1, scale: 1, y: 0, duration: 0.35, stagger: 0.06, ease: "back.out(1.5)" },
            "-=0.3"
          );
        }
      });
    }

    return () => {
      tl.kill();
    };
  }, [consensusReport]);

  return (
    <div ref={containerRef} className="em-gsap-container" style={{ opacity: 0 }}>
      {/* 标题区 */}
      <div className="em-css-header">
        <span className="em-css-header-icon">📊</span>
        <h3 className="em-css-header-title">证据矩阵 — 多搜索引擎交叉验证</h3>
      </div>

      {/* 统计卡片 */}
      <div ref={statsRef} className="em-css-stats">
        {[
          { label: "可进入推理", value: consensusReport.overallStats.readyForReasoning, color: "#16a34a" },
          { label: "存疑", value: consensusReport.overallStats.doubtful, color: "#d97706" },
          { label: "需人工复核", value: consensusReport.overallStats.needsManualReview, color: "#dc2626" },
          { label: "独立来源", value: consensusReport.overallStats.totalIndependentSources, color: "#2B7FD8" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="em-gsap-stat em-css-stat-card"
            style={{ opacity: 0 }}
          >
            <div className="em-css-stat-value" style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div className="em-css-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 卷宗卡片列表 */}
      <div ref={cardsRef} className="em-css-cards">
        {consensusReport.propositionResults.map((result, index) => {
          const supports = result.providerResults.filter((r) => r.supportsProposition === true);
          const contradicts = result.providerResults.filter((r) => r.contradictsProposition === true);
          const undecided = result.providerResults.filter(
            (r) => r.supportsProposition === null && r.contradictsProposition === null && r.status !== "failed"
          );
          const failed = result.providerResults.filter((r) => r.status === "failed");

          return (
            <div
              key={result.propositionId}
              className="em-gsap-card em-css-card"
              style={{ opacity: 0 }}
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
                  <span key={`s-${i}`} className="em-gsap-tag em-css-tag em-css-tag--support">
                    <span className="em-css-tag-dot" style={{ background: "#16a34a" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">{r.sourceCount}来源</span>
                  </span>
                ))}
                {contradicts.map((r, i) => (
                  <span key={`c-${i}`} className="em-gsap-tag em-css-tag em-css-tag--contradict">
                    <span className="em-css-tag-dot" style={{ background: "#dc2626" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">{r.sourceCount}来源</span>
                  </span>
                ))}
                {undecided.map((r, i) => (
                  <span key={`u-${i}`} className="em-gsap-tag em-css-tag em-css-tag--undecided">
                    <span className="em-css-tag-dot" style={{ background: "#888888" }} />
                    {PROVIDER_META[r.provider]?.label || r.provider}
                    <span className="em-css-tag-count">未判定</span>
                  </span>
                ))}
                {failed.map((r, i) => (
                  <span key={`f-${i}`} className="em-gsap-tag em-css-tag em-css-tag--failed">
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
                <div className="em-gsap-ring-wrapper">
                  <ConsensusRing score={result.evidenceIndependence.independenceScore} delay={0} />
                </div>
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

export default EvidenceMatrixGSAP;
