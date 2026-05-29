import { useState } from "react";
import type { HandoffStep } from "../../../../lib/agentExpansion";

interface CanvasThumbnailProps {
  steps: HandoffStep[];
  currentAgent: string | null;
}

const MINI_NODES = [
  { agent: "rumor_detector", label: "RD", x: 22, y: 54 },
  { agent: "fact_checker", label: "FC", x: 48, y: 32 },
  { agent: "source_validator", label: "SV", x: 48, y: 72 },
  { agent: "report_composer", label: "RC", x: 78, y: 54 },
];

const MINI_EDGES = [
  { from: MINI_NODES[0], to: MINI_NODES[1] },
  { from: MINI_NODES[0], to: MINI_NODES[2] },
  { from: MINI_NODES[1], to: MINI_NODES[3] },
  { from: MINI_NODES[2], to: MINI_NODES[3] },
];

function normalizeAgent(agent?: string | null) {
  return (agent ?? "").trim().toLowerCase();
}

function getNodeStatus(agent: string, steps: HandoffStep[], currentAgent: string | null) {
  const step = steps.find((item) => normalizeAgent(item.agent) === agent);
  if (step?.status === "completed") return "completed";
  if (step?.status === "failed") return "failed";
  if (step?.status === "running" || normalizeAgent(currentAgent) === agent) return "running";
  return "pending";
}

export function CanvasThumbnail({ steps, currentAgent }: CanvasThumbnailProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`mission-canvas-thumb ${expanded ? "mission-canvas-thumb--expanded" : ""}`}
      aria-label="执行画布缩略图"
    >
      <div className="mission-canvas-thumb-header">
        <span>画布缩略图</span>
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      <div className="mission-mini-canvas" aria-hidden="true">
        {MINI_EDGES.map((edge) => (
          <span
            key={`${edge.from.agent}-${edge.to.agent}`}
            className="mission-mini-edge"
            style={{
              left: `${edge.from.x}%`,
              top: `${edge.from.y}%`,
              width: `${Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)}%`,
              transform: `rotate(${Math.atan2(edge.to.y - edge.from.y, edge.to.x - edge.from.x)}rad)`,
            }}
          />
        ))}
        {MINI_NODES.map((node) => (
          <span
            key={node.agent}
            className={`mission-mini-node mission-mini-node--${getNodeStatus(
              node.agent,
              steps,
              currentAgent
            )}`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            {node.label}
          </span>
        ))}
      </div>

      {expanded ? (
        <div className="mission-canvas-thumb-list">
          {steps.length > 0 ? (
            steps.map((step) => (
              <div key={`${step.agent}-${step.timestamp}`} className="mission-canvas-step-row">
                <strong>{step.agentName}</strong>
                <span>{step.status}</span>
              </div>
            ))
          ) : (
            <p>等待第一个 Agent 写入节点。</p>
          )}
        </div>
      ) : null}
    </aside>
  );
}
