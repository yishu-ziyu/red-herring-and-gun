import type { CanvasEdge, CanvasNode } from "../../data/reasoningCanvas";
import type { LayeredNode } from "./layeredLayout";

interface CanvasEdgesProps {
  edges: CanvasEdge[];
  nodes: Array<CanvasNode | LayeredNode>;
  highlightedNodeIds: string[];
}

export function CanvasEdges({ edges, nodes, highlightedNodeIds }: CanvasEdgesProps) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <svg className="canvas-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {edges.map((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);

        if (!from || !to) return null;

        const highlighted = highlightedNodeIds.includes(edge.from) || highlightedNodeIds.includes(edge.to);
        const fromX = "layerX" in from ? from.layerX : from.x;
        const fromY = "layerY" in from ? from.layerY : from.y;
        const toX = "layerX" in to ? to.layerX : to.x;
        const toY = "layerY" in to ? to.layerY : to.y;
        const midX = (fromX + toX) / 2;
        const midY = (fromY + toY) / 2;
        const controlY = Math.min(fromY, toY) + Math.abs(toY - fromY) * 0.42;

        return (
          <g key={edge.id} className={highlighted ? "edge-highlighted" : undefined}>
            <path d={`M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`} />
            {edge.label ? (
              <text x={midX} y={midY}>
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
