import type { ReasoningStep } from "../../data/reasoningCanvas";

interface AgentTraceV3Props {
  steps: ReasoningStep[];
  activeStepId: string | null;
  onStepSelect: (step: ReasoningStep) => void;
}

export function AgentTraceV3({ steps, activeStepId, onStepSelect }: AgentTraceV3Props) {
  return (
    <aside className="agent-trace" aria-label="Agent reasoning trace">
      <div className="panel-heading">
        <span>Thread Stack</span>
        <strong>{steps.length}</strong>
      </div>
      <div className="trace-list">
        {steps.length > 0 ? (
          steps.map((step, index) => (
            <button
              key={step.id}
              className={`trace-step ${step.id === activeStepId ? "selected" : ""}`}
              onClick={() => onStepSelect(step)}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{step.text}</strong>
            </button>
          ))
        ) : (
          <div className="trace-empty">Agent reasoning trace will appear here.</div>
        )}
      </div>
    </aside>
  );
}
