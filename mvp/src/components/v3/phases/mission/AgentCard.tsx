import type { HandoffStep } from "../../../../lib/agentExpansion";
import { getAgentContract } from "../../../../lib/agentConfigs";

interface AgentCardProps {
  claim: string;
  step: HandoffStep | null;
  elapsedMs: number;
  progress: number;
  outputItems: string[];
  status: "idle" | "running" | "completed" | "failed";
}

const AGENT_ROLE_LABELS: Record<string, string> = {
  rumor_detector: "谣言特征检测",
  fact_checker: "事实核查",
  source_validator: "信源可信度校验",
  report_composer: "核查报告生成",
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

function formatElapsed(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentCard({
  claim,
  step,
  elapsedMs,
  progress,
  outputItems,
  status,
}: AgentCardProps) {
  const agent = normalizeAgent(step?.agent);
  const className = AGENT_CLASS_NAMES[agent] ?? "agent-card--idle";
  const roleLabel = AGENT_ROLE_LABELS[agent] ?? "等待 Agent 接管";
  const contract = step?.agentContract ?? getAgentContract(agent);
  const visibleTools = contract?.tools.slice(0, 3) ?? [];
  const isDemoFallback = step?.model.includes("demo-fallback") || step?.output?._source === "demo-fallback";
  const displayedItems =
    outputItems.length > 0
      ? outputItems
      : status === "idle"
        ? ["正在建立多 Agent 核查任务。"]
        : ["等待当前 Agent 返回实时输出。"];

  return (
    <section
      className={`mission-agent-card ${className} mission-agent-card--${status} ${
        isDemoFallback ? "mission-agent-card--fallback" : ""
      }`}
    >
      <div className="mission-agent-card-header">
        <div className={`mission-agent-icon ${status === "running" ? "mission-agent-icon--running" : ""}`} aria-hidden="true">
          {step?.agentIcon ?? "◆"}
        </div>
        <div>
          <h2>{step?.agentName ?? "Mission Control"}</h2>
          <span>{contract?.roleTitle ?? roleLabel}</span>
        </div>
      </div>

      {contract ? (
        <div className="mission-agent-contract" aria-label="Agent 架构契约">
          <p>{contract.mission}</p>
          <div className="mission-agent-contract-grid">
            <div>
              <span>工具</span>
              <strong>{visibleTools.map((tool) => tool.name).join(" / ")}</strong>
            </div>
            <div>
              <span>记忆写入</span>
              <strong>{contract.memory.writes.slice(0, 2).join(" / ")}</strong>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mission-agent-task">
        <span>正在分析</span>
        <strong>{claim}</strong>
      </div>

      <ul className="mission-agent-output" aria-live="polite">
        {displayedItems.slice(0, 6).map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>

      <div className="mission-agent-progress" aria-label={`执行进度 ${Math.round(progress)}%`}>
        <span style={{ width: `${Math.max(4, Math.min(progress, 100))}%` }} />
      </div>

      <div className="mission-agent-meta">
        <span>已运行 {formatElapsed(elapsedMs)}</span>
        <span>model: {step?.model || "pending"}</span>
        {isDemoFallback ? <span>模拟模式</span> : null}
        {step?.latencyMs ? <span>latency: {formatElapsed(step.latencyMs)}</span> : null}
      </div>
    </section>
  );
}
