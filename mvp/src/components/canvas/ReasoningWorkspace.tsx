import { useEffect, useMemo, useState } from "react";
import {
  canvasEdges,
  canvasNodes,
  guidedRevealLimit,
  reasoningSteps,
  type CanvasEdge,
  type CanvasNode,
  type ReasoningStep,
} from "../../data/reasoningCanvas";
import { requestAgentExpansion, type AgentExpansionResponse, type ExpansionMode } from "../../lib/agentExpansion";
import { runDemoPipeline } from "../../lib/pipeline";
import { AgentTrace } from "./AgentTrace";
import { ConclusionDock } from "./ConclusionDock";
import { NodeInspector } from "./NodeInspector";
import { ReasoningCanvas } from "./ReasoningCanvas";
import type { NodePositionOverrides } from "./layeredLayout";

const { caseData, gradedEvidence, report } = runDemoPipeline();

export interface AgentRun {
  id: string;
  nodeId: string;
  nodeTitle: string;
  mode: ExpansionMode;
  prompt: string;
  controllerNote: string;
  agents: string[];
  inspectorSummary: string;
  canSay: string[];
  cannotSay: string[];
  sources: string[];
  model: string;
}

export function ReasoningWorkspace() {
  const [claim, setClaim] = useState(caseData.originalClaim);
  const [started, setStarted] = useState(false);
  const [revealStage, setRevealStage] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState("claim-root");
  const [activeStepId, setActiveStepId] = useState("");
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);
  const [expansionPrompt, setExpansionPrompt] = useState("我想沿这个节点继续追问：它还需要哪些证据？");
  const [expansionMode, setExpansionMode] = useState<ExpansionMode>("evidence_audit");
  const [userNodes, setUserNodes] = useState<CanvasNode[]>([]);
  const [userEdges, setUserEdges] = useState<CanvasEdge[]>([]);
  const [userSteps, setUserSteps] = useState<ReasoningStep[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [nodePositionOverrides, setNodePositionOverrides] = useState<NodePositionOverrides>({});
  const [isExpanding, setIsExpanding] = useState(false);
  const [agentError, setAgentError] = useState("");

  const visibleBaseStage = Math.min(revealStage, guidedRevealLimit);
  const visibleNodes = useMemo(
    () => [...canvasNodes.filter((node) => node.revealStage <= visibleBaseStage), ...userNodes],
    [userNodes, visibleBaseStage],
  );
  const visibleEdges = useMemo(
    () => [...canvasEdges.filter((edge) => edge.revealStage <= visibleBaseStage), ...userEdges],
    [userEdges, visibleBaseStage],
  );
  const traceSteps = useMemo(() => [...reasoningSteps.filter((step) => step.revealStage <= guidedRevealLimit), ...userSteps], [userSteps]);
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0] ?? canvasNodes[0];
  const latestRunForNode = [...agentRuns].reverse().find((run) => run.nodeId === selectedNode.id);

  useEffect(() => {
    const latestStep = [...reasoningSteps].reverse().find((step) => step.revealStage <= revealStage);

    if (latestStep && !activeStepId) {
      setActiveStepId(latestStep.id);
      setHighlightedNodeIds(latestStep.nodeIds);
    }
  }, [activeStepId, revealStage]);

  useEffect(() => {
    if (started && revealStage >= guidedRevealLimit) {
      setExpansionPrompt(`我想沿「${selectedNode.title}」继续追问：它还需要哪些证据？`);
    }
  }, [selectedNode.id, selectedNode.title, revealStage, started]);

  function startReasoning() {
    setStarted(true);
    setRevealStage(1);
    setSelectedNodeId("claim-root");
    setActiveStepId("step-1");
    setHighlightedNodeIds(["claim-root"]);
  }

  function advanceReasoning() {
    const nextStage = Math.min(revealStage + 1, guidedRevealLimit);
    const nextStep = reasoningSteps.find((step) => step.revealStage === nextStage);

    setRevealStage(nextStage);
    if (nextStep) {
      setActiveStepId(nextStep.id);
      setHighlightedNodeIds(nextStep.nodeIds);
      setSelectedNodeId(nextStep.nodeIds[0] ?? "claim-root");
    }
  }

  function resetReasoning() {
    setStarted(false);
    setRevealStage(0);
    setSelectedNodeId("claim-root");
    setActiveStepId("");
    setHighlightedNodeIds([]);
    setUserNodes([]);
    setUserEdges([]);
    setUserSteps([]);
    setAgentRuns([]);
    setNodePositionOverrides({});
    setIsExpanding(false);
    setAgentError("");
    setExpansionPrompt("我想沿这个节点继续追问：它还需要哪些证据？");
    setExpansionMode("evidence_audit");
  }

  function selectStep(step: ReasoningStep) {
    setActiveStepId(step.id);
    setHighlightedNodeIds(step.nodeIds);
    setSelectedNodeId(step.nodeIds[0] ?? selectedNodeId);
  }

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setHighlightedNodeIds([nodeId]);
  }

  function moveNode(nodeId: string, position: { x: number; y: number }) {
    setNodePositionOverrides((items) => ({ ...items, [nodeId]: position }));
    setSelectedNodeId(nodeId);
    setHighlightedNodeIds([nodeId]);
  }

  async function expandSelectedNode() {
    if (!started || revealStage < guidedRevealLimit || isExpanding) return;

    const runIndex = agentRuns.length + 1;
    setIsExpanding(true);
    setAgentError("");

    try {
      const llmResult = await requestAgentExpansion({
        claim,
        node: {
          id: selectedNode.id,
          type: selectedNode.type,
          title: selectedNode.title,
          subtitle: selectedNode.subtitle,
          status: selectedNode.status,
        },
        mode: expansionMode,
        prompt: expansionPrompt,
        visibleNodeTitles: visibleNodes.map((node) => node.title),
      });
      const expansion = buildNodeExpansion(selectedNode, expansionMode, expansionPrompt, runIndex, llmResult);
      const step: ReasoningStep = {
        id: `user-step-${runIndex}`,
        text: llmResult.traceText,
        nodeIds: expansion.nodes.map((node) => node.id),
        revealStage: guidedRevealLimit,
      };

      setUserNodes((items) => [...items, ...expansion.nodes]);
      setUserEdges((items) => [...items, ...expansion.edges]);
      setUserSteps((items) => [...items, step]);
      setAgentRuns((items) => [...items, expansion.run]);
      setActiveStepId(step.id);
      setHighlightedNodeIds(expansion.nodes.map((node) => node.id));
      setSelectedNodeId(expansion.nodes[expansion.nodes.length - 1]?.id ?? selectedNode.id);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "真实模型调用失败");
    } finally {
      setIsExpanding(false);
    }
  }

  const stageLabel = started
    ? revealStage >= guidedRevealLimit
      ? userNodes.length > 0
        ? `用户发散 ${agentRuns.length} 次`
        : "等待选择节点"
      : `Stage ${revealStage}/${guidedRevealLimit}`
    : "待启动";
  const primaryButtonLabel = started
    ? revealStage >= guidedRevealLimit
      ? "选择节点发散"
      : "下一步"
    : "开始推理";

  return (
    <main className="reasoning-workspace">
      <nav className="flow-rail" aria-label="Canvas tools">
        <strong>溯</strong>
        <button className="rail-tool active" type="button" aria-label="Canvas">
          ◇
        </button>
        <button className="rail-tool" type="button" aria-label="Agent">
          ✦
        </button>
        <button className="rail-tool" type="button" aria-label="Knowledge">
          ⌘
        </button>
        <button className="rail-tool" type="button" aria-label="Settings">
          ⚙
        </button>
      </nav>
      <header className="workspace-top">
        <div className="brand-block">
          <strong>溯证 Agent</strong>
          <span>Context Playground</span>
        </div>
        <div className="claim-bar">
          <label htmlFor="claim-input">Ask on canvas</label>
          <textarea
            id="claim-input"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            rows={2}
            aria-label="输入观点"
          />
        </div>
        <div className="agent-status">
          <span>Oracle Controller</span>
          <strong>{stageLabel}</strong>
          <div className="status-actions">
            <button onClick={started ? advanceReasoning : startReasoning} disabled={started && revealStage >= guidedRevealLimit} type="button">
              {primaryButtonLabel}
            </button>
            <button className="secondary-button" onClick={resetReasoning} type="button">
              重置
            </button>
          </div>
        </div>
      </header>

      <div className="workspace-grid">
        <AgentTrace steps={traceSteps} revealStage={revealStage} activeStepId={activeStepId} onStepSelect={selectStep} />
        {started ? (
          <ReasoningCanvas
            nodes={visibleNodes}
            edges={visibleEdges}
            selectedNodeId={selectedNode.id}
            highlightedNodeIds={highlightedNodeIds}
            nodePositionOverrides={nodePositionOverrides}
            onNodeSelect={selectNode}
            onNodeMove={moveNode}
          />
        ) : (
          <section className="canvas-panel start-panel">
            <div>
              <strong>点击开始，Agent 会把这句话展开成一张论证地图。</strong>
              <p>Agent 只先搭出三层问题空间；之后由你选择节点继续发散。</p>
            </div>
          </section>
        )}
        <NodeInspector
          node={selectedNode}
          caseData={caseData}
          gradedEvidence={gradedEvidence}
          report={report}
          canExpand={started && revealStage >= guidedRevealLimit}
          expansionPrompt={expansionPrompt}
          expansionMode={expansionMode}
          latestRun={latestRunForNode}
          isExpanding={isExpanding}
          agentError={agentError}
          onExpansionPromptChange={setExpansionPrompt}
          onExpansionModeChange={setExpansionMode}
          onExpandNode={expandSelectedNode}
        />
      </div>

      <ConclusionDock report={report} revealStage={userNodes.length > 0 ? 4 : revealStage} explorationCount={agentRuns.length} />
    </main>
  );
}

