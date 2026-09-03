import type { Case } from '@rhg/core/casefile';
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
import { GRAPH_SECTION } from "../lib/copy.js";
import { graphElements } from "../lib/select.js";
import { PanelFold } from "./PanelFold.js";

type NodeData = { host: string; tier: string; title: string; cluster: string };

function EvidenceNode(props: NodeProps<Node<NodeData>>) {
  const letter = props.data.tier === "unknown" ? "?" : props.data.tier;
  return (
    <div className={`graph-node tier-${props.data.tier} cluster-${props.data.cluster}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className={`tier-badge ${props.data.tier === "A" ? "solid" : "line"}`}>{letter}</span>
      <span>{props.data.host}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { evidence: EvidenceNode };

function FitOnReady() {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.24 });
    }, 80);
    return () => window.clearTimeout(id);
  }, [fitView]);
  return null;
}

function clusterTone(id: string, indexOf: Map<string, number>): string {
  const n = indexOf.get(id) ?? 0;
  return String.fromCharCode(97 + (n % 3));
}

export function ProvenanceGraph(props: { current: Case }) {
  const graph = graphElements(props.current);
  if (!graph) return null;
  const byId = new Map(props.current.evidence.map((item) => [item.id, item]));
  const clusterIndex = new Map<string, number>();
  for (const id of graph.nodeIds) {
    const key = byId.get(id)?.clusterId ?? `solo:${id}`;
    if (!clusterIndex.has(key)) clusterIndex.set(key, clusterIndex.size);
  }
  const nodes: Node<NodeData>[] = graph.nodeIds.map((id, index) => {
    const evidence = byId.get(id);
    const sink = graph.edges.some((edge) => edge.to === id) && !graph.edges.some((edge) => edge.from === id);
    const cluster = clusterTone(evidence?.clusterId ?? `solo:${id}`, clusterIndex);
    return {
      id,
      type: "evidence",
      position: { x: sink ? 180 : 8, y: 16 + index * 56 },
      data: {
        host: evidence?.host ?? id,
        tier: evidence?.tier ?? "unknown",
        title: evidence?.title ?? id,
        cluster,
      },
      draggable: false,
      connectable: false,
      width: 168,
      height: 40,
      style: { width: 168, height: 40 },
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--ink)" },
    style: { stroke: "var(--ink)", strokeWidth: 1.2 },
  }));
  return (
    <PanelFold title={GRAPH_SECTION}>
      <div className="graph-host" data-node-count={nodes.length}>
        <div className="graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            minZoom={0.4}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: "var(--ink)", strokeWidth: 1.2 },
            }}
          >
            <Background />
            <FitOnReady />
          </ReactFlow>
        </div>
      </div>
    </PanelFold>
  );
}
