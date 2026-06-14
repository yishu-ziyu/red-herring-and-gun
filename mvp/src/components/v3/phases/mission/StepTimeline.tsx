import type { HandoffStep } from "../../../../lib/agentExpansion";

interface StepTimelineProps {
  steps: HandoffStep[];
  currentAgent: string | null;
}

const TIMELINE_STEPS = [
  {
    agent: "rumor_detector",
    name: "RumorDetector",
    shortName: "RD",
    icon: "!",
  },
  {
    agent: "fact_checker",
    name: "FactChecker",
    shortName: "FC",
    icon: "?",
  },
  {
    agent: "source_validator",
    name: "SourceValidator",
    shortName: "SV",
    icon: "#",
  },
  {
    agent: "report_composer",
    name: "ReportComposer",
    shortName: "RC",
    icon: "✓",
  },
];

function normalizeAgent(agent?: string | null) {
  return (agent ?? "").trim().toLowerCase();
}

function getStepStatus(
  agent: string,
  steps: HandoffStep[],
  currentAgent: string | null
): "pending" | "running" | "completed" | "failed" {
  const step = steps.find((item) => normalizeAgent(item.agent) === agent);
  if (step?.status === "completed") return "completed";
  if (step?.status === "failed") return "failed";
  if (step?.status === "running" || normalizeAgent(currentAgent) === agent) return "running";
  return "pending";
}

export function StepTimeline({ steps, currentAgent }: StepTimelineProps) {
  return (
    <ol className="mission-step-timeline" aria-label="多 Agent 执行进度">
      {TIMELINE_STEPS.map((item, index) => {
        const status = getStepStatus(item.agent, steps, currentAgent);
        return (
          <li key={item.agent} className={`mission-step mission-step--${status}`}>
            {index > 0 ? <span className="mission-step-rail" aria-hidden="true" /> : null}
            <div className="mission-step-node" aria-hidden="true">
              {status === "completed" ? "✅" : item.icon}
            </div>
            <div className="mission-step-copy">
              <strong>{item.name}</strong>
              <span>{item.shortName}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
