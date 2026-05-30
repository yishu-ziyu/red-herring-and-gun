/**
 * EvidenceMatrix.tsx — 证据矩阵（多搜索引擎交叉验证核心展示组件）
 *
 * 功能：
 * - 展示原子命题 × 搜索 Provider 的交叉验证结果
 * - 支持点击单元格打开 EvidenceDetailDrawer
 * - 展示共识状态、独立性评分、来源等级
 */

import { useState, useCallback, Fragment } from "react";
import type {
  EvidenceConsensusReport,
  MultiSearchJob,
  ConsensusStatus,
  ProviderConsensusResult,
} from "../../lib/schemas";

interface EvidenceMatrixProps {
  consensusReport: EvidenceConsensusReport;
  searchJobs: MultiSearchJob[];
  onCellClick?: (propositionId: string, provider: string) => void;
  onStatusClick?: (propositionId: string) => void;
}

// ── 状态标签渲染 ────────────────────────────────────────────────

function StatusBadge({ status }: { status: ConsensusStatus }) {
  const config: Record<
    ConsensusStatus,
    { bg: string; border: string; text: string; label: string; icon: string }
  > = {
    可进入推理: {
      bg: "#f0fdf4",
      border: "#86efac",
      text: "#166534",
      label: "可进入推理",
      icon: "✓",
    },
    存疑: {
      bg: "#fefce8",
      border: "#fde047",
      text: "#854d0e",
      label: "存疑",
      icon: "?",
    },
    需人工复核: {
      bg: "#fef2f2",
      border: "#fca5a5",
      text: "#991b1b",
      label: "需人工复核",
      icon: "!",
    },
  };

  const c = config[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}

// ── Provider 单元格渲染 ─────────────────────────────────────────

function ProviderCell({
  result,
  onClick,
}: {
  result: ProviderConsensusResult | undefined;
  onClick?: () => void;
}) {
  if (!result) {
    return (
      <div
        style={{
          padding: "12px 8px",
          textAlign: "center",
          color: "var(--zt-text-muted)",
          fontSize: "12px",
        }}
      >
        —
      </div>
    );
  }

  if (result.status === "failed") {
    return (
      <div
        style={{
          padding: "12px 8px",
          textAlign: "center",
          color: "var(--zt-alert)",
          fontSize: "12px",
        }}
      >
        ✕ 失败
      </div>
    );
  }

  const getIcon = () => {
    if (result.supportsProposition === true) return "✅";
    if (result.contradictsProposition === true) return "❌";
    if (result.sourceCount === 0) return "❓";
    return "🟡";
  };

  const getLabel = () => {
    if (result.supportsProposition === true) return "支持";
    if (result.contradictsProposition === true) return "反驳";
    if (result.sourceCount === 0) return "未证实";
    return "未判定";
  };

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        padding: "10px 8px",
        background: "transparent",
        border: "none",
        cursor: onClick ? "pointer" : "default",
        width: "100%",
        fontFamily: "inherit",
        fontSize: "inherit",
        transition: "background 150ms",
        borderRadius: "6px",
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = "var(--zt-bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: "16px" }}>{getIcon()}</span>
      <span style={{ fontSize: "11px", color: "var(--zt-text-secondary)" }}>
        {getLabel()}
      </span>
      <span style={{ fontSize: "10px", color: "var(--zt-text-muted)" }}>
        {result.sourceCount} 来源
      </span>
    </button>
  );
}

// ── 原始来源单元格 ──────────────────────────────────────────────

function OriginalSourceCell({
  hasOriginal,
  isExpired,
}: {
  hasOriginal: boolean;
  isExpired?: boolean;
}) {
  if (!hasOriginal) {
    return (
      <div
        style={{
          padding: "12px 8px",
          textAlign: "center",
          fontSize: "12px",
          color: "var(--zt-text-muted)",
        }}
      >
        ❌ 未找到
      </div>
    );
  }

  if (isExpired) {
    return (
      <div
        style={{
          padding: "12px 8px",
          textAlign: "center",
          fontSize: "12px",
          color: "var(--zt-warning)",
        }}
      >
        ⚠️ 找到但过期
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "12px 8px",
        textAlign: "center",
        fontSize: "12px",
        color: "var(--zt-success)",
      }}
    >
      ✅ 找到
    </div>
  );
}

// ── 反证单元格 ─────────────────────────────────────────────────

function CounterEvidenceCell({
  verdict,
}: {
  verdict: "反证已覆盖" | "暂未发现反证" | "反证检索未执行";
}) {
  const config: Record<string, { icon: string; color: string }> = {
    反证已覆盖: { icon: "✅", color: "var(--zt-alert)" },
    暂未发现反证: { icon: "🚫", color: "var(--zt-text-muted)" },
    反证检索未执行: { icon: "⏸️", color: "var(--zt-text-muted)" },
  };

  const c = config[verdict];
  return (
    <div
      style={{
        padding: "12px 8px",
        textAlign: "center",
        fontSize: "12px",
        color: c.color,
      }}
    >
      {c.icon} {verdict}
    </div>
  );
}

// ── 独立性评分 ─────────────────────────────────────────────────

