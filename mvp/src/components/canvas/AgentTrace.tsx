import type { ReasoningStep } from "../../data/reasoningCanvas";

interface AgentTraceProps {
  steps: ReasoningStep[];
  revealStage: number;
  activeStepId: string;
  onStepSelect: (step: ReasoningStep) => void;
}

export function AgentTrace({ steps, revealStage, activeStepId, onStepSelect }: AgentTraceProps) {
  const visibleSteps = steps.filter((step) => step.revealStage <= revealStage);

  return (
    <aside className="agent-trace" aria-label="Agent reasoning trace">
      <div className="panel-heading">
        <span>Thread Stack</span>
        <strong>{visibleSteps.length}</strong>
      </div>
      <div className="trace-list">
        {visibleSteps.length > 0 ? (
          visibleSteps.map((step, index) => (
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
          <div className="trace-empty">点击开始后，Agent 先搭出问题空间；后续由你选择节点继续发散。</div>
        )}
      </div>
    </aside>
  );
}