function buildNodeExpansion(
  node: CanvasNode,
  mode: ExpansionMode,
  prompt: string,
  runIndex: number,
  llmResult: AgentExpansionResponse,
) {
  const dir = node.x > 70 ? -1 : 1;
  const upperY = node.y > 72 ? -30 : -14;
  const lowerY = node.y > 72 ? -2 : 14;
  const farY = node.y > 72 ? -48 : 0;
  const baseId = `user-${runIndex}-${node.id}`;
  const modeMeta = expansionModeMeta[mode];

  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "中控 LLM 调度",
    subtitle: llmResult.controllerNote,
    x: clamp(node.x + 18 * dir),
    y: clamp(node.y + upperY),
    status: "active",
    revealStage: guidedRevealLimit,
  };
  const specialist: CanvasNode = {
    id: `${baseId}-specialist`,
    type: "agent_task",
    title: llmResult.agentTitle || modeMeta.agentTitle,
    subtitle: llmResult.agentSubtitle || modeMeta.agentSubtitle,
    x: clamp(node.x + 32 * dir),
    y: clamp(node.y + farY),
    status: mode === "counter" ? "risk" : "limited",
    revealStage: guidedRevealLimit,
  };
  const result: CanvasNode = {
    id: `${baseId}-result`,
    type: mode === "rewrite" ? "rewrite" : mode === "search" ? "candidate_evidence" : "evidence_need",
    title: llmResult.resultTitle || modeMeta.resultTitle,
    subtitle: llmResult.resultSubtitle || modeMeta.resultSubtitle,
    x: clamp(node.x + 18 * dir),
    y: clamp(node.y + lowerY),
    status: modeMeta.resultStatus,
    revealStage: guidedRevealLimit,
  };

  const nodes = [controller, specialist, result];
  const edges: CanvasEdge[] = [
    { id: `${baseId}-edge-controller`, from: node.id, to: controller.id, label: "用户触发", revealStage: guidedRevealLimit },
    { id: `${baseId}-edge-specialist`, from: controller.id, to: specialist.id, label: "派单", revealStage: guidedRevealLimit },
    { id: `${baseId}-edge-result`, from: specialist.id, to: result.id, label: "局部结果", revealStage: guidedRevealLimit },
  ];
  const run: AgentRun = {
    id: `${baseId}-run`,
    nodeId: node.id,
    nodeTitle: node.title,
    mode,
    prompt,
    controllerNote: llmResult.controllerNote,
    agents: ["中控 LLM", llmResult.agentTitle || modeMeta.agentTitle],
    inspectorSummary: llmResult.inspectorSummary,
    canSay: llmResult.canSay,
    cannotSay: llmResult.cannotSay,
    sources: llmResult.sources,
    model: llmResult.model,
  };

  return { nodes, edges, run };
}

