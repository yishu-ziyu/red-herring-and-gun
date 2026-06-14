/**
 * EvidenceChain.tsx — 可视化证据链
 *
 * 设计方向：
 * - 把原子命题作为中心节点，证据围绕分布
 * - 支持/反驳/存疑用颜色和连线区分
 * - 来源可信度用徽章展示
 * - 每个节点可交互：点击详情、追问、标记疑点
 * - 多Agent并行执行状态可视化
 */

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Variants } from "framer-motion";
import type {
  EvidenceConsensusReport,
  MultiSearchJob,
  PropositionConsensusResult,
  IndependentSource,
  SearchSourceType,
} from "../../lib/schemas";

interface EvidenceChainProps {
  consensusReport: EvidenceConsensusReport;
  searchJobs: MultiSearchJob[];
  claimDecomposition: { atomicPropositions: { id: string; text: string; type: string }[] } | null;
  onSelectProposition: (propositionId: string) => void;
}

// ── 来源类型配置 ────────────────────────────────────────────────

const SOURCE_TYPE_CONFIG: Record<SearchSourceType, { icon: string; label: string; color: string; bg: string; tier: number }> = {
  官方: { icon: "🏛️", label: "官方", color: "#15803d", bg: "#f0fdf4", tier: 1 },
  学术: { icon: "📖", label: "学术", color: "#1d4ed8", bg: "#eff6ff", tier: 2 },
  媒体: { icon: "📰", label: "媒体", color: "#0369a1", bg: "#f0f9ff", tier: 3 },
  自媒体: { icon: "📱", label: "自媒体", color: "#c2410c", bg: "#fff7ed", tier: 4 },
  论坛: { icon: "💬", label: "论坛", color: "#7c3aed", bg: "#f5f3ff", tier: 5 },
  聚合搜索: { icon: "🔍", label: "聚合", color: "#4b5563", bg: "#f9fafb", tier: 3 },
  未知: { icon: "❓", label: "未知", color: "#6b7280", bg: "#f3f4f6", tier: 6 },
};

