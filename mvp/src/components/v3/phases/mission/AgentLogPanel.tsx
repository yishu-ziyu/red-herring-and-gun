import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { HandoffStep } from "../../../../lib/agentExpansion";

// ── 类型 ────────────────────────────────────────────────────────

interface AgentLogPanelProps {
  steps: HandoffStep[];
}

interface LogEntry {
  id: string;
  text: string;
  agent: string;
  timestamp: number;
}

// ── 辅助：从 step 提取日志文本 ──────────────────────────────────

function extractLogText(step: HandoffStep): string | null {
  const name = step.agentName || step.agent;

  // 从 output 中提取有价值的信息
  const out = step.output || {};

  // 优先取一些常见字段
  if (out.title && typeof out.title === "string") return `${name}: ${out.title}`;
  if (out.summary && typeof out.summary === "string") {
    const s = out.summary as string;
    return `${name}: ${s.length > 40 ? s.slice(0, 40) + "…" : s}`;
  }
  if (out.resultTitle && typeof out.resultTitle === "string") {
    return `${name}: ${out.resultTitle}`;
  }
  if (out.query && typeof out.query === "string") {
    return `${name} 搜索: ${out.query}`;
  }
  if (out.sources && Array.isArray(out.sources)) {
    return `${name} 发现 ${out.sources.length} 个来源`;
  }
  if (out.claimAtoms && Array.isArray(out.claimAtoms)) {
    return `${name} 拆解为 ${out.claimAtoms.length} 个原子命题`;
  }
  if (out.finding && typeof out.finding === "string") {
    const f = out.finding as string;
    return `${name}: ${f.length > 40 ? f.slice(0, 40) + "…" : f}`;
  }

  // 根据 agent 类型给默认描述
  const defaults: Record<string, string> = {
    RumorDetector: `${name} 完成声明分诊`,
    FactChecker: `${name} 完成事实核查`,
    SourceValidator: `${name} 完成信源审计`,
    ReportComposer: `${name} 生成报告`,
  };

  return defaults[step.agent] || `${name} 执行完成`;
}

// ── 单条日志项 ──────────────────────────────────────────────────

function LogItem({ entry, index }: { entry: LogEntry; index: number }) {
  return (
    <motion.div
      className="alp-item"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
    >
      <span className="alp-check">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span className="alp-text">{entry.text}</span>
    </motion.div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────

export function AgentLogPanel({ steps }: AgentLogPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const entries = useMemo<LogEntry[]>(() => {
    const list: LogEntry[] = [];
    steps.forEach((step) => {
      if (step.status !== "completed") return;
      const text = extractLogText(step);
      if (!text) return;
      list.push({
        id: `${step.agent}-${step.timestamp}`,
        text,
        agent: step.agent,
        timestamp: step.timestamp,
      });
    });
    // 按时间排序，最多保留 8 条
    return list.sort((a, b) => a.timestamp - b.timestamp).slice(-8);
  }, [steps]);

  return (
    <motion.div
      className="agent-log-panel"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.4, duration: 0.4 }}
    >
      {/* 日志列表 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="alp-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {entries.length === 0 ? (
              <div className="alp-empty">等待 Agent 执行结果…</div>
            ) : (
              entries.map((entry, i) => (
                <LogItem key={entry.id} entry={entry} index={i} />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 底部标题栏 */}
      <button
        className="alp-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="alp-header-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9" />
          </svg>
        </span>
        <span className="alp-header-title">
          Agent log {entries.length > 0 && `(${entries.length})`}
        </span>
        <motion.span
          className="alp-header-arrow"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.span>
      </button>
    </motion.div>
  );
}

export default AgentLogPanel;