function IndependenceScore({ score }: { score: number }) {
  const color =
    score >= 80 ? "var(--zt-success)" : score >= 50 ? "var(--zt-warning)" : "var(--zt-alert)";

  return (
    <div
      style={{
        padding: "12px 8px",
        textAlign: "center",
        fontSize: "14px",
        fontWeight: 700,
        color,
      }}
    >
      {score}%
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────

export function EvidenceMatrix({
  consensusReport,
  searchJobs,
  onCellClick,
  onStatusClick,
}: EvidenceMatrixProps) {
  const [hoveredCell, setHoveredCell] = useState<{
    propId: string;
    provider: string;
  } | null>(null);

  const providers = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];
  const providerLabels: Record<string, string> = {
    "360_search": "360 Search",
    "any_search": "AnySearch",
    "metaso_search": "Metaso",
    "tavily_search": "Tavily",
    "exa_search": "Exa",
  };

  const handleCellClick = useCallback(
    (propId: string, provider: string) => {
      onCellClick?.(propId, provider);
    },
    [onCellClick]
  );

  return (
    <div
      style={{
        background: "var(--zt-bg-panel)",
        borderRadius: "var(--zt-radius-md)",
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
      }}
    >
      {/* 标题区 */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "18px" }}>📊</span>
        <h3
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--zt-text)",
          }}
        >
          证据矩阵 — 多搜索引擎交叉验证
        </h3>
      </div>

      {/* 统计卡片 */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {[
          {
            label: "可进入推理",
            value: consensusReport.overallStats.readyForReasoning,
            color: "#16a34a",
          },
          {
            label: "存疑",
            value: consensusReport.overallStats.doubtful,
            color: "#d97706",
          },
          {
            label: "需人工复核",
            value: consensusReport.overallStats.needsManualReview,
            color: "#dc2626",
          },
          {
            label: "独立来源",
            value: consensusReport.overallStats.totalIndependentSources,
            color: "var(--zt-primary)",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "var(--zt-radius-sm)",
              background: "var(--zt-bg-elevated)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: stat.color,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--zt-text-muted)",
                marginTop: "2px",
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* 矩阵表格 */}
      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(240px, 1fr) repeat(${providers.length}, 110px) 110px 120px 80px 110px`,
            minWidth: "1040px",
          }}
        >
          {/* 表头 */}
          <div
            style={{
              padding: "12px 16px",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--zt-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--zt-bg-elevated)",
            }}
          >
            原子命题
          </div>
          {providers.map((p) => (
            <div
              key={p}
              style={{
                padding: "12px 8px",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--zt-text-secondary)",
                textAlign: "center",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--zt-bg-elevated)",
              }}
            >
              {providerLabels[p]}
            </div>
          ))}
          <div
            style={{
              padding: "12px 8px",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--zt-text-secondary)",
              textAlign: "center",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--zt-bg-elevated)",
            }}
          >
            原始来源
          </div>
          <div
            style={{
              padding: "12px 8px",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--zt-text-secondary)",
              textAlign: "center",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--zt-bg-elevated)",
            }}
          >
            反证
          </div>
          <div
            style={{
              padding: "12px 8px",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--zt-text-secondary)",
              textAlign: "center",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--zt-bg-elevated)",
            }}
          >
            独立性
          </div>
          <div
            style={{
              padding: "12px 8px",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--zt-text-secondary)",
              textAlign: "center",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--zt-bg-elevated)",
            }}
          >
            状态
          </div>

          {/* 数据行 */}
          {consensusReport.propositionResults.map((result, idx) => {
            const isEven = idx % 2 === 0;
            return (
              <Fragment key={result.propositionId}>
                {/* 原子命题 */}
                <div
                  style={{
                    padding: "14px 16px",
                    fontSize: "13px",
                    color: "var(--zt-text)",
                    lineHeight: 1.5,
                    borderBottom: "1px solid var(--border-subtle)",
                    background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {result.propositionText}
                </div>

                {/* Provider 列 */}
                {providers.map((provider) => {
                  const providerResult = result.providerResults.find(
                    (pr) => pr.provider === provider
                  );
                  return (
                    <div
                      key={provider}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                        background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                      }}
                    >
                      <ProviderCell
                        result={providerResult}
                        onClick={() =>
                          handleCellClick(result.propositionId, provider)
                        }
                      />
                    </div>
                  );
                })}

                {/* 原始来源 */}
                <div
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                  }}
                >
                  <OriginalSourceCell
                    hasOriginal={result.meetsMinimumCriteria.criteria2_hasHighTierOrOriginal}
                    isExpired={result.propositionId === "prop-c"}
                  />
                </div>

                {/* 反证 */}
                <div
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                  }}
                >
                  <CounterEvidenceCell
                    verdict={result.counterEvidenceCoverage.verdict}
                  />
                </div>

                {/* 独立性 */}
                <div
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                  }}
                >
                  <IndependenceScore
                    score={result.evidenceIndependence.independenceScore}
                  />
                </div>

                {/* 状态 */}
                <div
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid var(--border-subtle)",
                    background: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <button
                    onClick={() => onStatusClick?.(result.propositionId)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: onStatusClick ? "pointer" : "default",
                      padding: 0,
                      fontFamily: "inherit",
                    }}
                  >
                    <StatusBadge status={result.status} />
                  </button>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* 图例 */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          fontSize: "11px",
          color: "var(--zt-text-muted)",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <span>图例：</span>
        <span>✅ 支持</span>
        <span>❌ 反驳</span>
        <span>❓ 未证实</span>
        <span>🚫 未发现</span>
        <span>🔁 转载同源</span>
        <span>⚠️ 问题标注</span>
      </div>
    </div>
  );
}

export default EvidenceMatrix;