const STATUS_CONFIG = {
  可进入推理: { icon: "✓", color: "#16a34a", bg: "#f0fdf4", border: "#86efac", label: "可推理" },
  存疑: { icon: "?", color: "#d97706", bg: "#fefce8", border: "#fde047", label: "存疑" },
  需人工复核: { icon: "!", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5", label: "需复核" },
};

// ── 共识计量条 ──────────────────────────────────────────────────

function ConsensusMeter({
  supportCount,
  contradictCount,
  neutralCount,
}: {
  supportCount: number;
  contradictCount: number;
  neutralCount: number;
}) {
  const total = supportCount + contradictCount + neutralCount;
  if (total === 0) return null;

  const supportPct = (supportCount / total) * 100;
  const contradictPct = (contradictCount / total) * 100;
  const neutralPct = (neutralCount / total) * 100;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "6px",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--zt-text-muted)" }}>
          证据共识分布
        </span>
        <span style={{ fontSize: "11px", color: "var(--zt-text-muted)" }}>
          {total} 条来源
        </span>
      </div>
      <div
        style={{
          height: "6px",
          background: "var(--zt-bg-elevated)",
          borderRadius: "3px",
          overflow: "hidden",
          display: "flex",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${supportPct}%` }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
          style={{ height: "100%", background: "#16a34a" }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${neutralPct}%` }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1], delay: 0.35 }}
          style={{ height: "100%", background: "#d97706" }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${contradictPct}%` }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1], delay: 0.5 }}
          style={{ height: "100%", background: "#dc2626" }}
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "6px",
          fontSize: "11px",
        }}
      >
        {supportCount > 0 && (
          <span style={{ color: "#16a34a", fontWeight: 600 }}>
            ● 支持 {supportCount}
          </span>
        )}
        {neutralCount > 0 && (
          <span style={{ color: "#d97706", fontWeight: 600 }}>
            ● 未判定 {neutralCount}
          </span>
        )}
        {contradictCount > 0 && (
          <span style={{ color: "#dc2626", fontWeight: 600 }}>
            ● 反驳 {contradictCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 证据节点 ────────────────────────────────────────────────────

interface EvidenceNodeData {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: SearchSourceType;
  supports: boolean;
  contradicts: boolean;
  providerOrigins: string[];
  isOriginalSource: boolean;
}

const nodeVariants: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.96 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.06,
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
};

function EvidenceNode({
  node,
  onClick,
  index,
  isFocused,
  hasFocus,
}: {
  node: EvidenceNodeData;
  onClick: () => void;
  index: number;
  isFocused: boolean;
  hasFocus: boolean;
}) {
  const sourceConfig = SOURCE_TYPE_CONFIG[node.sourceType] || SOURCE_TYPE_CONFIG["未知"];
  const stance = node.supports ? "support" : node.contradicts ? "contradict" : "neutral";

  const stanceColors = {
    support: { border: "#86efac", bg: "#f0fdf4", dot: "#16a34a" },
    contradict: { border: "#fca5a5", bg: "#fef2f2", dot: "#dc2626" },
    neutral: { border: "#fde047", bg: "#fefce8", dot: "#d97706" },
  };

  const sc = stanceColors[stance];

  // Focus mode: 当其他节点被聚焦时，当前节点变暗
  const focusStyle = hasFocus && !isFocused
    ? { opacity: 0.35, filter: "blur(0.5px)" }
    : { opacity: 1, filter: "blur(0px)" };

  return (
    <motion.button
      className={`evidence-node ${isFocused ? "evidence-node--focused" : ""}`}
      custom={index}
      variants={nodeVariants}
      initial="hidden"
      animate="visible"
      onClick={onClick}
      whileHover={{ y: -2, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
      whileTap={{ scale: 0.98 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderRadius: "10px",
        border: `1.5px solid ${isFocused ? "var(--zt-primary)" : sc.border}`,
        background: isFocused ? "#eff6ff" : sc.bg,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: "inherit",
        minWidth: 0,
        flex: "1 1 200px",
        maxWidth: "100%",
        transition: "opacity 0.3s ease, filter 0.3s ease, transform 0.3s ease, border-color 0.2s ease, background 0.2s ease",
        ...focusStyle,
      }}
    >
      {/* 立场指示点 */}
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: index * 0.06 + 0.15, type: "spring", stiffness: 500, damping: 15 }}
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: sc.dot,
          flexShrink: 0,
        }}
      />
      {/* 来源类型徽章 */}
      <span
        style={{
          fontSize: "10px",
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: "4px",
          background: sourceConfig.bg,
          color: sourceConfig.color,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {sourceConfig.icon} {sourceConfig.label}
      </span>
      {/* 标题 */}
      <span
        style={{
          fontSize: "12px",
          color: "var(--zt-text)",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {node.title}
      </span>
      {/* 原始来源标记 */}
      {node.isOriginalSource && (
        <span
          style={{
            fontSize: "10px",
            color: "#15803d",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          原始
        </span>
      )}
    </motion.button>
  );
}

// ── 命题证据簇 ──────────────────────────────────────────────────

function PropositionCluster({
  result,
  searchJob,
  index,
  onSelectProposition,
}: {
  result: PropositionConsensusResult;
  searchJob: MultiSearchJob | undefined;
  index: number;
  onSelectProposition: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [markedSuspicious, setMarkedSuspicious] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const statusConfig = STATUS_CONFIG[result.status];

  // 构建证据节点数据
  const evidenceNodes: EvidenceNodeData[] = useMemo(() => {
    return result.independentSources.map((source) => ({
      id: source.id,
      title: source.title || source.domain,
      url: source.url,
      domain: source.domain,
      sourceType: source.sourceType,
      supports: source.supports,
      contradicts: source.contradicts,
      providerOrigins: source.providerOrigins,
      isOriginalSource: source.isOriginalSource,
    }));
  }, [result.independentSources]);

  const supportNodes = evidenceNodes.filter((n) => n.supports);
  const contradictNodes = evidenceNodes.filter((n) => n.contradicts);
  const neutralNodes = evidenceNodes.filter((n) => !n.supports && !n.contradicts);

  // Provider 执行状态
  const providerStatuses = useMemo(() => {
    if (!searchJob) return [];
    return searchJob.searchTasks.map((t) => ({
      provider: t.provider,
      status: t.status,
    }));
  }, [searchJob]);

  const handleMarkSuspicious = useCallback(() => {
    setMarkedSuspicious((prev) => !prev);
  }, []);

  const handleFollowUp = useCallback(() => {
    setFollowUpOpen((prev) => !prev);
  }, []);

  return (
    <div
      className="proposition-cluster"
      style={{
        border: "1.5px solid var(--border-subtle)",
        borderRadius: "16px",
        background: "var(--zt-bg-panel)",
        overflow: "hidden",
        transition: "all 0.3s ease",
      }}
    >
      {/* 命题头部 */}
      <div
        style={{
          padding: "14px 16px",
          background: markedSuspicious
            ? "#fef2f2"
            : "var(--zt-bg-elevated)",
          borderBottom: expanded ? "1px solid var(--border-subtle)" : "none",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {/* 序号 */}
        <span
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "var(--zt-primary)",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>

        {/* 命题文本 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: markedSuspicious ? "#dc2626" : "var(--zt-text)",
              lineHeight: 1.4,
            }}
          >
            {markedSuspicious && "🚩 "}
            {result.propositionText}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--zt-text-muted)",
              marginTop: "2px",
            }}
          >
            {evidenceNodes.length} 条独立来源 · 独立性 {result.evidenceIndependence.independenceScore}%
          </div>
        </div>

        {/* 状态徽章 */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 10px",
            borderRadius: "999px",
            fontSize: "11px",
            fontWeight: 700,
            background: statusConfig.bg,
            color: statusConfig.color,
            border: `1px solid ${statusConfig.border}`,
            flexShrink: 0,
          }}
        >
          {statusConfig.icon} {statusConfig.label}
        </span>

        {/* 展开/折叠 */}
        <span
          style={{
            fontSize: "16px",
            color: "var(--zt-text-muted)",
            transition: "transform 0.2s",
            transform: expanded ? "rotate(180deg)" : "rotate(0)",
            flexShrink: 0,
          }}
        >
          ▼
        </span>
      </div>

      {/* 证据体 */}
      {expanded && (
        <div style={{ padding: "12px 16px 16px" }}>
          {/* 共识分布条 */}
          <ConsensusMeter
            supportCount={supportNodes.length}
            contradictCount={contradictNodes.length}
            neutralCount={neutralNodes.length}
          />

          {/* Provider 并行执行指示器 */}
          {providerStatuses.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                marginBottom: "12px",
                flexWrap: "wrap",
              }}
            >
              {providerStatuses.map((ps) => (
                <span
                  key={ps.provider}
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "999px",
                    background:
                      ps.status === "completed"
                        ? "#f0fdf4"
                        : ps.status === "running"
                          ? "#eff6ff"
                          : ps.status === "failed"
                            ? "#fef2f2"
                            : "#f3f4f6",
                    color:
                      ps.status === "completed"
                        ? "#16a34a"
                        : ps.status === "running"
                          ? "#1d4ed8"
                          : ps.status === "failed"
                            ? "#dc2626"
                            : "#6b7280",
                    border: `1px solid ${
                      ps.status === "completed"
                        ? "#86efac"
                        : ps.status === "running"
                          ? "#bfdbfe"
                          : ps.status === "failed"
                            ? "#fca5a5"
                            : "#e5e7eb"
                    }`,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {ps.status === "running" && (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#1d4ed8",
                        animation: "evidence-pulse 1.5s infinite",
                      }}
                    />
                  )}
                  {ps.provider.replace("_search", "")}
                </span>
              ))}
            </div>
          )}

          {/* 证据分组 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* 支持证据 */}
            {supportNodes.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#16a34a",
                    marginBottom: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>✅</span> 支持证据 ({supportNodes.length})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  {supportNodes.map((node, i) => (
                    <EvidenceNode
                      key={node.id}
                      node={node}
                      index={i}
                      isFocused={focusedNodeId === node.id}
                      hasFocus={focusedNodeId !== null}
                      onClick={() => {
                        setFocusedNodeId(node.id);
                        onSelectProposition(result.propositionId);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 反驳证据 */}
            {contradictNodes.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#dc2626",
                    marginBottom: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>❌</span> 反驳证据 ({contradictNodes.length})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  {contradictNodes.map((node, i) => (
                    <EvidenceNode
                      key={node.id}
                      node={node}
                      index={i + supportNodes.length}
                      isFocused={focusedNodeId === node.id}
                      hasFocus={focusedNodeId !== null}
                      onClick={() => {
                        setFocusedNodeId(node.id);
                        onSelectProposition(result.propositionId);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 未判定证据 */}
            {neutralNodes.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#d97706",
                    marginBottom: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>🟡</span> 未判定 ({neutralNodes.length})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  {neutralNodes.map((node, i) => (
                    <EvidenceNode
                      key={node.id}
                      node={node}
                      index={i + supportNodes.length + contradictNodes.length}
                      isFocused={focusedNodeId === node.id}
                      hasFocus={focusedNodeId !== null}
                      onClick={() => {
                        setFocusedNodeId(node.id);
                        onSelectProposition(result.propositionId);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {evidenceNodes.length === 0 && (
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--zt-text-muted)",
                  fontStyle: "italic",
                  margin: 0,
                }}
              >
                暂无独立来源证据
              </p>
            )}
          </div>

          {/* 猎人行动栏 */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "14px",
              paddingTop: "12px",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <button
              onClick={handleFollowUp}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1.5px solid var(--zt-primary)",
                background: followUpOpen ? "var(--zt-primary)" : "transparent",
                color: followUpOpen ? "#fff" : "var(--zt-primary)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              🔍 追问
            </button>
            <button
              onClick={handleMarkSuspicious}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: `1.5px solid ${markedSuspicious ? "#dc2626" : "var(--border-medium)"}`,
                background: markedSuspicious ? "#dc2626" : "transparent",
                color: markedSuspicious ? "#fff" : "var(--zt-text-secondary)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {markedSuspicious ? "🚩 已标记疑点" : "🚩 标记疑点"}
            </button>
            <button
              onClick={() => onSelectProposition(result.propositionId)}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1.5px solid var(--border-medium)",
                background: "transparent",
                color: "var(--zt-text-secondary)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
                marginLeft: "auto",
              }}
            >
              📋 查看详情
            </button>
          </div>

          {/* 追问输入区 */}
          {followUpOpen && (
            <div
              style={{
                marginTop: "10px",
                padding: "12px",
                background: "var(--zt-bg-elevated)",
                borderRadius: "10px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--zt-text)", marginBottom: "8px" }}>
                🔍 追问这个命题
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="例如：这个数据的原始出处是哪里？"
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1.5px solid var(--border-subtle)",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--zt-primary)",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  发送
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 统计概览 ────────────────────────────────────────────────────

function ChainStats({ report }: { report: EvidenceConsensusReport }) {
  const stats = report.overallStats;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "10px",
        marginBottom: "16px",
      }}
    >
      {[
        { label: "可推理", value: stats.readyForReasoning, color: "#16a34a", icon: "✓" },
        { label: "存疑", value: stats.doubtful, color: "#d97706", icon: "?" },
        { label: "需复核", value: stats.needsManualReview, color: "#dc2626", icon: "!" },
        { label: "独立来源", value: stats.totalIndependentSources, color: "var(--zt-primary)", icon: "🔗" },
      ].map((item) => (
        <div
          key={item.label}
          style={{
            padding: "12px",
            borderRadius: "12px",
            background: "var(--zt-bg-elevated)",
            textAlign: "center",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: item.color,
            }}
          >
            {item.value}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--zt-text-muted)",
              marginTop: "2px",
              fontWeight: 600,
            }}
          >
            {item.icon} {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────

export function EvidenceChain({
  consensusReport,
  searchJobs,
  claimDecomposition,
  onSelectProposition,
}: EvidenceChainProps) {
  return (
    <div className="evidence-chain-container">
      {/* 标题 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 900,
              color: "var(--zt-text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "block",
            }}
          >
            Evidence Chain
          </span>
          <strong
            style={{
              fontSize: "18px",
              color: "var(--zt-text)",
              lineHeight: 1.2,
            }}
          >
            证据链可视化
          </strong>
        </div>
        <span
          style={{
            fontSize: "12px",
            color: "var(--zt-text-muted)",
            fontWeight: 600,
          }}
        >
          {consensusReport.propositionResults.length} 个原子命题 ·{" "}
          {consensusReport.overallStats.totalIndependentSources} 条证据
        </span>
      </div>

      {/* 统计 */}
      <ChainStats report={consensusReport} />

      {/* 命题簇列表 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {consensusReport.propositionResults.map((result, index) => {
          const searchJob = searchJobs.find(
            (job) => job.propositionId === result.propositionId
          );
          return (
            <PropositionCluster
              key={result.propositionId}
              result={result}
              searchJob={searchJob}
              index={index}
              onSelectProposition={onSelectProposition}
            />
          );
        })}
      </div>
    </div>
  );
}

export default EvidenceChain;
