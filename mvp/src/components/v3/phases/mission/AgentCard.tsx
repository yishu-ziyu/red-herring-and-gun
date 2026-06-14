import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import type { HandoffStep } from "../../../../lib/agentExpansion";
import { getAgentContract } from "../../../../lib/agentConfigs";

// ── 状态动画变体 ────────────────────────────────────────────────

const runningPulse = {
  scale: [1, 1.01, 1],
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
};

const completedBounce = {
  scale: [1, 1.02, 0.99, 1],
  borderColor: ["var(--border-subtle)", "#86efac", "#86efac", "var(--border-subtle)"],
  transition: {
    duration: 0.6,
    ease: [0.34, 1.56, 0.64, 1] as const,
  },
};

const failedShake = {
  x: [0, -4, 4, -3, 3, -2, 2, 0],
  borderColor: ["var(--border-subtle)", "#fca5a5", "#fca5a5", "var(--border-subtle)"],
  transition: {
    duration: 0.5,
    ease: "easeInOut" as const,
  },
};

interface AgentCardProps {
  claim: string;
  step: HandoffStep | null;
  elapsedMs: number;
  progress: number;
  outputItems: string[];
  status: "idle" | "running" | "completed" | "failed";
  calmVisual?: boolean;
}

const AGENT_ROLE_LABELS: Record<string, string> = {
  rumor_detector: "立案分诊员",
  fact_checker: "事实核查员",
  source_validator: "信源审计员",
  report_composer: "报告收束员",
};

const AGENT_CLASS_NAMES: Record<string, string> = {
  rumor_detector: "agent-card--rumor",
  fact_checker: "agent-card--fact",
  source_validator: "agent-card--source",
  report_composer: "agent-card--report",
};

function normalizeAgent(agent?: string) {
  return (agent ?? "").trim().toLowerCase();
}

function displayAgentName(agent?: string | null) {
  const raw = (agent ?? "").trim();
  const compact = normalizeAgent(raw).replace(/[\s_-]+/g, "");

  switch (compact) {
    case "rumordetector":
    case "rumordetectoragent":
      return "立案分诊员";
    case "factchecker":
    case "factcheckeragent":
      return "事实核查员";
    case "sourcevalidator":
    case "sourcevalidatoragent":
      return "信源审计员";
    case "reportcomposer":
    case "reportcomposeragent":
      return "报告收束员";
    case "missioncontrol":
      return "中控台";
    default:
      return raw || "中控台";
  }
}

function displayAgentText(text?: string | null) {
  if (!text) return "";
  return text
    .replace(/FactChecker \+ SourceValidator/g, "事实核查员 + 信源审计员")
    .replace(/FactChecker \+ ReportComposer/g, "事实核查员 + 报告收束员")
    .replace(/RumorDetector/g, "立案分诊员")
    .replace(/FactChecker/g, "事实核查员")
    .replace(/SourceValidator/g, "信源审计员")
    .replace(/ReportComposer/g, "报告收束员")
    .replace(/Mission Control/g, "中控台")
    .replace(/Agent/g, "智能体");
}

function formatElapsed(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 卡片整体进入动画
const cardVariants: Variants = {
  hidden: { opacity: 0, y: -40, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
      mass: 0.8,
      staggerChildren: 0.08,
      delayChildren: 0.12,
    },
  },
  running: runningPulse,
  completed: completedBounce,
  failed: failedShake,
};

// 子元素依次出现动画
const itemVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 28,
    },
  },
};

// 执行计划列表 stagger 动画容器
const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.2,
    },
  },
};

// 执行计划列表项动画
const listItemVariants: Variants = {
  hidden: { opacity: 0, x: -20, scale: 0.98 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 350,
      damping: 26,
    },
  },
};

