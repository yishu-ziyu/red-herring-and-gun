export type AgentDotState = "idle" | "running" | "completed" | "failed";

interface AgentStatusDotProps {
  agentId: string;
  state: AgentDotState;
  onClick?: () => void;
}

function color(state: AgentDotState): string {
  switch (state) {
    case "running":
      return "#3b82f6";
    case "completed":
      return "#22c55e";
    case "failed":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

export function AgentStatusDot({ agentId, state, onClick }: AgentStatusDotProps) {
  return (
    <button
      type="button"
      className="agent-status-dot"
      data-agent-id={agentId}
      data-state={state}
      onClick={onClick}
      aria-label={`${agentId}: ${state}`}
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color(state),
        border: "none",
        cursor: onClick ? "pointer" : "default",
        animation: state === "running" ? "pulse 1.4s ease-in-out infinite" : undefined,
      }}
    />
  );
}