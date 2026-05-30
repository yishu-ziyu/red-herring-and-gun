import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { runDemoPipeline } from "../../lib/pipeline";
import {
  requestAgentExpansion,
  requestRecursiveSearch,
  requestSherlockSearch,
  requestOrchestrateStream,
  request360Search,
  type ExpansionMode,
  type RecursiveSearchResponse,
  type Search360Response,
  type HandoffResult,
  type HandoffStep,
} from "../../lib/agentExpansion";
import {
  useReasoning,
  selectFocusedPath,
  selectLatestRunForNode,
  selectLatestRecursiveRunForNode,
  selectLatestSherlockRunForNode,
  selectSelectedNode,
  selectLatestHandoffRun,
} from "../../store/reasoningStore";
import { canvasNodes, canvasEdges, reasoningSteps } from "../../data/reasoningCanvas";
import { AgentTraceV3 } from "./AgentTraceV3";
import { ConclusionDockV3 } from "./ConclusionDockV3";
import { NodeInspectorV3 } from "./NodeInspectorV3";
import { ReasoningCanvasV3 } from "./ReasoningCanvasV3";
import { ReasoningIslandNav } from "./ReasoningIslandNav";
import { AgentPanel } from "./panels/AgentPanel";
import { KnowledgePanel } from "./panels/KnowledgePanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import type { CanvasNode, CanvasEdge, ReasoningStep } from "../../data/reasoningCanvas";
import type { NodePositionOverrides } from "../canvas/layeredLayout";
import type { AgentRun, RecursiveSearchRun, SherlockSearchRun } from "../../store/reasoningStore";
import { calculateCredibilityScore } from "../../lib/reportExporter";

// ───────────────────────────────────────────────────────────────
// Bottom Floating Input Bar
// ───────────────────────────────────────────────────────────────

interface FloatingInputBarProps {
  selectedNode: CanvasNode | null | undefined;
  expansionPrompt: string;
  expansionMode: ExpansionMode;
  isExpanding: boolean;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: ExpansionMode) => void;
  onSubmit: (prompt: string, mode: ExpansionMode) => void;
}

