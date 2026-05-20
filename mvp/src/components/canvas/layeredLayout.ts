import type { CanvasNode } from "../../data/reasoningCanvas";

export interface LayeredNode extends CanvasNode {
  layerX: number;
  layerY: number;
  layer: "source" | "encoder" | "decoder" | "result";
}

export type NodePositionOverrides = Record<string, { x: number; y: number }>;

const judgmentOrder = ["judgment-concept", "judgment-quantity", "judgment-mechanism", "judgment-causal", "judgment-counter"];
const needOrder = ["need-time", "need-mechanism", "need-alternative", "need-counterfactual"];

export function toLayeredNodes(nodes: CanvasNode[], overrides: NodePositionOverrides = {}): LayeredNode[] {
  return nodes.map((node) => {
    const override = overrides[node.id];
    const point = getLayeredPoint(node);
    if (override) return { ...node, ...point, layerX: override.x, layerY: override.y };
    return { ...node, ...point };
  });
}

function getLayeredPoint(node: CanvasNode): Pick<LayeredNode, "layerX" | "layerY" | "layer"> {
  if (node.type === "claim") {
    return { layerX: 50, layerY: 13, layer: "source" };
  }

  if (node.type === "judgment" || node.type === "subclaim") {
    const index = Math.max(0, judgmentOrder.indexOf(node.id));
    const fallbackX = 20 + (node.x / 100) * 60;
    const x = index >= 0 ? [18, 34, 50, 66, 82][index] : fallbackX;
    const y = index >= 0 ? [34, 29, 34, 43, 47][index] : 38;
    return { layerX: x, layerY: y, layer: "encoder" };
  }

  if (node.type === "evidence_need") {
    const index = Math.max(0, needOrder.indexOf(node.id));
    const x = index >= 0 ? [24, 41, 59, 76][index] : 22 + (node.x / 100) * 56;
    const y = index >= 0 ? [67, 77, 77, 67][index] : 70;
    return { layerX: x, layerY: y, layer: "decoder" };
  }

  if (node.type === "agent_task") {
    const isController = node.title.includes("中控");
    return {
      layerX: 28 + (node.x / 100) * 44,
      layerY: isController ? 54 : 82,
      layer: isController ? "encoder" : "decoder",
    };
  }

  if (node.type === "candidate_evidence") {
    return { layerX: 16 + (node.x / 100) * 68, layerY: 83, layer: "result" };
  }

  if (node.type === "inference_license") {
    return { layerX: 50, layerY: 58, layer: "encoder" };
  }

  if (node.type === "rewrite") {
    return { layerX: 78, layerY: 84, layer: "result" };
  }

  return { layerX: node.x, layerY: node.y, layer: "decoder" };
}
