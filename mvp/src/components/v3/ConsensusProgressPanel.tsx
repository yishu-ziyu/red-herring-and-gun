/**
 * ConsensusProgressPanel.tsx — 共识进度面板
 *
 * 功能：
 * - 实时展示多搜索引擎交叉验证的三阶段执行进度
 * - 命题拆解 → 多源检索 → 共识评估
 * - 支持展开查看每个阶段的详细子任务
 */

import { useState, useMemo, useEffect } from "react";
import type {
  ClaimDecompositionResult,
  MultiSearchJob,
  EvidenceConsensusReport,
} from "../../lib/schemas";

interface ConsensusProgressPanelProps {
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
}

type StageStatus = "pending" | "running" | "completed" | "failed";

interface StageConfig {
  id: string;
  icon: string;
  title: string;
  description: string;
}

const STAGES: StageConfig[] = [
  {
    id: "decomposition",
    icon: "1",
    title: "命题拆解",
    description: "将复杂断言拆分为可独立验证的原子命题",
  },
  {
    id: "search",
    icon: "2",
    title: "多源检索",
    description: "并行调度多个搜索引擎交叉验证",
  },
  {
    id: "consensus",
    icon: "3",
    title: "共识评估",
    description: "评估来源独立性、证据方向和待补缺口",
  },
];

// ── 阶段状态推导 ────────────────────────────────────────────────

function getStageStatus(
  stageId: string,
  decomposition: ClaimDecompositionResult | null,
  searchJobs: MultiSearchJob[],
  consensusReport: EvidenceConsensusReport | null
): StageStatus {
  switch (stageId) {
    case "decomposition":
      return decomposition ? "completed" : "pending";

    case "search": {
      if (searchJobs.length === 0) return "pending";
      const allTasks = searchJobs.flatMap((job) => job.searchTasks);
      if (allTasks.length === 0) return "pending";
      const hasRunning = allTasks.some(
        (t) => t.status === "pending" || t.status === "running"
      );
      const hasFailed = allTasks.some((t) => t.status === "failed");
      const allCompleted = allTasks.every(
        (t) => t.status === "completed" || t.status === "failed"
      );
      if (hasRunning) return "running";
      if (allCompleted && !hasFailed) return "completed";
      if (allCompleted && hasFailed) return "completed"; // 部分失败也算完成
      return "pending";
    }

    case "consensus": {
      if (consensusReport) return "completed";
      const searchDone =
        searchJobs.length > 0 &&
        searchJobs
          .flatMap((j) => j.searchTasks)
          .every((t) => t.status === "completed" || t.status === "failed");
      if (searchDone && !consensusReport) return "running";
      return "pending";
    }

    default:
      return "pending";
  }
}

// ── 状态指示器 ─────────────────────────────────────────────────

function StatusIndicator({ status }: { status: StageStatus }) {
  const config: Record<StageStatus, { color: string; bg: string; label: string; pulse: boolean }> = {
    pending: {
      color: "var(--zt-text-muted)",
      bg: "var(--zt-bg-elevated)",
      label: "等待中",
      pulse: false,
    },
    running: {
      color: "var(--zt-primary)",
      bg: "rgba(99, 102, 241, 0.1)",
      label: "执行中",
      pulse: true,
    },
    completed: {
      color: "var(--zt-success)",
      bg: "rgba(34, 197, 94, 0.1)",
      label: "已完成",
      pulse: false,
    },
    failed: {
      color: "var(--zt-alert)",
      bg: "rgba(239, 68, 68, 0.1)",
      label: "失败",
      pulse: false,
    },
  };

  const c = config[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        color: c.color,
        background: c.bg,
        whiteSpace: "nowrap",
      }}
    >
      {c.pulse && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: c.color,
            animation: "pulse-dot 1.5s ease-in-out infinite",
          }}
        />
      )}
      {!c.pulse && status === "completed" && (
        <span style={{ fontSize: "10px" }}>✓</span>
      )}
      {!c.pulse && status === "failed" && (
        <span style={{ fontSize: "10px" }}>✕</span>
      )}
      {c.label}
    </span>
  );
}

// ── 搜索任务进度条 ─────────────────────────────────────────────