function FloatingInputBar({
  selectedNode,
  expansionPrompt,
  expansionMode,
  isExpanding,
  onPromptChange,
  onModeChange,
  onSubmit,
}: FloatingInputBarProps) {
  const [inputValue, setInputValue] = useState(expansionPrompt);

  useEffect(() => {
    setInputValue(expansionPrompt);
  }, [expansionPrompt]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isExpanding) return;
    onSubmit(trimmed, expansionMode);
    setInputValue("");
    onPromptChange("");
  }, [inputValue, isExpanding, expansionMode, onSubmit, onPromptChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const modeOptions: { value: ExpansionMode; label: string }[] = [
    { value: "search", label: "展开" },
    { value: "counter", label: "质疑" },
    { value: "rewrite", label: "改写" },
    { value: "rumor_check", label: "谣言核查" },
  ];

  return (
    <div className="floating-input-bar">
      {selectedNode && (
        <div className="floating-input-context">
          <span>针对节点: {selectedNode.title}</span>
        </div>
      )}
      <div className="floating-input-row">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onPromptChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedNode
              ? "输入指令展开/质疑/改写此节点..."
              : "在此输入问题或指令..."
          }
          disabled={isExpanding}
          aria-label={selectedNode ? "节点指令输入" : "问题或指令输入"}
        />
        {selectedNode && (
          <div className="floating-mode-pills">
            {modeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`mode-pill ${expansionMode === opt.value ? "active" : ""}`}
                onClick={() => onModeChange(opt.value)}
                disabled={isExpanding}
                aria-pressed={expansionMode === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="floating-send-btn"
          onClick={handleSubmit}
          disabled={isExpanding || !inputValue.trim()}
          aria-label="发送"
        >
          {isExpanding ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}

const { caseData, gradedEvidence, report } = runDemoPipeline();

interface ReasoningWorkspaceV3Props {
  orchestrateMode?: boolean;
}

export function ReasoningWorkspaceV3({ orchestrateMode = false }: ReasoningWorkspaceV3Props) {
  const { state, dispatch } = useReasoning();
  const [nodePositionOverrides, setNodePositionOverrides] = useState<NodePositionOverrides>({});
  const [activePanel, setActivePanel] = useState<"canvas" | "agent" | "knowledge" | "settings">("canvas");
  const [pendingHandoffFitNodeIds, setPendingHandoffFitNodeIds] = useState<string[]>([]);
  const [canvasReadyToken, setCanvasReadyToken] = useState(0);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  // Initialize demo case on mount only if no nodes exist yet
  useEffect(() => {
    if (state.nodes.length > 0) return;
    dispatch({
      type: "INIT_CASE",
      payload: {
        caseData,
        report,
        nodes: canvasNodes,
        edges: canvasEdges,
        steps: reasoningSteps,
      },
    });
  }, [dispatch, state.nodes.length]);

  // Orchestrate mode: auto-trigger multi-agent handoff on mount (streaming)
  useEffect(() => {
    if (!orchestrateMode || !state.originalClaim || state.isExpanding) return;

    let cancelled = false;
    let accumulatedSteps: HandoffStep[] = [];
    let accumulatedReport: Record<string, unknown> | undefined;
    let totalLatency = 0;

    async function runOrchestrateStream() {
      dispatch({ type: "START_HANDOFF_STREAM", payload: { claim: state.originalClaim } });

      try {
        const stream = requestOrchestrateStream(state.originalClaim);

        for await (const event of stream) {
          if (cancelled) return;

          switch (event.type) {
            case "agent_start": {
              const step: HandoffStep = {
                agent: event.agent ?? "unknown",
                agentName: event.agentName ?? event.agent ?? "Unknown",
                agentIcon: event.agentIcon ?? "🤖",
                systemPrompt: "",
                input: {},
                output: {},
                model: event.model ?? "unknown",
                latencyMs: 0,
                timestamp: event.timestamp ?? Date.now(),
                status: "running",
              };
              dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
              break;
            }
            case "agent_complete": {
              const step: HandoffStep = {
                agent: event.agent ?? "unknown",
                agentName: event.agentName ?? event.agent ?? "Unknown",
                agentIcon: event.agentIcon ?? "🤖",
                systemPrompt: "",
                input: {},
                output: event.output ?? {},
                model: event.model ?? "unknown",
                latencyMs: event.latencyMs ?? 0,
                timestamp: event.timestamp ?? Date.now(),
                status: "completed",
              };
              dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
              accumulatedSteps.push(step);
              totalLatency += step.latencyMs;
              break;
            }
            case "agent_error": {
              const step: HandoffStep = {
                agent: event.agent ?? "unknown",
                agentName: event.agentName ?? event.agent ?? "Unknown",
                agentIcon: event.agentIcon ?? "🤖",
                systemPrompt: "",
                input: {},
                output: {},
                model: event.model ?? "unknown",
                latencyMs: event.latencyMs ?? 0,
                timestamp: event.timestamp ?? Date.now(),
                status: "failed",
                error: event.error,
              };
              dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
              break;
            }
            case "complete": {
              accumulatedSteps = event.steps ?? accumulatedSteps;
              accumulatedReport = event.finalReport;
              totalLatency = event.totalLatencyMs ?? totalLatency;

              dispatch({
                type: "SET_HANDOFF_FINAL_REPORT",
                payload: {
                  finalReport: accumulatedReport,
                  totalLatencyMs: totalLatency,
                  model: accumulatedSteps.map((s) => s.model).join(", ") || "multi-agent",
                },
              });

              // Build canvas nodes for handoff visualization
              const handoffResult: HandoffResult = {
                claim: state.originalClaim,
                steps: accumulatedSteps,
                finalReport: accumulatedReport,
              };
              const handoffIndex = state.handoffRuns.length + 1;
              const expansion = buildHandoffCanvasNodes(handoffResult, handoffIndex, state.nodes);
              const traceStep: ReasoningStep = {
                id: `handoff-step-${handoffIndex}`,
                text: `多Agent Handoff 完成：${state.originalClaim.slice(0, 20)}...`,
                nodeIds: expansion.nodes.map((n) => n.id),
                revealStage: 99,
              };

              const run = {
                id: `handoff-${Date.now()}`,
                claim: state.originalClaim,
                steps: accumulatedSteps,
                finalReport: accumulatedReport,
                model: accumulatedSteps.map((s) => s.model).join(", ") || "multi-agent",
                totalLatencyMs: totalLatency,
                timestamp: Date.now(),
              };

              dispatch({
                type: "ADD_HANDOFF_RUN",
                payload: { run, nodes: expansion.nodes, edges: expansion.edges, step: traceStep },
              });
              setPendingHandoffFitNodeIds(expansion.nodes.map((node) => node.id));

              // Keep the fitted handoff chain visible on the canvas after completion.
              setActivePanel("canvas");
              break;
            }
            case "error": {
              dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: event.error ?? event.message } });
              break;
            }
          }
        }
      } catch (error) {
        if (cancelled) return;
        dispatch({
          type: "COMPLETE_HANDOFF_STREAM",
          payload: { error: error instanceof Error ? error.message : "Orchestrate 调用失败" },
        });
      }
    }

    runOrchestrateStream();

    return () => {
      cancelled = true;
    };
  }, [orchestrateMode, state.originalClaim, dispatch]);

  const selectedNode = useMemo(() => selectSelectedNode(state), [state]);
  const focusedPath = useMemo(() => selectFocusedPath(state), [state]);
  const latestRun = useMemo(
    () => (selectedNode ? selectLatestRunForNode(state, selectedNode.id) : undefined),
    [state, selectedNode],
  );
  const latestRecursiveRun = useMemo(
    () => (selectedNode ? selectLatestRecursiveRunForNode(state, selectedNode.id) : undefined),
    [state, selectedNode],
  );
  const latestSherlockRun = useMemo(
    () => (selectedNode ? selectLatestSherlockRunForNode(state, selectedNode.id) : undefined),
    [state, selectedNode],
  );
  const latestHandoffRun = useMemo(() => selectLatestHandoffRun(state), [state]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      dispatch({ type: "SELECT_NODE", payload: { nodeId } });
    },
    [dispatch],
  );

  const handleEnterFocus = useCallback(
    (nodeId: string) => {
      dispatch({ type: "ENTER_FOCUS_MODE", payload: { nodeId } });
    },
    [dispatch],
  );

  const handleExitFocus = useCallback(() => {
    dispatch({ type: "EXIT_FOCUS_MODE" });
  }, [dispatch]);

  const handleMoveNode = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setNodePositionOverrides((prev) => ({ ...prev, [nodeId]: position }));
  }, []);

  const handleCanvasInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
    setCanvasReadyToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (activePanel !== "canvas" || pendingHandoffFitNodeIds.length === 0) return;

    const instance = reactFlowInstanceRef.current;
    if (!instance) return;

    const nodeIds = pendingHandoffFitNodeIds;
    const timer = window.setTimeout(() => {
      void instance.fitView({
        nodes: nodeIds.map((id) => ({ id })),
        padding: 0.2,
        duration: 800,
      });
      setPendingHandoffFitNodeIds([]);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [activePanel, pendingHandoffFitNodeIds, canvasReadyToken]);

  const handleSelectStep = useCallback(
    (step: ReasoningStep) => {
      dispatch({
        type: "SELECT_STEP",
        payload: { stepId: step.id, nodeIds: step.nodeIds },
      });
    },
    [dispatch],
  );

  const handleExpandNode = useCallback(
    async (prompt: string, mode: ExpansionMode) => {
      if (!selectedNode || state.isExpanding) return;

      const runIndex = state.agentRuns.length + 1;
      dispatch({ type: "START_EXPANDING" });

      try {
        const llmResult = await requestAgentExpansion({
          claim: state.originalClaim,
          node: {
            id: selectedNode.id,
            type: selectedNode.type,
            title: selectedNode.title,
            subtitle: selectedNode.subtitle,
            status: selectedNode.status,
          },
          mode,
          prompt,
          visibleNodeTitles: state.nodes.map((n) => n.title),
        });

        const expansion = buildNodeExpansion(selectedNode, mode, prompt, runIndex, llmResult, state.nodes);
        const step: ReasoningStep = {
          id: `user-step-${runIndex}`,
          text: llmResult.traceText,
          nodeIds: expansion.nodes.map((n) => n.id),
          revealStage: 99, // v3: no stage filtering
        };

        dispatch({
          type: "ADD_NODES",
          payload: { nodes: expansion.nodes, edges: expansion.edges, run: expansion.run, step },
        });
      } catch (error) {
        dispatch({
          type: "FINISH_EXPANDING",
          payload: { error: error instanceof Error ? error.message : "真实模型调用失败" },
        });
      }
    },
    [dispatch, selectedNode, state.isExpanding, state.agentRuns.length, state.originalClaim, state.nodes],
  );

  const handleRecursiveSearch = useCallback(
    async (question: string, depthLimit: number, budgetLimit: number) => {
      if (!selectedNode || state.isExpanding) return;

      const runIndex = state.recursiveSearchRuns.length + 1;
      dispatch({ type: "START_EXPANDING" });

      try {
        const llmResult = await requestRecursiveSearch({
          claim: state.originalClaim,
          seedNode: {
            id: selectedNode.id,
            type: selectedNode.type,
            title: selectedNode.title,
            subtitle: selectedNode.subtitle,
            status: selectedNode.status,
          },
          question,
          depthLimit,
          budgetLimit,
          visibleNodeTitles: state.nodes.map((n) => n.title),
          existingSources: [
            ...state.agentRuns.flatMap((run) => run.sources),
            ...state.recursiveSearchRuns.flatMap((run) => run.clues.map((clue) => clue.source)),
          ],
        });

        const expansion = buildRecursiveSearchExpansion(selectedNode, question, depthLimit, budgetLimit, runIndex, llmResult, state.nodes);
        const step: ReasoningStep = {
          id: `recursive-step-${runIndex}`,
          text: llmResult.traceText,
          nodeIds: expansion.nodes.map((node) => node.id),
          revealStage: 99,
        };

        dispatch({
          type: "ADD_RECURSIVE_NODES",
          payload: { nodes: expansion.nodes, edges: expansion.edges, run: expansion.run, step },
        });
      } catch (error) {
        dispatch({
          type: "FINISH_EXPANDING",
          payload: { error: error instanceof Error ? error.message : "递归搜索真实模型调用失败" },
        });
      }
    },
    [
      dispatch,
      selectedNode,
      state.isExpanding,
      state.recursiveSearchRuns,
      state.originalClaim,
      state.nodes,
      state.agentRuns,
    ],
  );

  const handleSherlockSearch = useCallback(
    async (claim: string) => {
      if (!selectedNode || state.isExpanding) return;

      const runIndex = state.sherlockSearchRuns.length + 1;
      dispatch({ type: "START_EXPANDING" });

      try {
        const result = await requestSherlockSearch({
          claim,
          keywords: [],
          nodeTitle: selectedNode.title,
        });

        const expansion = buildSherlockSearchExpansion(selectedNode, claim, runIndex, result, state.nodes);
        const step: ReasoningStep = {
          id: `sherlock-step-${runIndex}`,
          text: result.traceText,
          nodeIds: expansion.nodes.map((n) => n.id),
          revealStage: 99,
        };

        dispatch({
          type: "ADD_SHERLOCK_RUN",
          payload: { nodes: expansion.nodes, edges: expansion.edges, run: expansion.run, step },
        });
      } catch (error) {
        dispatch({
          type: "FINISH_EXPANDING",
          payload: { error: error instanceof Error ? error.message : "Sherlock 搜索调用失败" },
        });
      }
    },
    [dispatch, selectedNode, state.isExpanding, state.sherlockSearchRuns, state.nodes],
  );

  const handle360Search = useCallback(
    async (query: string) => {
      if (!selectedNode || state.isExpanding) return;

      const runIndex = state.agentRuns.length + 1;
      dispatch({ type: "START_EXPANDING" });

      try {
        const result = await request360Search({ query });
        const expansion = build360SearchExpansion(selectedNode, query, runIndex, result, state.nodes);
        const step: ReasoningStep = {
          id: `search360-step-${runIndex}`,
          text: result.traceText ?? `360 AI Search 返回 ${result.sources.length} 条来源。`,
          nodeIds: expansion.nodes.map((node) => node.id),
          revealStage: 99,
        };

        dispatch({
          type: "ADD_NODES",
          payload: { nodes: expansion.nodes, edges: expansion.edges, run: expansion.run, step },
        });
      } catch (error) {
        dispatch({
          type: "FINISH_EXPANDING",
          payload: { error: error instanceof Error ? error.message : "360 AI Search 调用失败" },
        });
      }
    },
    [dispatch, selectedNode, state.agentRuns.length, state.isExpanding, state.nodes],
  );

  const handleSetExpansionPrompt = useCallback(
    (value: string) => {
      dispatch({ type: "SET_EXPANSION_PROMPT", payload: value });
    },
    [dispatch],
  );

  const handleSetExpansionMode = useCallback(
    (mode: ExpansionMode) => {
      dispatch({ type: "SET_EXPANSION_MODE", payload: mode });
    },
    [dispatch],
  );

  const handleSetRecursiveSearchPrompt = useCallback(
    (value: string) => {
      dispatch({ type: "SET_RECURSIVE_SEARCH_PROMPT", payload: value });
    },
    [dispatch],
  );

  const handleSetRecursiveDepthLimit = useCallback(
    (value: number) => {
      dispatch({ type: "SET_RECURSIVE_DEPTH_LIMIT", payload: value });
    },
    [dispatch],
  );

  const handleSetRecursiveBudgetLimit = useCallback(
    (value: number) => {
      dispatch({ type: "SET_RECURSIVE_BUDGET_LIMIT", payload: value });
    },
    [dispatch],
  );

  const handleReset = useCallback(() => {
    setNodePositionOverrides({});
    dispatch({ type: "RESET" });
    dispatch({
      type: "INIT_CASE",
      payload: {
        caseData,
        report,
        nodes: canvasNodes,
        edges: canvasEdges,
        steps: reasoningSteps,
      },
    });
  }, [dispatch]);

  const exploredCount = state.agentRuns.length;
  const handoffCount = state.handoffRuns.length;
  const credibilityScore = report
    ? calculateCredibilityScore(caseData, report).score
    : 50;

  return (
    <main className="reasoning-workspace">
      <nav className="flow-rail" aria-label="Canvas tools">
        <div className="rail-brand">
          <strong>真</strong>
          <span>红鲱鱼与枪</span>
        </div>
        <div className="rail-nav">
          <button
            className={`rail-tool ${activePanel === "canvas" ? "active" : ""}`}
            type="button"
            aria-label="Canvas"
            onClick={() => setActivePanel("canvas")}
          >
            <span className="rail-icon">◇</span>
            <span>画布</span>
          </button>
          <button
            className={`rail-tool ${activePanel === "agent" ? "active" : ""}`}
            type="button"
            aria-label="Agent"
            onClick={() => setActivePanel("agent")}
          >
            <span className="rail-icon">✦</span>
            <span>Agent</span>
          </button>
          <button
            className={`rail-tool ${activePanel === "knowledge" ? "active" : ""}`}
            type="button"
            aria-label="Knowledge"
            onClick={() => setActivePanel("knowledge")}
          >
            <span className="rail-icon">⌘</span>
            <span>知识库</span>
          </button>
          <button
            className={`rail-tool ${activePanel === "settings" ? "active" : ""}`}
            type="button"
            aria-label="Settings"
            onClick={() => setActivePanel("settings")}
          >
            <span className="rail-icon">⚙</span>
            <span>设置</span>
          </button>
        </div>
      </nav>

      <header className="workspace-top">
        <div className="brand-block">
          <strong>红鲱鱼与枪</strong>
          <span>Truth Hunter</span>
        </div>
        <div className="claim-bar">
          <label>待核查信息</label>
          <span className="claim-text">{state.originalClaim}</span>
        </div>
        <div className="agent-status">
          <span>核查进度</span>
          <strong>
            {exploredCount > 0
              ? `已核查 ${exploredCount} 个节点`
              : handoffCount > 0
                ? `已完成 ${handoffCount} 次深度核查`
                : "等待开始核查"}
          </strong>
          <div className="status-actions">
            <button onClick={handleReset} type="button">
              重置画布
            </button>
          </div>
        </div>
      </header>

      {activePanel === "canvas" && (
        <>
          <div className="workspace-grid">
            <AgentTraceV3
              steps={state.traceSteps}
              activeStepId={state.activeStepId}
              onStepSelect={handleSelectStep}
            />

            <ReasoningCanvasV3
              nodes={state.nodes}
              edges={state.edges}
              selectedNodeId={state.selectedNodeId}
              focusedPath={focusedPath}
              isFocusMode={state.isFocusMode}
              nodePositionOverrides={nodePositionOverrides}
              onNodeSelect={handleSelectNode}
              onNodeEnterFocus={handleEnterFocus}
              onExitFocus={handleExitFocus}
              onNodeMove={handleMoveNode}
              onInit={handleCanvasInit}
            />

            {selectedNode ? (
              <NodeInspectorV3
                node={selectedNode}
                caseData={caseData}
                gradedEvidence={gradedEvidence}
                report={report}
                canExpand={!state.isExpanding}
                expansionPrompt={state.expansionPrompt}
                expansionMode={state.expansionMode}
	                latestRun={latestRun}
	                latestRecursiveRun={latestRecursiveRun}
	                recursiveRuns={state.recursiveSearchRuns}
                sherlockRuns={state.sherlockSearchRuns}	                isExpanding={state.isExpanding}
	                agentError={state.agentError}
	                recursiveSearchPrompt={state.recursiveSearchPrompt}
	                recursiveDepthLimit={state.recursiveDepthLimit}
	                recursiveBudgetLimit={state.recursiveBudgetLimit}
	                onExpansionPromptChange={handleSetExpansionPrompt}
	                onExpansionModeChange={handleSetExpansionMode}
	                onExpandNode={handleExpandNode}
	                onRecursiveSearchPromptChange={handleSetRecursiveSearchPrompt}
	                onRecursiveDepthLimitChange={handleSetRecursiveDepthLimit}
                onRecursiveBudgetLimitChange={handleSetRecursiveBudgetLimit}
	                onRecursiveSearch={handleRecursiveSearch}
                onSherlockSearch={handleSherlockSearch}
                on360Search={handle360Search}
              />
            ) : (
              <aside className="node-inspector" aria-label="Node inspector">
                <div className="panel-heading">
                  <span>Context Inspector</span>
                  <strong>未选择</strong>
                </div>
                <div className="trace-empty">点击画布上的节点查看详情</div>
              </aside>
            )}
          </div>

	          <FloatingInputBar
	            selectedNode={selectedNode}
	            expansionPrompt={state.expansionPrompt}
            expansionMode={state.expansionMode}
            isExpanding={state.isExpanding}
            onPromptChange={handleSetExpansionPrompt}
            onModeChange={handleSetExpansionMode}
	            onSubmit={handleExpandNode}
	          />

	          <ReasoningIslandNav
	            nodes={state.nodes}
	            selectedNodeId={state.selectedNodeId}
	            steps={state.traceSteps}
	            activeStepId={state.activeStepId}
	            isExpanding={state.isExpanding}
	            agentRunCount={state.agentRuns.length}
	            recursiveRunCount={state.recursiveSearchRuns.length}
	            onNodeSelect={handleSelectNode}
	            onStepSelect={handleSelectStep}
	          />

	          <ConclusionDockV3
            report={report}
            caseData={caseData}
            explorationCount={exploredCount}
            credibilityScore={credibilityScore}
            verificationResult={state.verificationResult}
            onSetVerification={(result) =>
              dispatch({ type: "SET_VERIFICATION_RESULT", payload: result })
            }
            originalClaim={state.originalClaim}
            handoffResult={
              latestHandoffRun
                ? {
                    claim: latestHandoffRun.claim,
                    conclusion:
                      typeof latestHandoffRun.finalReport?.conclusion === "string"
                        ? latestHandoffRun.finalReport.conclusion
                        : undefined,
                    credibilityScore:
                      typeof latestHandoffRun.finalReport?.credibilityScore === "number"
                        ? latestHandoffRun.finalReport.credibilityScore
                        : undefined,
                    credibilityLabel:
                      typeof latestHandoffRun.finalReport?.credibilityLabel === "string"
                        ? latestHandoffRun.finalReport.credibilityLabel
                        : undefined,
                    recommendation:
                      typeof latestHandoffRun.finalReport?.recommendation === "string"
                        ? latestHandoffRun.finalReport.recommendation
                        : undefined,
                  }
                : null
            }
          />
        </>
      )}

      {activePanel === "agent" && <AgentPanel />}
      {activePanel === "knowledge" && <KnowledgePanel />}
      {activePanel === "settings" && <SettingsPanel />}
    </main>
  );
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function buildNodeExpansion(
  node: CanvasNode,
  mode: ExpansionMode,
  prompt: string,
  runIndex: number,
  llmResult: Awaited<ReturnType<typeof requestAgentExpansion>>,
  existingNodes: CanvasNode[],
) {
  const dir = node.x > 70 ? -1 : 1;
  const upperY = node.y > 72 ? -30 : -14;
  const lowerY = node.y > 72 ? -2 : 14;
  const farY = node.y > 72 ? -48 : 0;
  const baseId = `user-${runIndex}-${node.id}`;
  const modeMeta = expansionModeMeta[mode];

  // Collision avoidance: compute positions and offset if too close to existing nodes
  const MIN_DISTANCE = 10; // minimum distance in percentage points

  function findFreePosition(targetX: number, targetY: number): { x: number; y: number } {
    let x = targetX;
    let y = targetY;
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      const tooClose = existingNodes.some((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
      });

      if (!tooClose) break;

      // Offset vertically first, then horizontally
      y = clamp(y + (attempts % 2 === 0 ? 8 : -8));
      if (attempts > 5) {
        x = clamp(x + (attempts % 2 === 0 ? 5 : -5));
      }
      attempts++;
    }

    return { x, y };
  }

  const controllerPos = findFreePosition(clamp(node.x + 18 * dir), clamp(node.y + upperY));
  const specialistPos = findFreePosition(clamp(node.x + 32 * dir), clamp(node.y + farY));
  const resultPos = findFreePosition(clamp(node.x + 18 * dir), clamp(node.y + lowerY));

  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "中控 LLM 调度",
    subtitle: llmResult.controllerNote,
    x: controllerPos.x,
    y: controllerPos.y,
    status: "active",
    revealStage: 99,
  };
  const specialist: CanvasNode = {
    id: `${baseId}-specialist`,
    type: "agent_task",
    title: llmResult.agentTitle || modeMeta.agentTitle,
    subtitle: llmResult.agentSubtitle || modeMeta.agentSubtitle,
    x: specialistPos.x,
    y: specialistPos.y,
    status: mode === "counter" ? "risk" : "limited",
    revealStage: 99,
  };
  const result: CanvasNode = {
    id: `${baseId}-result`,
    type: mode === "rewrite" ? "rewrite" : mode === "search" ? "candidate_evidence" : "evidence_need",
    title: llmResult.resultTitle || modeMeta.resultTitle,
    subtitle: llmResult.resultSubtitle || modeMeta.resultSubtitle,
    x: resultPos.x,
    y: resultPos.y,
    status: modeMeta.resultStatus,
    revealStage: 99,
  };

  const nodes = [controller, specialist, result];
  const edges: CanvasEdge[] = [
    { id: `${baseId}-edge-controller`, from: node.id, to: controller.id, label: "用户触发", revealStage: 99 },
    { id: `${baseId}-edge-specialist`, from: controller.id, to: specialist.id, label: "派单", revealStage: 99 },
    { id: `${baseId}-edge-result`, from: specialist.id, to: result.id, label: "局部结果", revealStage: 99 },
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

function buildRecursiveSearchExpansion(
  node: CanvasNode,
  question: string,
  depthLimit: number,
  budgetLimit: number,
  runIndex: number,
  llmResult: RecursiveSearchResponse,
  existingNodes: CanvasNode[],
) {
  const dir = node.x > 66 ? -1 : 1;
  const baseId = `recursive-${runIndex}-${node.id}`;
  const runId = `${baseId}-run`;
  const MIN_DISTANCE = 8;

  function findFreePosition(targetX: number, targetY: number): { x: number; y: number } {
    let x = targetX;
    let y = targetY;
    let attempts = 0;
    while (attempts < 24) {
      const tooClose = [...existingNodes, ...nodes].some((existing) => {
        const dx = existing.x - x;
        const dy = existing.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
      });
      if (!tooClose) break;
      y = clamp(y + (attempts % 2 === 0 ? 7 : -7));
      if (attempts > 5) x = clamp(x + (attempts % 2 === 0 ? 5 : -5));
      attempts++;
    }
    return { x, y };
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const controllerPos = findFreePosition(clamp(node.x + 16 * dir), clamp(node.y - 18));
  const agentPos = findFreePosition(clamp(node.x + 30 * dir), clamp(node.y - 2));

  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "递归搜索调度",
    subtitle: llmResult.controllerNote,
    x: controllerPos.x,
    y: controllerPos.y,
    status: "controller",
    sourceRef: { recursiveRunId: runId },
    revealStage: 99,
  };
  const searchAgent: CanvasNode = {
    id: `${baseId}-search-agent`,
    type: "agent_task",
    title: llmResult.runTitle || "Search 子 Agent",
    subtitle: "搜索、提取、去重，并生成下一批 frontier",
    x: agentPos.x,
    y: agentPos.y,
    status: "active",
    sourceRef: { recursiveRunId: runId },
    revealStage: 99,
  };

  nodes.push(controller, searchAgent);
  edges.push(
    { id: `${baseId}-edge-controller`, from: node.id, to: controller.id, label: "递归触发", revealStage: 99 },
    { id: `${baseId}-edge-agent`, from: controller.id, to: searchAgent.id, label: "派单", revealStage: 99 },
  );

  llmResult.clues.forEach((clue, index) => {
    const pos = findFreePosition(clamp(node.x + (42 + index * 7) * dir), clamp(node.y - 24 + index * 13));
    const clueNode: CanvasNode = {
      id: `${baseId}-clue-${index + 1}`,
      type: "evidence_clue",
      title: clue.title,
      subtitle: clue.summary,
      x: pos.x,
      y: pos.y,
      status: clue.role === "support" ? "supported" : clue.role === "counter" ? "risk" : "clue",
      sourceRef: { recursiveRunId: runId, clueId: clue.id },
      revealStage: 99,
    };
    nodes.push(clueNode);
    edges.push({ id: `${baseId}-edge-clue-${index + 1}`, from: searchAgent.id, to: clueNode.id, label: clue.role, revealStage: 99 });
  });

  llmResult.frontier.forEach((frontier, index) => {
    const pos = findFreePosition(clamp(node.x + (44 + index * 8) * dir), clamp(node.y + 18 + index * 13));
    const frontierNode: CanvasNode = {
      id: `${baseId}-frontier-${index + 1}`,
      type: "search_frontier",
      title: frontier.title,
      subtitle: frontier.reasonToContinue,
      x: pos.x,
      y: pos.y,
      status: "frontier",
      sourceRef: { recursiveRunId: runId, frontierId: frontier.id },
      revealStage: 99,
    };
    nodes.push(frontierNode);
    edges.push({ id: `${baseId}-edge-frontier-${index + 1}`, from: searchAgent.id, to: frontierNode.id, label: "等待选择", revealStage: 99 });
  });

  llmResult.stopped.forEach((stopped, index) => {
    const pos = findFreePosition(clamp(node.x + (28 + index * 7) * dir), clamp(node.y + 42 + index * 10));
    const stoppedNode: CanvasNode = {
      id: `${baseId}-stopped-${index + 1}`,
      type: "search_stopped",
      title: stopped.title,
      subtitle: stoppedReasonLabel(stopped.reason),
      x: pos.x,
      y: pos.y,
      status: "stopped",
      sourceRef: { recursiveRunId: runId, stoppedId: stopped.id },
      revealStage: 99,
    };
    nodes.push(stoppedNode);
    edges.push({ id: `${baseId}-edge-stopped-${index + 1}`, from: searchAgent.id, to: stoppedNode.id, label: "停止", revealStage: 99 });
  });

  const run: RecursiveSearchRun = {
    id: runId,
    nodeId: node.id,
    nodeTitle: node.title,
    question,
    depthLimit,
    budgetLimit,
    controllerNote: llmResult.controllerNote,
    traceText: llmResult.traceText,
    clues: llmResult.clues,
    frontier: llmResult.frontier,
    stopped: llmResult.stopped,
    canSay: llmResult.canSay,
    cannotSay: llmResult.cannotSay,
    model: llmResult.model,
  };

  return { nodes, edges, run };
}

function buildSherlockSearchExpansion(
  node: CanvasNode,
  claim: string,
  runIndex: number,
  llmResult: Awaited<ReturnType<typeof requestSherlockSearch>>,
  existingNodes: CanvasNode[],
) {
  const dir = node.x > 66 ? -1 : 1;
  const baseId = `sherlock-${runIndex}-${node.id}`;
  const runId = `${baseId}-run`;
  const MIN_DISTANCE = 8;

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  function findFreePosition(targetX: number, targetY: number): { x: number; y: number } {
    let x = targetX;
    let y = targetY;
    let attempts = 0;
    while (attempts < 24) {
      const tooClose = [...existingNodes, ...nodes].some((existing) => {
        const dx = existing.x - x;
        const dy = existing.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
      });
      if (!tooClose) break;
      y = clamp(y + (attempts % 2 === 0 ? 7 : -7));
      if (attempts > 5) x = clamp(x + (attempts % 2 === 0 ? 5 : -5));
      attempts++;
    }
    return { x, y };
  }

  const controllerPos = findFreePosition(clamp(node.x + 16 * dir), clamp(node.y - 18));
  const agentPos = findFreePosition(clamp(node.x + 30 * dir), clamp(node.y - 2));

  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "Sherlock 调度器",
    subtitle: llmResult.controllerNote,
    x: controllerPos.x,
    y: controllerPos.y,
    status: "controller",
    sourceRef: { recursiveRunId: runId },
    revealStage: 99,
  };
  const searchAgent: CanvasNode = {
    id: `${baseId}-search-agent`,
    type: "agent_task",
    title: llmResult.runTitle || "多平台溯源 Agent",
    subtitle: `并行搜索 ${llmResult.sourcesSearched} 个平台，命中 ${llmResult.sourcesMatched} 个`,
    x: agentPos.x,
    y: agentPos.y,
    status: "active",
    sourceRef: { recursiveRunId: runId },
    revealStage: 99,
  };

  nodes.push(controller, searchAgent);
  edges.push(
    { id: `${baseId}-edge-controller`, from: node.id, to: controller.id, label: "溯源触发", revealStage: 99 },
    { id: `${baseId}-edge-agent`, from: controller.id, to: searchAgent.id, label: "并行派单", revealStage: 99 },
  );

  llmResult.hits.forEach((hit, index) => {
    const pos = findFreePosition(clamp(node.x + (42 + index * 7) * dir), clamp(node.y - 24 + index * 13));
    const hitNode: CanvasNode = {
      id: `${baseId}-hit-${index + 1}`,
      type: "evidence_clue",
      title: `${hit.sourceIcon} ${hit.sourceName}`,
      subtitle: hit.summary,
      x: pos.x,
      y: pos.y,
      status: hit.factCheckResult === "false" ? "risk" : hit.factCheckResult === "true" ? "supported" : "clue",
      sourceRef: { recursiveRunId: runId, clueId: hit.sourceId },
      revealStage: 99,
    };
    nodes.push(hitNode);
    edges.push({ id: `${baseId}-edge-hit-${index + 1}`, from: searchAgent.id, to: hitNode.id, label: "命中", revealStage: 99 });
  });

  const run: SherlockSearchRun = {
    id: runId,
    nodeId: node.id,
    nodeTitle: node.title,
    claim,
    controllerNote: llmResult.controllerNote,
    traceText: llmResult.traceText,
    hits: llmResult.hits,
    sourcesSearched: llmResult.sourcesSearched,
    sourcesMatched: llmResult.sourcesMatched,
    canSay: llmResult.canSay,
    cannotSay: llmResult.cannotSay,
    model: llmResult.model,
  };

  return { nodes, edges, run };
}