export function AgentCard({
  claim,
  step,
  elapsedMs,
  progress,
  outputItems,
  status,
  calmVisual = false,
}: AgentCardProps) {
  const agent = normalizeAgent(step?.agent);
  const className = AGENT_CLASS_NAMES[agent] ?? "agent-card--idle";
  const roleLabel = AGENT_ROLE_LABELS[agent] ?? "等待智能体接管";
  const contract = step?.agentContract ?? getAgentContract(agent);
  const isDemoFallback = step?.model.includes("demo-fallback") || step?.output?._source === "demo-fallback";
  const displayedItems =
    outputItems.length > 0
      ? outputItems
      : status === "idle"
        ? ["正在建立多智能体核查任务。"]
        : ["等待当前智能体返回实时输出。"];

  // 用 step?.agent 作为 key，确保智能体切换时重新触发动画。
  const animationKey = step?.agent ?? "idle";

  return (
    <motion.section
      key={animationKey}
      variants={cardVariants}
      initial="hidden"
      animate={status === "idle" ? "visible" : ["visible", status]}
      className={`mission-agent-card ${className} ${
        calmVisual ? "mission-agent-card--calm" : `mission-agent-card--${status}`
      } ${isDemoFallback ? "mission-agent-card--fallback" : ""}`}
    >
      <motion.div variants={itemVariants} className="mission-agent-card-header">
        {!calmVisual ? (
          <motion.div
            className={`mission-agent-icon ${status === "running" ? "mission-agent-icon--running" : ""}`}
            aria-hidden="true"
            animate={
              status === "running"
                ? {
                    scale: [1, 1.15, 1],
                    rotate: [0, 5, -5, 0],
                    transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
                  }
                : status === "completed"
                ? { scale: [1, 1.3, 1], transition: { duration: 0.4, ease: "easeOut" } }
                : {}
            }
          >
            {step?.agentIcon ?? "◆"}
          </motion.div>
        ) : null}
        <div>
          <h2>{displayAgentName(step?.agentName ?? "Mission Control")}</h2>
          <span>{roleLabel}</span>
        </div>
      </motion.div>

      {contract ? (
        <motion.div
          variants={itemVariants}
          className="mission-agent-contract"
          aria-label="智能体职责契约"
        >
          <div className="mission-agent-contract-summary">
            <span>调度职责</span>
            <strong>{contract.mission}</strong>
          </div>
          <div className="mission-agent-contract-grid">
            <div>
              <span>工具</span>
              <strong>{contract.tools.length} 个可用</strong>
            </div>
            <div>
              <span>记忆写入</span>
              <strong>{contract.memory.writes.length} 类</strong>
            </div>
          </div>
        </motion.div>
      ) : null}

      <motion.div variants={itemVariants} className="mission-agent-task">
        <span>正在分析</span>
        <strong>{claim}</strong>
      </motion.div>

      <motion.ul
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className="mission-agent-output"
        aria-live="polite"
      >
        {displayedItems.slice(0, 4).map((item, index) => (
          <motion.li key={`${item}-${index}`} variants={listItemVariants}>
            {displayAgentText(item)}
          </motion.li>
        ))}
      </motion.ul>

      <motion.div
        variants={itemVariants}
        className="mission-agent-progress"
        aria-label={`执行进度 ${Math.round(progress)}%`}
        style={{ position: "relative", overflow: "hidden" }}
      >
        <motion.span
          initial={{ width: "0%" }}
          animate={{
            width: `${Math.max(4, Math.min(progress, 100))}%`,
          }}
          transition={{
            type: "spring",
            stiffness: 120,
            damping: 20,
          }}
          className={status === "running" ? "mission-agent-progress-bar--flowing" : ""}
          style={
            status === "completed"
              ? { background: "#16a34a" }
              : status === "failed"
              ? { background: "#dc2626" }
              : {}
          }
        />
        {/* 运行态流动光效指示器 */}
        {status === "running" && (
          <motion.div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: "40%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
              borderRadius: "inherit",
            }}
            animate={{
              x: ["-100%", "250%"],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        )}
      </motion.div>

      <motion.div variants={itemVariants} className="mission-agent-meta">
        <span>已运行 {formatElapsed(elapsedMs)}</span>
        {step?.model ? <span>模型 {step.model}</span> : null}
        {isDemoFallback ? <span>模拟模式</span> : null}
        {step?.latencyMs ? <span>耗时 {formatElapsed(step.latencyMs)}</span> : null}
      </motion.div>
    </motion.section>
  );
}
