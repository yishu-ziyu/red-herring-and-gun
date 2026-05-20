import type { CanvasEdge, CanvasNode as CanvasNodeData } from "../../data/reasoningCanvas";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasNode } from "./CanvasNode";
import { toLayeredNodes, type NodePositionOverrides } from "./layeredLayout";

interface ReasoningCanvasProps {
  nodes: CanvasNodeData[];
  edges: CanvasEdge[];
  selectedNodeId: string;
  highlightedNodeIds: string[];
  nodePositionOverrides: NodePositionOverrides;
  onNodeSelect: (nodeId: string) => void;
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
}

export function ReasoningCanvas({
  nodes,
  edges,
  selectedNodeId,
  highlightedNodeIds,
  nodePositionOverrides,
  onNodeSelect,
  onNodeMove,
}: ReasoningCanvasProps) {
  const layeredNodes = toLayeredNodes(nodes, nodePositionOverrides);

  return (
    <section className="canvas-panel" aria-label="Reasoning canvas">
      <div className="canvas-toolbar">
        <div>
          <span>Infinite reasoning space</span>
          <strong>Context Canvas</strong>
        </div>
        <div className="canvas-mode-pills" aria-label="Canvas modes">
          <span>Map</span>
          <span>Agent</span>
          <span>Evidence</span>
        </div>
      </div>
      <div className="canvas-board">
        <div className="canvas-meta-card">
          <span>Selected thread</span>
          <strong>{selectedNodeId}</strong>
          <em>{nodes.length} nodes · {edges.length} links</em>
        </div>
        <div className="layer-source-label">观点输入</div>
        <div className="layer-ring layer-ring-encoder" aria-hidden="true" />
        <div className="layer-ring layer-ring-decoder" aria-hidden="true" />
        <div className="layer-title layer-title-encoder">
          <span>Layer 1</span>
          <strong>判断编码层</strong>
        </div>
        <div className="layer-title layer-title-decoder">
          <span>Layer 2</span>
          <strong>证据 / Agent 解码层</strong>
        </div>
        <CanvasEdges edges={edges} nodes={layeredNodes} highlightedNodeIds={highlightedNodeIds} />
        {layeredNodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            highlighted={highlightedNodeIds.includes(node.id)}
            onSelect={onNodeSelect}
            onMove={onNodeMove}
          />
        ))}
      </div>
    </section>
  );
}
