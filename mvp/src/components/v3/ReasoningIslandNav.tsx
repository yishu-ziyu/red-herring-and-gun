import { useEffect, useMemo, useState } from "react";
import type { CanvasNode, ReasoningStep } from "../../data/reasoningCanvas";

type IslandTab = "nodes" | "trace";

interface ReasoningIslandNavProps {
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  steps: ReasoningStep[];
  activeStepId: string | null;
  isExpanding: boolean;
  agentRunCount: number;
  recursiveRunCount: number;
  onNodeSelect: (nodeId: string) => void;
  onStepSelect: (step: ReasoningStep) => void;
}

export function ReasoningIslandNav({
  nodes,
  selectedNodeId,
  steps,
  activeStepId,
  isExpanding,
  agentRunCount,
  recursiveRunCount,
  onNodeSelect,
  onStepSelect,
}: ReasoningIslandNavProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tab, setTab] = useState<IslandTab>("nodes");

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0],
    [nodes, selectedNodeId],
  );

  const progress = useMemo(() => {
    if (nodes.length === 0 || !selectedNode) return 0;
    const index = Math.max(0, nodes.findIndex((node) => node.id === selectedNode.id));
    return Math.round(((index + 1) / nodes.length) * 100);
  }, [nodes, selectedNode]);

  useEffect(() => {
    if (!isExpanded) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsExpanded(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  function selectNode(nodeId: string) {
    onNodeSelect(nodeId);
    setIsExpanded(false);
  }

  function selectStep(step: ReasoningStep) {
    onStepSelect(step);
    setIsExpanded(false);
  }

  return (
    <>
      {isExpanded ? <button className="reasoning-island-backdrop" aria-label="关闭推理导航" type="button" onClick={() => setIsExpanded(false)} /> : null}

      <section className={`reasoning-island ${isExpanded ? "reasoning-island--expanded" : ""}`} aria-label="Reasoning island navigation">
        <button
          className="reasoning-island-pill"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => {
            if (!isExpanded) setIsExpanded(true);
          }}
        >
          <span className={`island-live-dot ${isExpanding ? "running" : ""}`} />
          <span className="island-current">
            <span>{selectedNode?.title ?? "推理目录"}</span>
            <em>{selectedNode ? nodeTypeLabel(selectedNode.type) : "Canvas"}</em>
          </span>
          <CircleProgress percentage={progress} />
        </button>

        <div className="reasoning-island-panel" aria-hidden={!isExpanded}>
          <div className="island-panel-top">
            <div>
              <span>REASONING ISLAND</span>
              <strong>{agentRunCount + recursiveRunCount > 0 ? `已触发 ${agentRunCount + recursiveRunCount} 次 Agent` : "节点导航"}</strong>
            </div>
            <button className="island-close" type="button" aria-label="关闭" onClick={() => setIsExpanded(false)}>
              x
            </button>
          </div>

          <div className="island-tabs" role="tablist" aria-label="导航类型">
            <button type="button" className={tab === "nodes" ? "active" : ""} onClick={() => setTab("nodes")}>
              节点
            </button>
            <button type="button" className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")}>
              Trace
            </button>
          </div>

          <div className="island-list" data-lenis-prevent="true">
            {tab === "nodes"
              ? nodes.map((node) => {
                  const active = node.id === selectedNodeId;
                  const depth = nodeDepth(node);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`island-list-item ${active ? "active" : ""}`}
                      style={{ paddingLeft: `${12 + depth * 14}px` }}
                      onClick={() => selectNode(node.id)}
                    >
                      <span>{node.title}</span>
                      <em>{nodeTypeLabel(node.type)}</em>
                    </button>
                  );
                })
              : steps.map((step, index) => {
                  const active = step.id === activeStepId;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      className={`island-list-item trace ${active ? "active" : ""}`}
                      onClick={() => selectStep(step)}
                    >
                      <span>{step.text}</span>
                      <em>Step {index + 1}</em>
                    </button>
                  );
                })}
          </div>
        </div>
      </section>
    </>
  );
}

function CircleProgress({ percentage }: { percentage: number }) {
  const size = 24;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="island-progress" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function nodeDepth(node: CanvasNode) {
  if (node.type === "claim") return 0;
  if (node.type === "judgment" || node.type === "subclaim") return 1;
  if (node.type === "evidence_need" || node.type === "candidate_evidence" || node.type === "agent_task" || node.type === "evidence_clue") return 2;
  return 3;
}

function nodeTypeLabel(type: CanvasNode["type"]) {
  const labels: Record<CanvasNode["type"], string> = {
    claim: "Claim",
    judgment: "Judgment",
    subclaim: "Subclaim",
    evidence_need: "Need",
    candidate_evidence: "Evidence",
    agent_task: "Agent",
    evidence_clue: "Clue",
    search_frontier: "Frontier",
    search_stopped: "Stopped",
    inference_license: "License",
    rewrite: "Rewrite",
  };

  return labels[type];
}
