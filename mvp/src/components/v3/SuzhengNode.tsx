import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { CanvasNode as CanvasNodeData } from "../../data/reasoningCanvas";
import type { LayeredNode } from "../canvas/layeredLayout";

interface SuzhengNodeData {
  node: CanvasNodeData | LayeredNode;
  layerClass: string;
  highlighted: boolean;
  onSelect: (nodeId: string) => void;
  onDoubleClick: (nodeId: string) => void;
}

const TYPE_META: Record<
  CanvasNodeData["type"],
  { icon: string; label: string; color: string }
> = {
  claim: { icon: "🎯", label: "Claim", color: "#1d1d1f" },
  judgment: { icon: "⚖️", label: "Judgment", color: "#1e3a8a" },
  subclaim: { icon: "📌", label: "Subclaim", color: "#1e40af" },
  evidence_need: { icon: "📋", label: "Need", color: "#14532d" },
  candidate_evidence: { icon: "📄", label: "Evidence", color: "#075985" },
  agent_task: { icon: "🤖", label: "Agent", color: "#6b21a8" },
  evidence_clue: { icon: "💡", label: "Clue", color: "#075985" },
  search_frontier: { icon: "🔭", label: "Frontier", color: "#854d0e" },
  search_stopped: { icon: "🛑", label: "Stopped", color: "#475569" },
  inference_license: { icon: "📜", label: "License", color: "#701a75" },
  rewrite: { icon: "✏️", label: "Rewrite", color: "#7e22ce" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SuzhengNode({ id, data, selected }: any) {
  const { node, layerClass, highlighted, onSelect, onDoubleClick } = data as SuzhengNodeData;
  const meta = TYPE_META[node.type];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(id);
  };

  return (
    <button
      className={[
        "canvas-node",
        `node-${node.type}`,
        node.status ? `status-${node.status}` : "",
        node.status === "handoff" && node.handoffState ? node.handoffState : "",
        layerClass,
        selected ? "selected" : "",
        highlighted ? "highlighted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={node.subtitle ?? node.title}
      type="button"
    >
      <Handle type="target" position={Position.Left} className="node-flow-handle" />
      <Handle type="source" position={Position.Right} className="node-flow-handle" />
      <span className="node-icon" aria-hidden="true">{meta?.icon ?? "●"}</span>
      <span className="node-type">{meta?.label ?? node.type}</span>
      <strong>{node.title}</strong>
      {node.subtitle ? <small>{node.subtitle}</small> : null}
    </button>
  );
}

export default memo(SuzhengNode);
