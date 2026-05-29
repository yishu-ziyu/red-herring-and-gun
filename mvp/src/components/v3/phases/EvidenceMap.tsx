import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { CanvasEdge, CanvasNode } from "../../../data/reasoningCanvas";
import type { NodePositionOverrides } from "../../canvas/layeredLayout";
import { ReasoningCanvasV3 } from "../ReasoningCanvasV3";

interface EvidenceMapProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  highlightedNodeId?: string;
  onNodeClick?: (nodeId: string) => void;
  onToggleFullscreen?: () => void;
}

function hasHandoffNodes(nodes: CanvasNode[]) {
  return nodes.some((node) => node.status === "handoff" || node.id.startsWith("handoff-"));
}

function filterHandoffGraph(nodes: CanvasNode[], edges: CanvasEdge[]) {
  if (!hasHandoffNodes(nodes)) return { nodes, edges };

  const handoffNodeIds = new Set(
    nodes
      .filter((node) => node.status === "handoff" || node.id.startsWith("handoff-"))
      .map((node) => node.id)
  );

  return {
    nodes: nodes.filter((node) => handoffNodeIds.has(node.id)),
    edges: edges.filter((edge) => handoffNodeIds.has(edge.from) && handoffNodeIds.has(edge.to)),
  };
}

export function EvidenceMap({
  nodes,
  edges,
  highlightedNodeId,
  onNodeClick,
  onToggleFullscreen,
}: EvidenceMapProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(highlightedNodeId ?? null);
  const [nodePositionOverrides, setNodePositionOverrides] = useState<NodePositionOverrides>({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const filteredGraph = useMemo(() => filterHandoffGraph(nodes, edges), [nodes, edges]);
  const filteredNodeIds = useMemo(
    () => new Set(filteredGraph.nodes.map((node) => node.id)),
    [filteredGraph.nodes]
  );
  const visibleHighlightedNodeId = highlightedNodeId && filteredNodeIds.has(highlightedNodeId)
    ? highlightedNodeId
    : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setCanvasSize((prev) => {
        const next = {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      setIsCanvasReady(false);
      return;
    }

    setIsCanvasReady(false);
    const timer = window.setTimeout(() => setIsCanvasReady(true), 120);
    return () => window.clearTimeout(timer);
  }, [canvasSize.height, canvasSize.width]);

  useEffect(() => {
    if (!visibleHighlightedNodeId) return;
    setSelectedNodeId(visibleHighlightedNodeId);
  }, [visibleHighlightedNodeId]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !visibleHighlightedNodeId) return;

    const timer = window.setTimeout(() => {
      void instance.fitView({
        nodes: [{ id: visibleHighlightedNodeId }],
        padding: 0.45,
        duration: 520,
      });
    }, 40);

    return () => window.clearTimeout(timer);
  }, [visibleHighlightedNodeId]);

  const focusedPath = useMemo(() => {
    if (!visibleHighlightedNodeId) return { nodeIds: [], edgeIds: [] };

    const edgeIds = filteredGraph.edges
      .filter((edge) => edge.from === visibleHighlightedNodeId || edge.to === visibleHighlightedNodeId)
      .map((edge) => edge.id);
    const nodeIds = new Set<string>([visibleHighlightedNodeId]);
    filteredGraph.edges.forEach((edge) => {
      if (edgeIds.includes(edge.id)) {
        nodeIds.add(edge.from);
        nodeIds.add(edge.to);
      }
    });

    return { nodeIds: Array.from(nodeIds), edgeIds };
  }, [filteredGraph.edges, visibleHighlightedNodeId]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      onNodeClick?.(nodeId);
    },
    [onNodeClick]
  );

  const handleNodeMove = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setNodePositionOverrides((prev) => ({ ...prev, [nodeId]: position }));
  }, []);

  const hasCanvasSize = canvasSize.width > 0 && canvasSize.height > 0 && isCanvasReady;

  return (
    <section className="evidence-map-panel">
      <div className="evidence-map-header">
        <div>
          <span>Evidence Graph</span>
          <strong>证据图谱</strong>
        </div>
        {onToggleFullscreen ? (
          <button type="button" onClick={onToggleFullscreen}>
            全屏画布
          </button>
        ) : null}
      </div>
      <div className="evidence-map-canvas" ref={containerRef}>
        {hasCanvasSize ? (
          <div
            className="evidence-map-flow-frame"
            style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }}
          >
            <ReasoningCanvasV3
              nodes={filteredGraph.nodes}
              edges={filteredGraph.edges}
              selectedNodeId={selectedNodeId}
              focusedPath={focusedPath}
              isFocusMode={Boolean(visibleHighlightedNodeId)}
              nodePositionOverrides={nodePositionOverrides}
              onNodeSelect={handleSelectNode}
              onNodeEnterFocus={handleSelectNode}
              onExitFocus={() => setSelectedNodeId(null)}
              onNodeMove={handleNodeMove}
              onInit={(instance) => {
                instanceRef.current = instance;
              }}
            />
          </div>
        ) : (
          <div className="evidence-map-loading">正在加载证据图谱</div>
        )}
      </div>
    </section>
  );
}
