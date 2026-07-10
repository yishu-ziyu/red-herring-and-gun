import { useEffect, useState } from "react";
import {
  getTraceCollector,
  type TraceStep,
} from "../../../lib/reasoningTrace";

interface ReasoningTracePanelProps {
  sessionId?: string;
  initialCollapsed?: boolean;
}

function statusLabel(s: TraceStep["status"]): string {
  switch (s) {
    case "completed":
      return "完成";
    case "running":
      return "运行中";
    case "failed":
      return "失败";
    default:
      return "排队中";
  }
}

function statusColor(s: TraceStep["status"]): string {
  switch (s) {
    case "completed":
      return "#22c55e";
    case "running":
      return "#3b82f6";
    case "failed":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

export function ReasoningTracePanel({
  sessionId,
  initialCollapsed = true,
}: ReasoningTracePanelProps) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    const collector = getTraceCollector();
    setSteps(collector.getSteps(sessionId));
    const unsub = collector.subscribe((step) => {
      if (sessionId && step.sessionId !== sessionId) return;
      setSteps((prev) => [...prev, step]);
    });
    return unsub;
  }, [sessionId]);

  if (collapsed) {
    return (
      <button
        type="button"
        className="reasoning-trace-toggle"
        onClick={() => setCollapsed(false)}
        aria-label="展开推理 trace"
      >
        推理 trace（{steps.length}）
      </button>
    );
  }

  return (
    <aside className="reasoning-trace-panel" aria-label="推理 trace">
      <header className="reasoning-trace-header">
        <h4>推理 trace</h4>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="收起"
        >
          收起
        </button>
      </header>
      <ol className="reasoning-trace-list">
        {steps.length === 0 ? (
          <li className="reasoning-trace-empty">暂无步骤</li>
        ) : (
          steps.map((step) => (
            <li key={step.id} className="reasoning-trace-item">
              <span
                className="reasoning-trace-dot"
                style={{ background: statusColor(step.status) }}
                aria-label={statusLabel(step.status)}
              />
              <span className="reasoning-trace-agent">{step.agent}</span>
              <span className="reasoning-trace-action">{step.action}</span>
              <span className="reasoning-trace-status">
                {statusLabel(step.status)}
              </span>
              {step.latencyMs != null ? (
                <span className="reasoning-trace-latency">
                  {step.latencyMs}ms
                </span>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </aside>
  );
}