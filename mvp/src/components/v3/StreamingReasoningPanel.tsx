/**
 * StreamingReasoningPanel.tsx — 实时流式推理面板
 *
 * 设计规范（esther-design-system）：
 * - 字体：衬线标题 + 无衬线正文
 * - 配色：蓝#2B7FD8 + 黄#F4D758 + 红#E84A5F + 暖底背景#faf8f5
 * - 风格：可爱但有品质、手绘蜡笔感、大圆角
 * - 禁忌：蓝紫渐变、glassmorphism、neon、bounce动画
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  StreamingReasoningSession,
  StreamingStage,
  StreamingChunk,
  StageStatus,
  ChunkType,
} from "../../lib/streamingTypes";

interface StreamingReasoningPanelProps {
  session: StreamingReasoningSession | null;
}

// ── 颜色配置 ────────────────────────────────────────────────────

const COLORS = {
  blue: "#2B7FD8",
  yellow: "#F4D758",
  red: "#E84A5F",
  green: "#22c55e",
  orange: "#f59e0b",
  warmBg: "#faf8f5",
  warmBgElevated: "#f5f0e8",
  text: "#1a1a1a",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  border: "#e5e0d6",
};

const STAGE_STATUS_COLORS: Record<StageStatus, string> = {
  pending: COLORS.textMuted,
  running: COLORS.blue,
  completed: COLORS.green,
  error: COLORS.red,
};

// ── 工具函数 ────────────────────────────────────────────────────

function getStatusDot(status: StageStatus): string {
  switch (status) {
    case "pending":
      return "○";
    case "running":
      return "●";
    case "completed":
      return "✓";
    case "error":
      return "✕";
  }
}

// ── Chunk 渲染 ──────────────────────────────────────────────────

function ChunkItem({ chunk, isNew }: { chunk: StreamingChunk; isNew: boolean }) {
  const style = getChunkStyle(chunk.type);

  return (
    <div
      className={isNew ? "chunk-enter" : ""}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "3px 0",
        fontSize: "13px",
        lineHeight: 1.6,
        color: style.color,
        fontFamily: style.fontFamily,
        fontStyle: style.fontStyle,
        animation: isNew ? "chunkFadeIn 0.3s ease forwards" : undefined,
      }}
    >
      {chunk.type !== "divider" && (
        <span
          style={{
            flexShrink: 0,
            fontSize: "12px",
            marginTop: "2px",
            opacity: 0.7,
          }}
        >
          {style.icon}
        </span>
      )}
      <span style={{ flex: 1 }}>
        {chunk.type === "divider" ? (
          <span
            style={{
              display: "block",
              borderBottom: `1px dashed ${COLORS.border}`,
              margin: "6px 0",
            }}
          />
        ) : (
          chunk.content
        )}
      </span>
    </div>
  );
}

function getChunkStyle(type: ChunkType) {
  switch (type) {
    case "thought":
      return {
        color: COLORS.textSecondary,
        icon: "💭",
        fontFamily: "'Georgia', 'Noto Serif SC', serif",
        fontStyle: "italic" as const,
      };
    case "action":
      return {
        color: COLORS.blue,
        icon: "▶",
        fontFamily: "'Noto Sans SC', 'PingFang SC', sans-serif",
        fontStyle: "normal" as const,
      };
    case "result":
      return {
        color: COLORS.text,
        icon: "●",
        fontFamily: "'Noto Sans SC', 'PingFang SC', sans-serif",
        fontStyle: "normal" as const,
      };
    case "tool_call":
      return {
        color: "#e2e8f0",
        icon: "$",
        fontFamily: "'Fira Code', 'Courier New', monospace",
        fontStyle: "normal" as const,
      };
    case "divider":
      return {
        color: COLORS.border,
        icon: "",
        fontFamily: "inherit",
        fontStyle: "normal" as const,
      };
  }
}

// ── Stage 卡片 ──────────────────────────────────────────────────

function StageCard({ stage, visibleChunkCount }: { stage: StreamingStage; visibleChunkCount: number }) {
  const statusColor = STAGE_STATUS_COLORS[stage.status];
  const isRunning = stage.status === "running";

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "12px 0",
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {/* 左侧状态竖线 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "3px",
            flex: 1,
            borderRadius: "2px",
            background:
              stage.status === "pending"
                ? COLORS.border
                : statusColor,
            opacity: stage.status === "pending" ? 0.4 : 1,
            transition: "all 0.4s ease",
            animation: isRunning ? "pulseLine 2s ease-in-out infinite" : undefined,
          }}
        />
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Stage 头部 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontFamily: "'Georgia', 'Noto Serif SC', serif",
              fontWeight: 600,
              color: COLORS.text,
            }}
          >
            {stage.nameZh}
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 8px",
              borderRadius: "999px",
              background: `${statusColor}15`,
              color: statusColor,
              fontWeight: 600,
            }}
          >
            {stage.agentIcon} {stage.agentName}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "14px",
              color: statusColor,
              fontWeight: 700,
            }}
          >
            {getStatusDot(stage.status)}
          </span>
        </div>

        {/* 描述 */}
        {stage.status !== "pending" && (
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "12px",
              color: COLORS.textSecondary,
              fontFamily: "'Noto Sans SC', sans-serif",
            }}
          >
            {stage.description}
          </p>
        )}

        {/* Chunks */}
        <div>
          {stage.chunks.slice(0, visibleChunkCount).map((chunk, idx) => (
            <ChunkItem
              key={chunk.id}
              chunk={chunk}
              isNew={idx === visibleChunkCount - 1 && isRunning}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Agent 底部标识 ──────────────────────────────────────────────

function PanelFooter({ agentName, agentIcon }: { agentName: string; agentIcon: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "12px 16px",
        borderTop: `1px solid ${COLORS.border}`,
        background: COLORS.warmBgElevated,
      }}
    >
      <span style={{ fontSize: "16px" }}>{agentIcon}</span>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: COLORS.textSecondary,
          fontFamily: "'Georgia', serif",
        }}
      >
        {agentName}
      </span>
      <div
        style={{
          display: "flex",
          gap: "3px",
          marginLeft: "auto",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: COLORS.blue,
              opacity: 0.3,
              animation: `dotPulse 1.4s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────

export function StreamingReasoningPanel({ session }: StreamingReasoningPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [visibleChunks, setVisibleChunks] = useState<Record<string, number>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const prevSessionRef = useRef<string | null>(null);

  // 当 session 变化时，初始化 visibleChunks
  useEffect(() => {
    if (!session) {
      setVisibleChunks({});
      return;
    }

    const sessionKey = session.sessionId;
    if (prevSessionRef.current !== sessionKey) {
      prevSessionRef.current = sessionKey;
      const initial: Record<string, number> = {};
      session.stages.forEach((stage) => {
        initial[stage.id] = stage.chunks.length;
      });
      setVisibleChunks(initial);
    } else {
      // 更新现有 session 的 visibleChunks
      setVisibleChunks((prev) => {
        const next = { ...prev };
        session.stages.forEach((stage) => {
          if (stage.chunks.length > (next[stage.id] ?? 0)) {
            next[stage.id] = stage.chunks.length;
          }
        });
        return next;
      });
    }
  }, [session]);

  // 自动滚动到底部
  useEffect(() => {
    if (isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [visibleChunks, isExpanded]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!session) return null;

  const completedStages = session.stages.filter((s) => s.status === "completed").length;
  const runningStage = session.stages.find((s) => s.status === "running");
  const overallProgress =
    session.stages.length > 0
      ? Math.round((completedStages / session.stages.length) * 100)
      : 0;

  const currentAgent = runningStage
    ? { name: runningStage.agentName, icon: runningStage.agentIcon }
    : completedStages === session.stages.length && session.stages.length > 0
    ? { name: session.stages[session.stages.length - 1].agentName, icon: session.stages[session.stages.length - 1].agentIcon }
    : { name: "等待中...", icon: "⏳" };

  return (
    <div
      style={{
        marginTop: "24px",
        borderRadius: "16px",
        background: COLORS.warmBg,
        border: `1px solid ${COLORS.border}`,
        overflow: "hidden",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}
    >
      {/* 触发器 */}
      <button
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "14px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
        type="button"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🧠</span>
          <span
            style={{
              fontSize: "15px",
              fontWeight: 600,
              fontFamily: "'Georgia', 'Noto Serif SC', serif",
              color: COLORS.text,
            }}
          >
            实时推理过程
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 8px",
              borderRadius: "999px",
              background: `${COLORS.blue}12`,
              color: COLORS.blue,
              fontWeight: 600,
            }}
          >
            {completedStages}/{session.stages.length} 阶段
          </span>
          {runningStage && (
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: `${COLORS.yellow}25`,
                color: "#92400e",
                fontWeight: 600,
                animation: "pulseBg 2s ease-in-out infinite",
              }}
            >
              {runningStage.agentIcon} {runningStage.nameZh} 进行中...
            </span>
          )}
          {session.source === "mock" && (
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(100, 116, 139, 0.12)",
                color: COLORS.textSecondary,
                fontWeight: 700,
              }}
            >
              {session.sourceLabel}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: "12px",
            color: COLORS.textMuted,
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s ease",
          }}
        >
          ▼
        </span>
      </button>

      {/* 下拉内容 */}
      <div
        style={{
          maxHeight: isExpanded ? "2000px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* 进度条 */}
        <div
          style={{
            height: "3px",
            background: COLORS.border,
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${overallProgress}%`,
              background: `linear-gradient(90deg, ${COLORS.blue}, ${COLORS.green})`,
              borderRadius: "0 2px 2px 0",
              transition: "width 0.6s ease",
            }}
          />
        </div>

        {/* Stage 列表 */}
        <div
          ref={contentRef}
          style={{
            padding: "0 20px 0 16px",
            maxHeight: "600px",
            overflowY: "auto",
          }}
        >
          {session.stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              visibleChunkCount={visibleChunks[stage.id] ?? 0}
            />
          ))}
        </div>

        {/* 底部 Agent 标识 */}
        <PanelFooter agentName={currentAgent.name} agentIcon={currentAgent.icon} />
      </div>

      {/* 全局动画样式 */}
      <style>{`
        @keyframes chunkFadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulseLine {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        @keyframes dotPulse {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.3);
          }
        }

        @keyframes pulseBg {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
}

export default StreamingReasoningPanel;