function build360SearchExpansion(
  node: CanvasNode,
  query: string,
  runIndex: number,
  result: Search360Response,
  existingNodes: CanvasNode[],
) {
  const dir = node.x > 66 ? -1 : 1;
  const baseId = `search360-${runIndex}-${node.id}`;
  const MIN_DISTANCE = 8;
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  function findFreePosition(targetX: number, targetY: number): { x: number; y: number } {
    let x = targetX;
    let y = targetY;
    let attempts = 0;
    while (attempts < 24) {
      const tooClose = [...existingNodes, ...nodes].some((existing) => {
        const dx = existing.x - x;
        const dy = existing.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
      });
      if (!tooClose) break;
      y = clamp(y + (attempts % 2 === 0 ? 7 : -7));
      if (attempts > 5) x = clamp(x + (attempts % 2 === 0 ? 5 : -5));
      attempts++;
    }
    return { x, y };
  }

  const controllerPos = findFreePosition(clamp(node.x + 15 * dir), clamp(node.y + 16));
  const answerPos = findFreePosition(clamp(node.x + 29 * dir), clamp(node.y + 4));
  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "360 AI Search",
    subtitle: result.traceText ?? "调用 360 智搜进行实时检索。",
    x: controllerPos.x,
    y: controllerPos.y,
    status: "controller",
    revealStage: 99,
  };
  const answerNode: CanvasNode = {
    id: `${baseId}-answer`,
    type: "evidence_clue",
    title: result._source === "demo-fallback" ? "360 搜索结果（模拟）" : "360 搜索摘要",
    subtitle: result.answer.slice(0, 110),
    x: answerPos.x,
    y: answerPos.y,
    status: result._source === "demo-fallback" ? "limited" : "supported",
    revealStage: 99,
  };

  nodes.push(controller, answerNode);
  edges.push(
    { id: `${baseId}-edge-controller`, from: node.id, to: controller.id, label: "360", revealStage: 99, animated: true },
    { id: `${baseId}-edge-answer`, from: controller.id, to: answerNode.id, label: "answer", revealStage: 99, animated: true },
  );

  result.sources.slice(0, 5).forEach((source, index) => {
    const pos = findFreePosition(clamp(node.x + (40 + index * 7) * dir), clamp(node.y - 20 + index * 11));
    const sourceNode: CanvasNode = {
      id: `${baseId}-source-${index + 1}`,
      type: "evidence_clue",
      title: source.title,
      subtitle: source.snippet || source.url,
      x: pos.x,
      y: pos.y,
      status: source.credibility === "高" ? "supported" : source.credibility === "低" ? "risk" : "clue",
      sourceRef: { clueId: source.url || source.title },
      revealStage: 99,
    };
    nodes.push(sourceNode);
    edges.push({ id: `${baseId}-edge-source-${index + 1}`, from: answerNode.id, to: sourceNode.id, label: "source", revealStage: 99 });
  });

  const run: AgentRun = {
    id: `${baseId}-run`,
    nodeId: node.id,
    nodeTitle: node.title,
    mode: "search",
    prompt: query,
    controllerNote: result.traceText ?? "360 AI Search 检索完成。",
    agents: ["360_ai_search"],
    inspectorSummary: result.answer,
    canSay: result.sources.length > 0 ? ["已获得搜索摘要和来源线索"] : ["当前只获得搜索摘要"],
    cannotSay: ["不能把搜索摘要直接当作最终结论", "仍需审计来源可信度"],
    sources: result.sources.map((source) => source.url || source.title),
    model: result.model ?? "360-ai-search",
    agentType: "source_validator",
  };

  return { nodes, edges, run };
}