function SearchProgress({ jobs }: { jobs: MultiSearchJob[] }) {
  const allTasks = useMemo(
    () => jobs.flatMap((job) => job.searchTasks.map((task) => ({ ...task, propositionText: job.propositionText }))),
    [jobs]
  );

  const total = allTasks.length;
  const completed = allTasks.filter((t) => t.status === "completed").length;
  const failed = allTasks.filter((t) => t.status === "failed").length;
  const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return (
    <div style={{ marginTop: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "var(--zt-text-muted)",
          marginBottom: "6px",
        }}
      >
        <span>
          {completed} 完成 · {failed} 失败 · {total - completed - failed} 等待
        </span>
        <span>{progress}%</span>
      </div>
      <div
        style={{
          height: "4px",
          background: "var(--zt-bg-elevated)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: failed > 0 ? "var(--zt-warning)" : "var(--zt-success)",
            borderRadius: "2px",
            transition: "width 500ms ease",
          }}
        />
      </div>

      {/* 任务明细 */}
      <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {allTasks.map((task, idx) => {
          const providerLabel: Record<string, string> = {
            "360_search": "360",
            any_search: "Any",
            metaso_search: "Metaso",
            tavily_search: "Tavily",
            exa_search: "Exa",
          };
          const statusIcon =
            task.status === "completed"
              ? "✅"
              : task.status === "failed"
              ? "❌"
              : "⏳";

          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "11px",
                color:
                  task.status === "completed"
                    ? "var(--zt-text-secondary)"
                    : task.status === "failed"
                    ? "var(--zt-alert)"
                    : "var(--zt-text-muted)",
              }}
            >
              <span>{statusIcon}</span>
              <span style={{ fontWeight: 600, minWidth: "50px" }}>
                {providerLabel[task.provider] ?? task.provider}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={task.query}
              >
                {task.query}
              </span>
              {task.result && (
                <span style={{ color: "var(--zt-text-muted)", fontSize: "10px" }}>
                  {task.result.sources.length} 来源 · {task.result.latencyMs}ms
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 共识结果摘要 ───────────────────────────────────────────────

function displayConsensusStatus(status: string) {
  if (status === "可进入推理") return "可判断";
  if (status === "需人工复核") return "人工复核";
  return status;
}

function ConsensusSummary({ report }: { report: EvidenceConsensusReport | null }) {
  if (!report) {
    return (
      <div
        style={{
          marginTop: "10px",
          padding: "12px",
          borderRadius: "var(--zt-radius-sm)",
          background: "var(--zt-bg-elevated)",
          fontSize: "12px",
          color: "var(--zt-text-muted)",
          textAlign: "center",
        }}
      >
        等待共识评估...
      </div>
    );
  }

  return (
    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
        }}
      >
        {[
          {
            label: "可判断",
            value: report.overallStats.readyForReasoning,
            color: "var(--zt-success)",
          },
          {
            label: "存疑",
            value: report.overallStats.doubtful,
            color: "var(--zt-warning)",
          },
          {
            label: "人工复核",
            value: report.overallStats.needsManualReview,
            color: "var(--zt-alert)",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: "10px",
              borderRadius: "var(--zt-radius-sm)",
              background: "var(--zt-bg-elevated)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: stat.color,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--zt-text-muted)",
                marginTop: "2px",
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* 命题状态列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {report.propositionResults.map((result) => {
          const statusColor =
            result.status === "可进入推理"
              ? "var(--zt-success)"
              : result.status === "存疑"
              ? "var(--zt-warning)"
              : "var(--zt-alert)";
          const statusIcon =
            result.status === "可进入推理" ? "✓" : result.status === "存疑" ? "?" : "!";

          return (
            <div
              key={result.propositionId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 10px",
                borderRadius: "var(--zt-radius-sm)",
                background: "var(--zt-bg-elevated)",
                fontSize: "12px",
              }}
            >
              <span
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: statusColor,
                  border: `1.5px solid ${statusColor}`,
                  flexShrink: 0,
                }}
              >
                {statusIcon}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--zt-text)",
                }}
                title={result.propositionText}
              >
                {result.propositionText}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  color: statusColor,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {displayConsensusStatus(result.status)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 拆解结果展示 ───────────────────────────────────────────────

function DecompositionSummary({ decomposition }: { decomposition: ClaimDecompositionResult | null }) {
  if (!decomposition) {
    return (
      <div
        style={{
          marginTop: "10px",
          padding: "12px",
          borderRadius: "var(--zt-radius-sm)",
          background: "var(--zt-bg-elevated)",
          fontSize: "12px",
          color: "var(--zt-text-muted)",
          textAlign: "center",
        }}
      >
        等待命题拆解...
      </div>
    );
  }

  return (
    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div
        style={{
          fontSize: "11px",
          color: "var(--zt-text-muted)",
          lineHeight: 1.5,
          padding: "8px 10px",
          borderRadius: "var(--zt-radius-sm)",
          background: "var(--zt-bg-elevated)",
        }}
      >
        {decomposition.decompositionReasoning}
      </div>
      {decomposition.atomicPropositions.map((prop, idx) => (
        <div
          key={prop.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 10px",
            borderRadius: "var(--zt-radius-sm)",
            background: "var(--zt-bg-elevated)",
            fontSize: "12px",
          }}
        >
          <span
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              fontWeight: 700,
              color: "var(--zt-primary)",
              background: "rgba(99, 102, 241, 0.1)",
              flexShrink: 0,
            }}
          >
            {idx + 1}
          </span>
          <span
            style={{
              flex: 1,
              color: "var(--zt-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={prop.text}
          >
            {prop.text}
          </span>
          <span
            style={{
              fontSize: "10px",
              color: "var(--zt-text-muted)",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "var(--zt-bg-panel)",
              flexShrink: 0,
            }}
          >
            {prop.type}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 阶段卡片 ───────────────────────────────────────────────────

function StageCard({
  stage,
  status,
  children,
  isLast,
}: {
  stage: StageConfig;
  status: StageStatus;
  children?: React.ReactNode;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(status !== "pending");
  useEffect(() => setExpanded(status !== "pending"), [status]);

  const statusColors: Record<StageStatus, string> = {
    pending: "var(--zt-text-muted)",
    running: "var(--zt-primary)",
    completed: "var(--zt-success)",
    failed: "var(--zt-alert)",
  };

  return (
    <div style={{ position: "relative" }}>
      {/* 连接线 */}
      {!isLast && (
        <div
          style={{
            position: "absolute",
            left: "20px",
            top: "44px",
            width: "2px",
            height: "calc(100% - 36px)",
            background:
              status === "completed"
                ? "var(--zt-success)"
                : "var(--border-subtle)",
            zIndex: 0,
          }}
        />
      )}

      {/* 阶段头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "12px 0",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* 阶段图标 */}
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            flexShrink: 0,
            background:
              status === "completed"
                ? "rgba(34, 197, 94, 0.1)"
                : status === "running"
                ? "rgba(99, 102, 241, 0.1)"
                : "var(--zt-bg-elevated)",
            border: `2px solid ${
              status === "completed"
                ? "var(--zt-success)"
                : status === "running"
                ? "var(--zt-primary)"
                : "var(--border-subtle)"
            }`,
          }}
        >
          {stage.icon}
        </div>

        {/* 阶段信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color:
                    status === "pending"
                      ? "var(--zt-text-muted)"
                      : "var(--zt-text)",
                }}
              >
                {stage.title}
              </span>
              <StatusIndicator status={status} />
            </div>
            {children && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  fontSize: "12px",
                  color: "var(--zt-text-muted)",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
                aria-label={expanded ? "收起详情" : "展开详情"}
              >
                {expanded ? "▲" : "▼"}
              </button>
            )}
          </div>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "12px",
              color: "var(--zt-text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {stage.description}
          </p>

          {expanded && children && (
            <div style={{ marginTop: "8px" }}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────

export function ConsensusProgressPanel({
  claimDecomposition,
  searchJobs,
  consensusReport,
}: ConsensusProgressPanelProps) {
  const stages = STAGES.map((stage) => ({
    ...stage,
    status: getStageStatus(stage.id, claimDecomposition, searchJobs, consensusReport),
  }));

  const overallProgress = useMemo(() => {
    const completedCount = stages.filter((s) => s.status === "completed").length;
    return Math.round((completedCount / stages.length) * 100);
  }, [stages]);

  const isAllCompleted = stages.every((s) => s.status === "completed");

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
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "18px" }}>🔄</span>
          <h3
            style={{
              margin: 0,
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--zt-text)",
            }}
          >
            交叉验证执行进度
          </h3>
        </div>
        {isAllCompleted && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--zt-success)",
              padding: "3px 10px",
              borderRadius: "999px",
              background: "rgba(34, 197, 94, 0.1)",
            }}
          >
            ✓ 全部完成
          </span>
        )}
      </div>

      {/* 整体进度条 */}
      <div style={{ padding: "16px 20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "var(--zt-text-secondary)",
            marginBottom: "8px",
          }}
        >
          <span>总体进度</span>
          <span style={{ fontWeight: 600 }}>{overallProgress}%</span>
        </div>
        <div
          style={{
            height: "6px",
            background: "var(--zt-bg-elevated)",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${overallProgress}%`,
              height: "100%",
              background: isAllCompleted
                ? "var(--zt-success)"
                : "var(--zt-primary)",
              borderRadius: "3px",
              transition: "width 600ms ease",
            }}
          />
        </div>
      </div>

      {/* 阶段列表 */}
      <div style={{ padding: "0 20px 16px" }}>
        <StageCard
          stage={stages[0]}
          status={stages[0].status}
          isLast={false}
        >
          <DecompositionSummary decomposition={claimDecomposition} />
        </StageCard>

        <StageCard
          stage={stages[1]}
          status={stages[1].status}
          isLast={false}
        >
          <SearchProgress jobs={searchJobs} />
        </StageCard>

        <StageCard
          stage={stages[2]}
          status={stages[2].status}
          isLast={true}
        >
          <ConsensusSummary report={consensusReport} />
        </StageCard>
      </div>

      {/* pulse 动画 */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}

export default ConsensusProgressPanel;
