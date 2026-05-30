import type { CanvasEdge, CanvasNode } from "../data/reasoningCanvas";
import type { HandoffResult, HandoffStep } from "./agentExpansion";

export interface SpindleLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const AGENT_POSITIONS: Record<string, { x: number; y: number }> = {
  rumor_detector: { x: 30, y: 50 },
  fact_checker: { x: 52, y: 32 },
  source_validator: { x: 52, y: 68 },
  report_composer: { x: 74, y: 50 },
};

function normalizeAgent(agent: string) {
  return agent.trim().toLowerCase();
}

function summarizeStep(step: HandoffStep) {
  const output = step.output;
  if (typeof output.conclusion === "string") return output.conclusion.slice(0, 80);
  if (typeof output.analysis === "string") return output.analysis.slice(0, 80);
  if (Array.isArray(output.keyFindings) && output.keyFindings.length > 0) {
    return String(output.keyFindings[0]).slice(0, 80);
  }
  if (typeof output.verificationNotes === "string") return output.verificationNotes.slice(0, 80);
  return step.status === "running" ? "正在执行..." : "结构化输出已完成";
}

function aggregateHandoffState(steps: HandoffStep[]): NonNullable<CanvasNode["handoffState"]> {
  if (steps.some((step) => step.status === "running" || step.status === "pending")) return "running";
  if (steps.some((step) => step.status === "failed")) return "failed";
  return "completed";
}

export function buildSpindleCanvas(claim: string, handoffResult: HandoffResult): SpindleLayout {
  const baseId = `spindle-${Date.now()}`;
  const nodes: CanvasNode[] = [
    {
      id: `${baseId}-claim`,
      type: "claim",
      title: claim,
      subtitle: "窄入口",
      x: 10,
      y: 50,
      status: "risk",
      revealStage: 99,
    },
    {
      id: `${baseId}-controller`,
      type: "agent_task",
      title: "纺锤体调度",
      subtitle: `从 1 个 claim 展开到 ${handoffResult.steps.length} 个 Agent，再收敛到报告。`,
      x: 20,
      y: 50,
      status: "handoff",
      handoffState: aggregateHandoffState(handoffResult.steps),
      revealStage: 99,
    },
  ];

  const edges: CanvasEdge[] = [
    {
      id: `${baseId}-edge-claim-controller`,
      from: `${baseId}-claim`,
      to: `${baseId}-controller`,
      label: "claim",
      revealStage: 99,
      animated: true,
    },
  ];

  const agentNodeIds = new Map<string, string>();

  handoffResult.steps.forEach((step, index) => {
    const agent = normalizeAgent(step.agent);
    const position = AGENT_POSITIONS[agent] ?? { x: 34 + index * 12, y: index % 2 ? 68 : 32 };
    const nodeId = `${baseId}-agent-${agent || index}`;
    agentNodeIds.set(agent, nodeId);
    nodes.push({
      id: nodeId,
      type: "agent_task",
      title: `${step.agentIcon || "◆"} ${step.agentName}`,
      subtitle: summarizeStep(step),
      x: position.x,
      y: position.y,
      status: "handoff",
      handoffState: step.status,
      revealStage: 99,
    });

    if (step.evidenceBundle) {
      const bundle = step.evidenceBundle;
      const supportNodeId = `${nodeId}-bundle-support`;
      const contradictNodeId = `${nodeId}-bundle-contradict`;

      if (bundle.supportEvidenceIds.length > 0) {
        nodes.push({
          id: supportNodeId,
          type: "evidence_clue",
          title: `支持证据包 ${bundle.supportEvidenceIds.length}`,
          subtitle: bundle.sourceQualityScore !== undefined
            ? `来源质量 ${bundle.sourceQualityScore}/100`
            : "Agent 累计支持证据",
          x: Math.min(92, position.x + 8),
          y: Math.max(12, position.y - 12),
          status: "clue",
          revealStage: 99,
        });
        edges.push({
          id: `${nodeId}-edge-support-bundle`,
          from: nodeId,
          to: supportNodeId,
          label: "support",
          revealStage: 99,
          animated: true,
        });
      }

      if (bundle.contradictEvidenceIds.length > 0 || bundle.unresolvedQuestions.length > 0) {
        nodes.push({
          id: contradictNodeId,
          type: "evidence_clue",
          title: bundle.contradictEvidenceIds.length > 0
            ? `反证证据包 ${bundle.contradictEvidenceIds.length}`
            : "反证缺口",
          subtitle: bundle.contradictEvidenceIds.length > 0
            ? `置信度调制 ${bundle.confidenceDelta}`
            : bundle.unresolvedQuestions[0] ?? "未找到明确反证",
          x: Math.min(92, position.x + 8),
          y: Math.min(88, position.y + 12),
          status: bundle.contradictEvidenceIds.length > 0 ? "risk" : "limited",
          revealStage: 99,
        });
        edges.push({
          id: `${nodeId}-edge-contradict-bundle`,
          from: nodeId,
          to: contradictNodeId,
          label: bundle.contradictEvidenceIds.length > 0 ? "counter" : "gap",
          revealStage: 99,
          animated: true,
        });
      }
    }
  });

  const rumorNode = agentNodeIds.get("rumor_detector");
  const factNode = agentNodeIds.get("fact_checker");
  const sourceNode = agentNodeIds.get("source_validator");
  const reportNode = agentNodeIds.get("report_composer");

  if (rumorNode) {
    edges.push({ id: `${baseId}-edge-controller-rumor`, from: `${baseId}-controller`, to: rumorNode, label: "detect", revealStage: 99, animated: true });
  }
  if (rumorNode && factNode) {
    edges.push({ id: `${baseId}-edge-rumor-fact`, from: rumorNode, to: factNode, label: "fact", revealStage: 99, animated: true, style: "parallel_split" });
  }
  if (rumorNode && sourceNode) {
    edges.push({ id: `${baseId}-edge-rumor-source`, from: rumorNode, to: sourceNode, label: "source", revealStage: 99, animated: true, style: "parallel_split" });
  }
  if (factNode && reportNode) {
    edges.push({ id: `${baseId}-edge-fact-report`, from: factNode, to: reportNode, label: "findings", revealStage: 99, animated: true, style: "parallel_join" });
  }
  if (sourceNode && reportNode) {
    edges.push({ id: `${baseId}-edge-source-report`, from: sourceNode, to: reportNode, label: "sources", revealStage: 99, animated: true, style: "parallel_join" });
  }

  if (handoffResult.finalReport) {
    const finalReport = handoffResult.finalReport;
    nodes.push({
      id: `${baseId}-result`,
      type: "inference_license",
      title: "收敛结论",
      subtitle: typeof finalReport.conclusion === "string" ? finalReport.conclusion.slice(0, 80) : "综合核查报告已生成",
      x: 90,
      y: 50,
      status: "handoff",
      handoffState: "completed",
      revealStage: 99,
    });
    if (reportNode) {
      edges.push({ id: `${baseId}-edge-report-result`, from: reportNode, to: `${baseId}-result`, label: "conclude", revealStage: 99, animated: true });
    }
  }

  return { nodes, edges };
}
