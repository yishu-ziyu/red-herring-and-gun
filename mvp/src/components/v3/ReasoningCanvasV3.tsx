import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasEdge, CanvasNode } from "../../data/reasoningCanvas";
import { toLayeredNodes, type NodePositionOverrides } from "../canvas/layeredLayout";
import SuzhengNode from "./SuzhengNode";

// Reference canvas size for converting percentage coordinates to pixels
const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 900;

interface ReasoningCanvasV3Props {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  focusedPath: { nodeIds: string[]; edgeIds: string[] };
  isFocusMode: boolean;
  nodePositionOverrides: NodePositionOverrides;
  onNodeSelect: (nodeId: string) => void;
  onNodeEnterFocus: (nodeId: string) => void;
  onExitFocus: () => void;
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
  onInit?: (instance: ReactFlowInstance) => void;
}

const nodeTypes: NodeTypes = {
  suzheng: SuzhengNode,
};

function pctToPixel(pct: number, dimension: number): number {
  return (pct / 100) * dimension;
}

function pixelToPct(px: number, dimension: number): number {
  return (px / dimension) * 100;
}

export function ReasoningCanvasV3({
  nodes,
  edges,
  selectedNodeId,
  focusedPath,
  isFocusMode,
  nodePositionOverrides,
  onNodeSelect,
  onNodeEnterFocus,
  onExitFocus,
  onNodeMove,
  onInit,
}: ReasoningCanvasV3Props) {
  const layeredNodes = toLayeredNodes(nodes, nodePositionOverrides);

  const focusedNodeIds = useMemo(() => new Set(focusedPath.nodeIds), [focusedPath.nodeIds]);
  const focusedEdgeIds = useMemo(() => new Set(focusedPath.edgeIds), [focusedPath.edgeIds]);

  // Convert layered nodes to React Flow nodes (pixel coordinates)
  const rfNodes: Node[] = useMemo(() => {
    return layeredNodes.map((node) => {
      const isDimmed = isFocusMode && !focusedNodeIds.has(node.id) && node.id !== selectedNodeId;
      const isFocused = isFocusMode && focusedNodeIds.has(node.id);
      const layerClass = `layer-${node.layer}`;

      return {
        id: node.id,
        type: "suzheng",
        position: {
          x: pctToPixel(node.layerX, CANVAS_WIDTH),
          y: pctToPixel(node.layerY, CANVAS_HEIGHT),
        },
        data: {
          node,
          layerClass,
          highlighted: isFocused,
          onSelect: onNodeSelect,
          onDoubleClick: onNodeEnterFocus,
        },
        selected: node.id === selectedNodeId,
        className: [isDimmed ? "dimmed" : "", isFocused ? "focused" : ""]
          .filter(Boolean)
          .join(" "),
      };
    });
  }, [layeredNodes, isFocusMode, focusedNodeIds, selectedNodeId, onNodeSelect, onNodeEnterFocus]);

  // Convert edges to React Flow edges
  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((edge) => {
      const isFocused = isFocusMode && focusedEdgeIds.has(edge.id);
      const isDimmed = isFocusMode && !focusedEdgeIds.has(edge.id);
      const isHandoffEdge = edge.id.startsWith("handoff-");

      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        type: "smoothstep",
        animated: edge.animated || isFocused,
        className: [
          isFocused ? "edge-highlighted" : "",
          isDimmed ? "edge-dimmed" : "",
          isHandoffEdge ? "edge-handoff" : "",
          edge.style === "parallel_split" ? "edge-parallel-split" : "",
          edge.style === "parallel_join" ? "edge-parallel-join" : "",
          edge.animated ? "edge-animated" : "",
        ]
          .filter(Boolean)
          .join(" "),
        markerEnd: isHandoffEdge
          ? { type: MarkerType.ArrowClosed, color: "#2563eb" }
          : undefined,
        labelStyle: isHandoffEdge
          ? { fill: "#1d4ed8", fontSize: 11, fontWeight: 700 }
          : undefined,
        labelBgStyle: isHandoffEdge
          ? { fill: "rgba(255, 255, 255, 0.78)", fillOpacity: 0.78 }
          : undefined,
        labelBgPadding: isHandoffEdge ? [6, 4] : undefined,
        labelBgBorderRadius: isHandoffEdge ? 6 : undefined,
      };
    });
  }, [edges, isFocusMode, focusedEdgeIds]);

  // Handle node changes (dragging, selection, etc.)
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Persist dragged positions only when drag ends (dragging: false)
      // to avoid excessive re-renders during the drag operation
      const positionChanges = changes.filter(
        (change): change is NodeChange & { type: "position"; position: { x: number; y: number }; dragging?: boolean } =>
          change.type === "position" && change.position != null && change.dragging === false
      );

      for (const change of positionChanges) {
        const pctX = pixelToPct(change.position.x, CANVAS_WIDTH);
        const pctY = pixelToPct(change.position.y, CANVAS_HEIGHT);
        onNodeMove(change.id, { x: pctX, y: pctY });
      }

      // Handle selection changes
      const selectChanges = changes.filter(
        (change): change is NodeChange & { type: "select"; selected: boolean } =>
          change.type === "select"
      );

      for (const change of selectChanges) {
        if (change.selected) {
          onNodeSelect(change.id);
        }
      }
    },
    [onNodeMove, onNodeSelect]
  );

  // Handle pane click to exit focus mode
  const handlePaneClick = useCallback(() => {
    if (isFocusMode) {
      onExitFocus();
    }
  }, [isFocusMode, onExitFocus]);

  return (
    <section className="canvas-panel" aria-label="Reasoning canvas">
      <div className="canvas-toolbar">
        <div>
          <span>Infinite reasoning space</span>
          <strong>Context Canvas</strong>
        </div>
        <div className="canvas-mode-pills" aria-label="Canvas modes">
          <span>{isFocusMode ? "Focus Mode" : "Map"}</span>
          <span>{nodes.length} nodes</span>
          <span>{edges.length} links</span>
        </div>
      </div>
      <div className="canvas-board rf-canvas-board">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onInit={onInit}
          onPaneClick={handlePaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          nodeOrigin={[0.5, 0.5]}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#ffffff" gap={26} size={1} style={{ opacity: 0.14 }} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              switch (node.type) {
                case "suzheng":
                  const status = (node.data?.node as CanvasNode)?.status;
                  if (status === "risk") return "#ff3b30";
                  if (status === "supported") return "#34c759";
	                  if (status === "active") return "#0071e3";
	                  if (status === "limited") return "#ff9500";
	                  if (status === "blocked") return "#af52de";
	                  if (status === "clue") return "#79b9ff";
	                  if (status === "frontier") return "#facc15";
	                  if (status === "stopped") return "#64748b";
	                  if (status === "controller") return "#c084fc";
	                  return "#86868b";
                default:
                  return "#86868b";
              }
            }}
            maskColor="rgba(255, 255, 255, 0.1)"
          />
        </ReactFlow>
      </div>
    </section>
  );
}