function clamp(value: number) {
  return Math.max(8, Math.min(92, value));
}

const expansionModeMeta: Record<
  ExpansionMode,
  {
    agentTitle: string;
    agentSubtitle: string;
    resultTitle: string;
    resultSubtitle: string;
    resultStatus: NonNullable<CanvasNode["status"]>;
  }
> = {
  search: {
    agentTitle: "Searcher 子 Agent",
    agentSubtitle: "只在这个节点上联网查找候选材料",
    resultTitle: "新增候选证据",
    resultSubtitle: "等待用户确认是否纳入审计",
    resultStatus: "limited",
  },
  evidence_audit: {
    agentTitle: "Grader 子 Agent",
    agentSubtitle: "判断材料能说什么、不能说什么",
    resultTitle: "证据许可问题",
    resultSubtitle: "先形成待验证清单，不直接下结论",
    resultStatus: "active",
  },
  counter: {
    agentTitle: "Counter 子 Agent",
    agentSubtitle: "寻找反证路径和替代解释",
    resultTitle: "反向分支",
    resultSubtitle: "防止沿单一路径过度自信",
    resultStatus: "risk",
  },
  rewrite: {
    agentTitle: "Composer 子 Agent",
    agentSubtitle: "只根据当前节点的证据许可改写",
    resultTitle: "局部改写",
    resultSubtitle: "把该节点收束成更谨慎表达",
    resultStatus: "rewrite",
  },
};
