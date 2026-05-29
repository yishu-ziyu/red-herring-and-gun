import type { CanvasNode } from "../../data/reasoningCanvas";

export interface LayeredNode extends CanvasNode {
  layerX: number;
  layerY: number;
  layer: "source" | "encoder" | "decoder" | "result";
}

export type NodePositionOverrides = Record<string, { x: number; y: number }>;

const sortOrderMap: Record<string, number> = {
  "judgment-concept": 0,
  "judgment-quantity": 1,
  "judgment-mechanism": 2,
  "judgment-causal": 3,
  "judgment-counter": 4,
  "need-time": 0,
  "need-mechanism": 1,
  "need-alternative": 2,
  "need-counterfactual": 3,
};

export function toLayeredNodes(nodes: CanvasNode[], overrides: NodePositionOverrides = {}): LayeredNode[] {
  // Phase 1: infer layer for each node
  const nodeLayers = new Map<string, string>();
  for (const node of nodes) {
    nodeLayers.set(node.id, inferLayer(node));
  }

  // Phase 2: group by layer
  const groups = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    const layer = nodeLayers.get(node.id)!;
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer)!.push(node);
  }

  // Phase 3: sort each group for deterministic ordering
  for (const group of groups.values()) {
    group.sort((a, b) => (sortOrderMap[a.id] ?? 99) - (sortOrderMap[b.id] ?? 99));
  }

  // Phase 4: assign positions
  return nodes.map((node) => {
    const override = overrides[node.id];
    const layer = nodeLayers.get(node.id)!;

    if (override) {
      return { ...node, layerX: override.x, layerY: override.y, layer: layer as LayeredNode["layer"] };
    }

    const group = groups.get(layer)!;
    const index = group.indexOf(node);
    const layerY = getLayerY(layer);
    const layerX = distributeX(group.length, index);

    return { ...node, layerX, layerY, layer: layer as LayeredNode["layer"] };
  });
}

function inferLayer(node: CanvasNode): string {
  if (node.type === "claim") return "source";
  if (node.type === "judgment" || node.type === "subclaim") return "encoder";
  if (node.type === "evidence_need") return "decoder";
  if (node.type === "inference_license") return "decoder";
  if (node.type === "agent_task") {
    return node.title.includes("中控") ? "encoder" : "result";
  }
  if (node.type === "candidate_evidence" || node.type === "rewrite") return "result";
  return "decoder";
}

function getLayerY(layer: string): number {
  switch (layer) {
    case "source": return 12;
    case "encoder": return 30;
    case "decoder": return 54;
    case "result": return 80;
    default: return 50;
  }
}

function distributeX(count: number, index: number): number {
  if (count <= 1) return 50;
  const margin = 8;
  const available = 100 - margin * 2;
  const gap = available / (count - 1);
  return margin + index * gap;
}