// ───────────────────────────────────────────────────────────────
// Handoff Canvas Builder
// ───────────────────────────────────────────────────────────────

function buildHandoffCanvasNodes(
  result: HandoffResult,
  runIndex: number,
  existingNodes: CanvasNode[]
) {
  const baseId = `handoff-${runIndex}`;
  const MIN_DISTANCE = 10;

  function findFreePosition(targetX: number, targetY: number): { x: number; y: number } {
    let x = targetX;
    let y = targetY;
    let attempts = 0;
    while (attempts < 20) {
      const tooClose = existingNodes.some((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
      });
      if (!tooClose) break;
      y = clamp(y + (attempts % 2 === 0 ? 8 : -8));
      if (attempts > 5) x = clamp(x + (attempts % 2 === 0 ? 5 : -5));
      attempts++;
    }
    return { x, y };
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // Agent metadata
  const agentTypeMeta: Record<string, { icon: string }> = {
    rumor_detector: { icon: "🚨" },
    fact_checker: { icon: "🔍" },
    source_validator: { icon: "📋" },
    report_composer: { icon: "📝" },
  };

  // Phase 0: Controller
  const controllerPos = findFreePosition(12, 50);
  const controller: CanvasNode = {
    id: `${baseId}-controller`,
    type: "agent_task",
    title: "Handoff 调度器",
    subtitle: `串行+并行调度 ${result.steps.length} 个 Agent`,
    x: controllerPos.x,
    y: controllerPos.y,
    status: "handoff",
    handoffState: getAggregateHandoffState(result.steps),
    revealStage: 99,
  };
  nodes.push(controller);

  // Find steps by agent
  const rumorStep = result.steps.find((s) => s.agent === "rumor_detector");
  const factStep = result.steps.find((s) => s.agent === "fact_checker");
  const sourceStep = result.steps.find((s) => s.agent === "source_validator");
  const reportStep = result.steps.find((s) => s.agent === "report_composer");

  // Compact layout positions for parallel visualization
  // Phase 1: RumorDetector (center)
  // Phase 2: FactChecker (top) + SourceValidator (bottom) — PARALLEL
  // Phase 3: ReportComposer (center)
  const stepPositions: Record<string, { x: number; y: number }> = {};
  if (rumorStep) stepPositions[rumorStep.agent] = findFreePosition(32, 50);
  if (factStep) stepPositions[factStep.agent] = findFreePosition(52, 32);
  if (sourceStep) stepPositions[sourceStep.agent] = findFreePosition(52, 68);
  if (reportStep) stepPositions[reportStep.agent] = findFreePosition(72, 50);

  // Create agent nodes
  const agentNodeMap: Record<string, string> = {};

  result.steps.forEach((step) => {
    const pos = stepPositions[step.agent];
    if (!pos) return;

    const meta = agentTypeMeta[step.agent] || { icon: "🤖" };
    const outputSummary = buildHandoffNodeSubtitle(step);

    const agentNode: CanvasNode = {
      id: `${baseId}-agent-${step.agent}`,
      type: "agent_task",
      title: `${meta.icon} ${step.agentName}`,
      subtitle: outputSummary,
      x: pos.x,
      y: pos.y,
      status: "handoff",
      handoffState: step.status,
      revealStage: 99,
    };
    nodes.push(agentNode);
    agentNodeMap[step.agent] = agentNode.id;
  });

  // Create edges — parallel handoff topology with data-flow animation
  // Controller → RumorDetector
  if (rumorStep && agentNodeMap[rumorStep.agent]) {
    edges.push({
      id: `${baseId}-edge-c-r`,
      from: controller.id,
      to: agentNodeMap[rumorStep.agent],
      label: "claim",
      revealStage: 99,
      animated: true,
      style: "default",
    });
  }

  // RumorDetector → FactChecker + SourceValidator (parallel split)
  if (rumorStep && agentNodeMap[rumorStep.agent]) {
    if (factStep && agentNodeMap[factStep.agent]) {
      edges.push({
        id: `${baseId}-edge-r-f`,
        from: agentNodeMap[rumorStep.agent],
        to: agentNodeMap[factStep.agent],
        label: getHandoffEdgeLabel(rumorStep, factStep),
        revealStage: 99,
        animated: true,
        style: "parallel_split",
      });
    }
    if (sourceStep && agentNodeMap[sourceStep.agent]) {
      edges.push({
        id: `${baseId}-edge-r-s`,
        from: agentNodeMap[rumorStep.agent],
        to: agentNodeMap[sourceStep.agent],
        label: getHandoffEdgeLabel(rumorStep, sourceStep),
        revealStage: 99,
        animated: true,
        style: "parallel_split",
      });
    }
  }

  // FactChecker + SourceValidator → ReportComposer (parallel join)
  if (reportStep && agentNodeMap[reportStep.agent]) {
    if (factStep && agentNodeMap[factStep.agent]) {
      edges.push({
        id: `${baseId}-edge-f-rp`,
        from: agentNodeMap[factStep.agent],
        to: agentNodeMap[reportStep.agent],
        label: getHandoffEdgeLabel(factStep, reportStep),
        revealStage: 99,
        animated: true,
        style: "parallel_join",
      });
    }
    if (sourceStep && agentNodeMap[sourceStep.agent]) {
      edges.push({
        id: `${baseId}-edge-s-rp`,
        from: agentNodeMap[sourceStep.agent],
        to: agentNodeMap[reportStep.agent],
        label: getHandoffEdgeLabel(sourceStep, reportStep),
        revealStage: 99,
        animated: true,
        style: "parallel_join",
      });
    }
  }

  // Final report node
  if (result.finalReport) {
    const reportPos = findFreePosition(88, 50);
    const reportNode: CanvasNode = {
      id: `${baseId}-report`,
      type: "evidence_need",
      title: "📝 核查报告",
      subtitle:
        typeof result.finalReport.conclusion === "string"
          ? result.finalReport.conclusion.slice(0, 60)
          : "综合核查报告已生成",
      x: reportPos.x,
      y: reportPos.y,
      status: "handoff",
      handoffState: "completed",
      revealStage: 99,
    };
    nodes.push(reportNode);
    if (reportStep && agentNodeMap[reportStep.agent]) {
      edges.push({
        id: `${baseId}-edge-rp-final`,
        from: agentNodeMap[reportStep.agent],
        to: reportNode.id,
        label: getHandoffEdgeLabel(reportStep),
        revealStage: 99,
        animated: true,
        style: "default",
      });
    }
  }

  return { nodes, edges };
}

function getAggregateHandoffState(steps: HandoffStep[]): NonNullable<CanvasNode["handoffState"]> {
  if (steps.some((step) => step.status === "running" || step.status === "pending")) return "running";
  if (steps.some((step) => step.status === "failed")) return "failed";
  return "completed";
}

function buildHandoffNodeSubtitle(step: HandoffStep): string {
  const parts = [getHandoffStepSummary(step)];
  const outputKeys = getOutputContextKeys(step).slice(0, 3);

  if (outputKeys.length > 0) parts.push(`输出: ${outputKeys.join(", ")}`);
  if (step.latencyMs > 0) parts.push(`${step.latencyMs}ms`);

  return parts.join(" · ");
}

function getHandoffEdgeLabel(fromStep: HandoffStep, toStep?: HandoffStep): string {
  const preferredKeys = getPreferredContextKeys(fromStep.agent, toStep?.agent);
  const outputKeys = getOutputContextKeys(fromStep, preferredKeys);
  return outputKeys.length > 0 ? outputKeys.slice(0, 2).join(" + ") : "context";
}

function getPreferredContextKeys(fromAgent: string, toAgent?: string): string[] {
  if (fromAgent === "rumor_detector" && toAgent === "fact_checker") {
    return ["rumorIndicators", "severity"];
  }
  if (fromAgent === "rumor_detector" && toAgent === "source_validator") {
    return ["rumorIndicators"];
  }
  if (fromAgent === "fact_checker" && toAgent === "report_composer") {
    return ["factCheckResult", "sources", "confidence"];
  }
  if (fromAgent === "source_validator" && toAgent === "report_composer") {
    return ["sourceReliability", "verifiedSources", "verificationNotes"];
  }
  if (fromAgent === "report_composer") {
    return ["conclusion", "credibilityScore"];
  }
  return [];
}

function getOutputContextKeys(step: HandoffStep, preferredKeys: string[] = []): string[] {
  const hasValue = (key: string) => {
    const value = step.output[key];
    return value != null && (!Array.isArray(value) || value.length > 0);
  };

  const preferred = preferredKeys.filter(hasValue);
  if (preferred.length > 0) return preferred;

  return Object.keys(step.output).filter(hasValue);
}

function getHandoffStepSummary(step: { agent: string; output: Record<string, unknown> }): string {
  switch (step.agent) {
    case "rumor_detector": {
      const severity = step.output.severity;
      const indicators = Array.isArray(step.output.rumorIndicators) ? step.output.rumorIndicators : [];
      return `检测到 ${indicators.length} 个谣言特征 · 严重程度: ${severity}`;
    }
    case "fact_checker": {
      const result = step.output.factCheckResult;
      const confidence = step.output.confidence;
      return `核查结果: ${result} · 置信度: ${confidence}`;
    }
    case "source_validator": {
      const reliability = step.output.sourceReliability;
      const verified = Array.isArray(step.output.verifiedSources) ? step.output.verifiedSources.length : 0;
      return `信源可靠性: ${reliability} · 已验证 ${verified} 个来源`;
    }
    case "report_composer": {
      const score = step.output.credibilityScore;
      const label = step.output.credibilityLabel;
      return `可信度: ${score}/100 · ${label}`;
    }
    default:
      return "Agent 执行完成";
  }
}

function clamp(value: number) {
  return Math.max(8, Math.min(92, value));
}

function stoppedReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    duplicate: "已存在或重复线索",
    budget: "达到本轮预算",
    low_confidence: "可信度不足",
    out_of_scope: "超出当前节点范围",
  };
  return labels[reason] ?? "停止扩展";
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
  rumor_check: {
    agentTitle: "RumorDetector 子 Agent",
    agentSubtitle: "识别谣言特征并给出针对性核查建议",
    resultTitle: "谣言特征核查",
    resultSubtitle: "识别到的谣言特征和核查建议",
    resultStatus: "risk",
  },
};
