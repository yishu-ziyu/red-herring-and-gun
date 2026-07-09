import { randomUUID } from "node:crypto";
import { AGENT_CONFIGS, buildAgentInput } from "../agentConfigs";
import type { AgentContract } from "../agentConfigs";
import type { Search360Response } from "../schemas";
import {
  createAgentCompleteEvent,
  createAgentErrorEvent,
  createAgentStartEvent,
  createToolErrorEvent,
  createToolResultEvent,
  createToolStartEvent,
} from "./events";
import { callAgentWithFallback, type AgentReasoningEffort } from "./agentProviders";
import { buildConfidenceAssessments } from "../confidenceEngine";
import { buildMemoryCandidatesFromRun } from "./memoryCandidateGenerator";
import { JsonlMemoryCandidateStore, type MemoryCandidateStore } from "./memoryCandidateStore";
import type { MemoryCandidate, MemoryCandidateHit } from "./memoryCandidateTypes";
import { buildMemoryCase, JsonlAgentMemoryStore, type AgentMemoryStore } from "./memoryStore";
import {
  buildCaseIntakeMetadata,
  compactSearchResultForAgent,
  composeClaimWithVision,
  getSearchToolName,
  summarizeSearchResultForStream,
  type CaseIntakePayload,
} from "./orchestrateShared";
import type { AgentRuntimeEvent, FollowUpTask, SteeringMessage } from "./types";
import { getTraceCollector } from "../reasoningTrace";
import type {
  ConsensusDebateUpdate,
  ExecutionDagClaimType,
  ExecutionDagPlan,
  SpeculativeRelayUpdate,
} from "../agentOrchestrationTypes";

export interface RuntimeStep {
  agent: string;
  agentName: string;
  agentIcon: string;
  agentContract?: AgentContract;
  systemPrompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  evidenceBundle: ReturnType<typeof buildAgentEvidenceBundle>;
  model: string;
  latencyMs: number;
  timestamp: number;
  status: "completed" | "failed";
}

export interface AgentRuntimeRunInput {
  claim: string;
  intake?: CaseIntakePayload | null;
  steeringQueue?: SteeringMessage[];
  followUpQueue?: FollowUpTask[];
}

export interface AgentRuntimeRunResult {
  claim: string;
  sessionId: string;
  steps: RuntimeStep[];
  finalReport: Record<string, unknown>;
  followUpQueue: FollowUpTask[];
  memoryCandidates: MemoryCandidate[];
  totalLatencyMs: number;
}

export interface AgentRuntimeDependencies {
  env: Record<string, string>;
  codexBin: string;
  getSearchForClaim: (claim: string) => Promise<Search360Response>;
  getAgentTimeoutMs: (agentId: string) => number;
  getAgentReasoningEffort: (agentId: string) => AgentReasoningEffort;
  callVisionForIntake?: (args: {
    env: Record<string, string>;
    claim: string;
    intake: CaseIntakePayload;
  }) => Promise<{ model: string; output: Record<string, unknown> }>;
  memoryStore?: AgentMemoryStore;
  memoryCandidateStore?: MemoryCandidateStore;
  log?: (event: string, detail: Record<string, unknown>) => void;
  logError?: (event: string, detail: Record<string, unknown>) => void;
}

export class AgentRuntime {
  private readonly memoryStore: AgentMemoryStore;
  private readonly memoryCandidateStore: MemoryCandidateStore;

  constructor(private readonly deps: AgentRuntimeDependencies) {
    this.memoryStore = deps.memoryStore ?? new JsonlAgentMemoryStore();
    this.memoryCandidateStore = deps.memoryCandidateStore ?? new JsonlMemoryCandidateStore();
  }

  async runCase(input: AgentRuntimeRunInput, onEvent?: (event: AgentRuntimeEvent) => void): Promise<AgentRuntimeRunResult> {
    const sessionId = randomUUID();
    const startTime = Date.now();
    const intake = input.intake ?? null;
    const intakeMetadata = buildCaseIntakeMetadata(intake);
    const steeringQueue = input.steeringQueue ?? [];
    const followUpQueue = [...(input.followUpQueue ?? [])];
    const steps: RuntimeStep[] = [];
    let claim = input.claim;
    let visualExtraction: Record<string, unknown> | undefined;
    let searchResult: Search360Response | undefined;
    const executionPlan = buildAdaptiveExecutionPlan(claim, intakeMetadata);

    onEvent?.({
      type: "planner_update",
      phase: "handoff",
      timestamp: Date.now(),
      claim,
      plan: executionPlan,
    });
    const trace = getTraceCollector();
    trace.setSessionId(sessionId);
    trace.emit({
      agent: "runtime",
      action: "planner_update",
      status: "completed",
      timestamp: Date.now(),
      meta: { claimType: executionPlan.claimType },
    });

    onEvent?.(createToolStartEvent({
      toolId: "memory_search",
      toolName: "Agent Memory Search",
      query: claim,
      phase: "memory_recall",
    }));
    const memoryHits = await this.memoryStore.search(claim, 5);
    const acceptedCandidateHits = await this.memoryCandidateStore.searchAccepted(claim, 6);
    onEvent?.(createToolResultEvent({
      toolId: "memory_search",
      toolName: "Agent Memory Search",
      query: claim,
      phase: "memory_recall",
      result: {
        hitCount: memoryHits.length,
        acceptedCandidateCount: acceptedCandidateHits.length,
        hits: memoryHits.map((hit) => ({
          id: hit.case.id,
          claim: hit.case.claim,
          score: hit.score,
          matchedTerms: hit.matchedTerms,
          sourceUrls: hit.case.sourceUrls.slice(0, 5),
        })),
        acceptedCandidates: acceptedCandidateHits.map((hit) => ({
          id: hit.candidate.id,
          kind: hit.candidate.kind,
          title: hit.candidate.title,
          score: Number(hit.score.toFixed(3)),
          matchedTerms: hit.matchedTerms,
        })),
      },
    }));

    if (intake?.images.length) {
      if (!this.deps.callVisionForIntake) {
        throw new Error("当前运行时没有配置视觉模型，无法处理图片材料。");
      }
      onEvent?.(createToolStartEvent({
        toolId: "stepfun_vision",
        toolName: "StepFun Vision",
        query: "图片材料解析",
      }));
      try {
        const visionResult = await this.deps.callVisionForIntake({ env: this.deps.env, claim, intake });
        visualExtraction = visionResult.output;
        claim = composeClaimWithVision(claim, intake, visualExtraction);
        onEvent?.(createToolResultEvent({
          toolId: "stepfun_vision",
          toolName: "StepFun Vision",
          query: "图片材料解析",
          model: visionResult.model,
          result: {
            _source: "stepfun-vision",
            ...visualExtraction,
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片材料解析失败";
        onEvent?.(createToolErrorEvent({
          toolId: "stepfun_vision",
          toolName: "StepFun Vision",
          query: "图片材料解析",
          error: message,
        }));
        throw error;
      }
    }

    let factStep: RuntimeStep;
    let sourceStep: RuntimeStep;
    let debate: ConsensusDebateUpdate;

    if (executionPlan.claimType === "concept") {
      ({ factStep, sourceStep, searchResult, debate } =
        await this.runConceptPipeline({ claim, steps, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent }));
    } else {
      ({ factStep, sourceStep, searchResult, debate } =
        await this.runStandardPipeline({ claim, steps, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent }));
    }

    const reportStep = await this.runAgent({
      agentId: "report_composer",
      claim,
      steps,
      searchResult,
      intakeMetadata,
      visualExtraction,
      memoryHits,
      acceptedCandidateHits,
      steeringQueue,
      onEvent,
    });
    const finalReport = applyRuleBasedConfidence(reportStep.output, steps);
    reportStep.output = finalReport;
    steps.push(reportStep);
    followUpQueue.push(...buildFollowUpsFromRun(steps, searchResult));

    onEvent?.(createToolStartEvent({
      toolId: "memory_write",
      toolName: "Agent Memory Write",
      query: claim,
      phase: "memory_write",
    }));
    const memoryCase = buildMemoryCase({
      id: sessionId,
      claim,
      steps,
      finalReport,
      searchResult,
    });
    await this.memoryStore.write(memoryCase);
    const memoryCandidates = buildMemoryCandidatesFromRun({
      runId: sessionId,
      claim,
      steps,
      finalReport,
      searchResult,
    });
    await this.memoryCandidateStore.propose(memoryCandidates);
    onEvent?.(createToolResultEvent({
      toolId: "memory_write",
      toolName: "Agent Memory Write",
      query: claim,
      phase: "memory_write",
      result: {
        id: memoryCase.id,
        sourceUrlCount: memoryCase.sourceUrls.length,
        unresolvedQuestionCount: memoryCase.unresolvedQuestions.length,
        proposedCandidateCount: memoryCandidates.length,
      },
    }));

    return {
      claim,
      sessionId,
      steps,
      finalReport,
      followUpQueue,
      memoryCandidates,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  private async runAgent({
    agentId,
    claim,
    steps,
    searchResult,
    intakeMetadata,
    visualExtraction,
    memoryHits,
    acceptedCandidateHits,
    steeringQueue,
    onEvent,
  }: {
    agentId: string;
    claim: string;
    steps: RuntimeStep[];
    searchResult?: Search360Response;
    intakeMetadata?: ReturnType<typeof buildCaseIntakeMetadata>;
    visualExtraction?: Record<string, unknown>;
    memoryHits: Awaited<ReturnType<AgentMemoryStore["search"]>>;
    acceptedCandidateHits: MemoryCandidateHit[];
    steeringQueue: SteeringMessage[];
    onEvent?: (event: AgentRuntimeEvent) => void;
  }): Promise<RuntimeStep> {
    const agentConfig = AGENT_CONFIGS.find((agent) => agent.id === agentId);
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);
    const trace = getTraceCollector();

    onEvent?.(createAgentStartEvent({
      agent: agentId,
      agentName: agentConfig.name,
      agentIcon: agentConfig.icon,
      agentContract: agentConfig.contract,
      model: "",
    }));

    const stepStart = Date.now();
    const agentInput = buildAgentInput(agentId, claim, steps);
    trace.emit({
      agent: agentConfig.id,
      action: `${agentConfig.name} started`,
      status: "running",
      timestamp: stepStart,
    });
    if (intakeMetadata) agentInput.intake = intakeMetadata;
    if (visualExtraction) agentInput.visualExtraction = visualExtraction;
    if (memoryHits.length > 0 && agentId !== "report_composer") {
      const memoryLimit = agentId === "fact_checker" || agentId === "source_validator" ? 1 : 3;
      agentInput.memoryRecall = memoryHits.slice(0, memoryLimit).map((hit) => {
        const base = {
          claim: hit.case.claim,
          score: Number(hit.score.toFixed(3)),
          matchedTerms: hit.matchedTerms.slice(0, agentId === "fact_checker" || agentId === "source_validator" ? 6 : 12),
        };
        if (agentId === "fact_checker") return base;
        if (agentId === "source_validator") {
          return {
            ...base,
            sourceUrls: hit.case.sourceUrls.slice(0, 2),
          };
        }
        if (agentId === "report_composer") {
          return {
            ...base,
            finalReport: compactMemoryReport(hit.case.finalReport),
          };
        }
        return {
          ...base,
          finalReport: compactMemoryReport(hit.case.finalReport),
          sourceUrls: hit.case.sourceUrls.slice(0, 3),
        };
      });
    }
    if (acceptedCandidateHits.length > 0) {
      agentInput.acceptedMemoryCandidates = projectAcceptedMemoryForAgent(agentId, acceptedCandidateHits);
    }
    if (steeringQueue.length > 0) {
      agentInput.steering = steeringQueue
        .filter((item) => !item.consumedAt)
        .map((item) => ({ id: item.id, content: item.content, createdAt: item.createdAt }));
    }
    if (searchResult && ["fact_checker", "source_validator", "report_composer"].includes(agentId)) {
      const sourceLimit = agentId === "fact_checker" ? 2 : agentId === "source_validator" ? 2 : 6;
      const compacted = compactSearchResultForAgent(searchResult, sourceLimit);
      const answerLimit = agentId === "report_composer" ? 850 : agentId === "fact_checker" ? 320 : 260;
      const traceLimit = agentId === "report_composer" ? 300 : agentId === "fact_checker" ? 160 : 180;
      if (compacted && typeof compacted.answer === "string" && compacted.answer.length > answerLimit) {
        compacted.answer = `${compacted.answer.slice(0, answerLimit)}…`;
      }
      if (compacted && typeof compacted.traceText === "string" && compacted.traceText.length > traceLimit) {
        compacted.traceText = `${compacted.traceText.slice(0, traceLimit)}…`;
      }
      if (compacted && agentId === "fact_checker") {
        compactSourceSnippets(compacted, 160);
      }
      if (compacted && agentId === "source_validator") {
        compactSourceSnippets(compacted, 120);
      }
      agentInput.search360 = compacted;
    }

    let output: Record<string, unknown>;
    let modelUsed: string;
    const timeoutMs = this.deps.getAgentTimeoutMs(agentId);
    const reasoningEffort = this.deps.getAgentReasoningEffort(agentId);
    const userContent = JSON.stringify(agentInput, null, 2);

    try {
      this.deps.log?.("agent_start", {
        agent: agentId,
        agentName: agentConfig.name,
        inputBytes: new TextEncoder().encode(userContent).length,
        timeoutMs,
        reasoningEffort,
      });
      const result = await withRuntimeTimeout(
        callAgentWithFallback({
          systemPrompt: agentConfig.systemPrompt,
          userContent,
          responseSchema: agentConfig.responseSchema,
          maxTokens: agentConfig.maxTokens,
          env: this.deps.env,
          codexBin: this.deps.codexBin,
          reasoningEffort,
          traceLabel: agentConfig.name,
          deadlineAt: stepStart + timeoutMs,
        }),
        timeoutMs,
        `${agentConfig.name} Agent`
      );
      output = result.output;
      modelUsed = result.model;
      this.deps.log?.("agent_complete", {
        agent: agentId,
        agentName: agentConfig.name,
        model: modelUsed,
        latencyMs: Date.now() - stepStart,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Agent 调用失败";
      this.deps.logError?.("agent_error", {
        agent: agentId,
        agentName: agentConfig.name,
        latencyMs: Date.now() - stepStart,
        timeoutMs,
        reasoningEffort,
        message: msg,
      });
      onEvent?.(createAgentErrorEvent({
        agent: agentId,
        agentName: agentConfig.name,
        agentIcon: agentConfig.icon,
        agentContract: agentConfig.contract,
        error: `${agentConfig.name} 真实模型调用失败：${msg}`,
      }));
      if (!canContinueAfterAgentFailure(agentId)) {
        throw new Error(`${agentConfig.name} 真实模型调用失败：${msg}`);
      }
      output = buildAgentFailureOutput(agentId, msg, searchResult);
      modelUsed = "runtime:error-boundary";
    }

    const step: RuntimeStep = {
      agent: agentConfig.id,
      agentName: agentConfig.name,
      agentIcon: agentConfig.icon,
      agentContract: agentConfig.contract,
      systemPrompt: agentConfig.systemPrompt,
      input: agentInput,
      output,
      evidenceBundle: buildAgentEvidenceBundle(agentConfig.id, output, searchResult),
      model: modelUsed,
      latencyMs: Date.now() - stepStart,
      timestamp: Date.now(),
      // 审查 P2-7 修复：catch 路径走 error-boundary，应标记为 failed 而非 completed
      status: modelUsed === "runtime:error-boundary" ? "failed" : "completed",
    };

    onEvent?.(createAgentCompleteEvent({
      agent: agentId,
      agentName: agentConfig.name,
      agentIcon: agentConfig.icon,
      agentContract: agentConfig.contract,
      output,
      result: { evidenceBundle: step.evidenceBundle },
      evidenceBundle: step.evidenceBundle,
      model: modelUsed,
      latencyMs: step.latencyMs,
    }));
    trace.emit({
      agent: agentConfig.id,
      action: `${agentConfig.name} completed`,
      status: step.status === "completed" ? "completed" : "failed",
      timestamp: Date.now(),
      latencyMs: step.latencyMs,
      meta: step.status !== "completed" ? { code: "agent_failure", message: modelUsed } : undefined,
    });

    return step;
  }

  private async runStandardPipeline(args: {
    claim: string;
    steps: RuntimeStep[];
    intakeMetadata?: ReturnType<typeof buildCaseIntakeMetadata>;
    visualExtraction?: Record<string, unknown>;
    memoryHits: Awaited<ReturnType<AgentMemoryStore["search"]>>;
    acceptedCandidateHits: MemoryCandidateHit[];
    steeringQueue: SteeringMessage[];
    onEvent?: (event: AgentRuntimeEvent) => void;
  }): Promise<{ factStep: RuntimeStep; sourceStep: RuntimeStep; searchResult: Search360Response; debate: ConsensusDebateUpdate }> {
    const { claim, steps, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent } = args;

    emitSpeculativeRelay(onEvent, {
      id: "relay-rumor-to-search",
      title: "先派发可行动线索",
      upstream: "Planner",
      downstream: "RumorDetector",
      trigger: "中控已经判定命题类型，先让分诊 Agent 提取可检索子问题。",
      status: "running",
      savedReason: "不用等最终报告，先把可验证问题拆出来。",
      confidence: "medium",
    });

    steps.push(await this.runAgent({ agentId: "rumor_detector", claim, steps, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent }));

    emitSpeculativeRelay(onEvent, {
      id: "relay-search-seeds",
      title: "搜索提前接力",
      upstream: "RumorDetector",
      downstream: "360 AI Search",
      trigger: firstActionableClaimSeed(steps[0]?.output, claim),
      status: "running",
      savedReason: "一旦分诊产出可检索线索，搜索与后续 Agent 准备可以重叠执行。",
      confidence: "high",
    });

    onEvent?.(createToolStartEvent({ toolId: "parallel_search", toolName: "Parallel Search", query: claim }));
    const searchResult = await this.deps.getSearchForClaim(claim);
    const searchToolName = getSearchToolName(searchResult);
    if (searchResult._source === "tool-error") {
      onEvent?.(createToolErrorEvent({ toolId: "parallel_search", toolName: searchToolName, query: claim, error: searchResult.traceText ?? "搜索工具未返回真实结果。", result: summarizeSearchResultForStream(searchResult) }));
    } else {
      onEvent?.(createToolResultEvent({ toolId: "parallel_search", toolName: searchToolName, query: claim, model: searchResult.model, result: summarizeSearchResultForStream(searchResult) }));
    }

    emitSpeculativeRelay(onEvent, {
      id: "relay-search-to-agents",
      title: "证据池进入并行 Agent",
      upstream: searchToolName,
      downstream: "FactChecker + SourceValidator",
      trigger: summarizeSearchResultForStream(searchResult)?.answerPreview || "搜索返回来源、支持侧与反驳侧线索。",
      status: "completed",
      savedReason: "事实核查和信源审计可以并行消费同一份证据池。",
      confidence: searchResult._source === "tool-error" ? "low" : "medium",
    });

    const [factStep, sourceStep] = await Promise.all([
      this.runAgent({ agentId: "fact_checker", claim, steps, searchResult, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent }),
      this.runAgent({ agentId: "source_validator", claim, steps, searchResult, intakeMetadata, visualExtraction, memoryHits, acceptedCandidateHits, steeringQueue, onEvent }),
    ]);
    steps.push(factStep, sourceStep);

    const debate = buildConsensusDebate(factStep, sourceStep, searchResult);
    if (debate.status !== "not_needed") {
      onEvent?.({ type: "consensus_debate_round", phase: "handoff", timestamp: Date.now(), debate: { ...debate, status: "running" } });
    }
    onEvent?.({ type: "consensus_debate_final", phase: "handoff", timestamp: Date.now(), debate });

    return { factStep, sourceStep, searchResult, debate };
  }

  private async runConceptPipeline(_args: {
    claim: string;
    steps: RuntimeStep[];
    intakeMetadata?: ReturnType<typeof buildCaseIntakeMetadata>;
    visualExtraction?: Record<string, unknown>;
    memoryHits: Awaited<ReturnType<AgentMemoryStore["search"]>>;
    acceptedCandidateHits: MemoryCandidateHit[];
    steeringQueue: SteeringMessage[];
    onEvent?: (event: AgentRuntimeEvent) => void;
  }): Promise<{ factStep: RuntimeStep; sourceStep: RuntimeStep; searchResult: Search360Response | undefined; debate: ConsensusDebateUpdate }> {
    const { onEvent } = _args;

    onEvent?.({
      type: "speculative_update",
      phase: "handoff",
      timestamp: Date.now(),
      relay: {
        id: "relay-concept-skip-search",
        title: "概念解释任务跳过事实搜证",
        upstream: "Planner",
        downstream: "ReportComposer",
        trigger: "命题被判定为概念解释，直接进入语义分析和语境映射。",
        status: "completed",
        savedReason: "概念类问题不需要事实核查，避免把语义边界混淆当作事实争议。",
        confidence: "medium",
      },
    });

    onEvent?.({
      type: "consensus_debate_final",
      phase: "handoff",
      timestamp: Date.now(),
      debate: {
        id: `debate-${Date.now()}`,
        status: "not_needed",
        title: "概念解释任务跳过事实核查与信源审计",
        conflictCount: 0,
        rounds: [],
        finalConsensus: "概念解释任务不进入事实核查流水线，ReportComposer 直接按语义边界和语境映射生成结论。",
        confidenceAdjustment: 0,
      },
    });

    return {
      factStep: { agent: "fact_checker", agentName: "FactChecker (skipped)", agentIcon: "", systemPrompt: "", input: {}, output: {}, evidenceBundle: buildAgentEvidenceBundle("fact_checker", {}), model: "runtime:skipped", latencyMs: 0, timestamp: Date.now(), status: "completed" },
      sourceStep: { agent: "source_validator", agentName: "SourceValidator (skipped)", agentIcon: "", systemPrompt: "", input: {}, output: {}, evidenceBundle: buildAgentEvidenceBundle("source_validator", {}), model: "runtime:skipped", latencyMs: 0, timestamp: Date.now(), status: "completed" },
      searchResult: undefined,
      debate: { id: `debate-${Date.now()}`, status: "not_needed", title: "", conflictCount: 0, rounds: [], finalConsensus: "", confidenceAdjustment: 0 },
    };
  }
}

function buildAdaptiveExecutionPlan(claim: string, intakeMetadata?: ReturnType<typeof buildCaseIntakeMetadata>): ExecutionDagPlan {
  const claimType = detectClaimType(claim);
  const hasAttachment = Boolean((intakeMetadata?.links.length ?? 0) + (intakeMetadata?.images.length ?? 0));
  const baseNodes = [
    {
      id: "planner",
      label: "Planner",
      layer: "planner" as const,
      status: "completed" as const,
      description: hasAttachment ? "读取用户输入和附件，先判断案件形态。" : "读取用户输入，先判断案件形态。",
    },
  ];

  if (claimType === "concept") {
    const nodes = [
      ...baseNodes,
      {
        id: "concept_extractor",
        label: "ConceptExtractor",
        layer: "analysis" as const,
        status: "planned" as const,
        description: "抽取概念边界、语境和可能误读。",
      },
      {
        id: "semantic_validator",
        label: "SemanticValidator",
        layer: "audit" as const,
        status: "planned" as const,
        description: "检查定义是否被偷换、误用或过度泛化。",
      },
      {
        id: "context_mapper",
        label: "ContextMapper",
        layer: "analysis" as const,
        status: "planned" as const,
        description: "把概念放回政策、学术或传播语境中解释。",
      },
      reportNode(),
    ];
    return {
      id: `dag-${Date.now()}`,
      claimType,
      rationale: "该输入更像概念解释任务，优先做语义边界和语境映射，不强行进入事实搜证流水线。",
      nodes,
      edges: [
        { from: "planner", to: "concept_extractor", label: "概念拆解" },
        { from: "concept_extractor", to: "semantic_validator", label: "语义校验" },
        { from: "semantic_validator", to: "context_mapper", label: "放回语境" },
        { from: "context_mapper", to: "report_composer", label: "收束表达" },
      ],
      criticalPath: nodes.map((node) => node.id),
    };
  }

  const causalNodes = claimType === "causal"
    ? [
        {
          id: "alternative_explanation_searcher",
          label: "AlternativeExplanationSearcher",
          layer: "search" as const,
          status: "planned" as const,
          description: "专门寻找替代解释，避免把相关性误写成因果。",
        },
        {
          id: "counter_evidence_grader",
          label: "CounterEvidenceGrader",
          layer: "audit" as const,
          status: "planned" as const,
          description: "对反证和证据缺口做降权评分。",
        },
      ]
    : [];

  const nodes = [
    ...baseNodes,
    {
      id: "rumor_detector",
      label: "RumorDetector",
      agent: "rumor_detector",
      layer: "analysis" as const,
      status: "planned" as const,
      description: "识别高风险断言，并拆成可核查子问题。",
    },
    {
      id: "fact_checker",
      label: "FactChecker",
      agent: "fact_checker",
      layer: "search" as const,
      status: "planned" as const,
      description: "执行支持/反驳双向核查。",
    },
    {
      id: "source_validator",
      label: "SourceValidator",
      agent: "source_validator",
      layer: "audit" as const,
      status: "planned" as const,
      description: "审计来源层级、转载链和证据可用性。",
    },
    ...causalNodes,
    {
      id: "consensus_debate",
      label: "ConsensusDebate",
      layer: "debate" as const,
      status: "planned" as const,
      description: "当事实判断和信源评价冲突时，插入短轮调解。",
    },
    reportNode(),
  ];

  return {
    id: `dag-${Date.now()}`,
    claimType,
    rationale: claimType === "causal"
      ? "该输入包含因果或强归因断言，需要额外加入替代解释和反证评分。"
      : "该输入需要事实核查、来源审计和证据边界收束。",
    nodes,
    edges: [
      { from: "planner", to: "rumor_detector", label: "立案" },
      { from: "rumor_detector", to: "fact_checker", label: "支持/反驳线索" },
      { from: "rumor_detector", to: "source_validator", label: "来源需求" },
      ...(claimType === "causal"
        ? [
            { from: "fact_checker", to: "alternative_explanation_searcher", label: "替代解释" },
            { from: "fact_checker", to: "counter_evidence_grader", label: "反证评分" },
            { from: "alternative_explanation_searcher", to: "consensus_debate", label: "冲突输入" },
            { from: "counter_evidence_grader", to: "consensus_debate", label: "降权输入" },
          ]
        : []),
      { from: "fact_checker", to: "consensus_debate", label: "事实强度" },
      { from: "source_validator", to: "consensus_debate", label: "信源约束" },
      { from: "consensus_debate", to: "report_composer", label: "共识收束" },
    ],
    criticalPath: nodes.map((node) => node.id),
  };
}

function reportNode() {
  return {
    id: "report_composer",
    label: "ReportComposer",
    agent: "report_composer",
    layer: "report" as const,
    status: "planned" as const,
    description: "只根据证据许可生成最终表达。",
  };
}

function detectClaimType(claim: string): ExecutionDagClaimType {
  if (/(什么是|定义|概念|如何理解|是什么意思)/.test(claim)) return "concept";
  if (/(导致|造成|引发|因为|由于|归因|致癌|会让|使得|影响)/.test(claim)) return "causal";
  if (/(网传|称|据说|爆料|发生|发布|宣布|报道)/.test(claim)) return "event";
  return "mixed";
}

function emitSpeculativeRelay(onEvent: ((event: AgentRuntimeEvent) => void) | undefined, relay: SpeculativeRelayUpdate) {
  onEvent?.({
    type: "speculative_update",
    phase: "handoff",
    timestamp: Date.now(),
    relay,
  });
}

function firstActionableClaimSeed(output: Record<string, unknown> | undefined, fallback: string) {
  const atoms = Array.isArray(output?.claimAtoms) ? output.claimAtoms : [];
  const firstAtom = atoms.find((atom) => typeof atom === "string" || (atom && typeof atom === "object"));
  if (typeof firstAtom === "string" && firstAtom.trim()) return firstAtom.trim();
  if (firstAtom && typeof firstAtom === "object") {
    const value = firstAtom as Record<string, unknown>;
    if (typeof value.text === "string" && value.text.trim()) return value.text.trim();
    if (typeof value.claim === "string" && value.claim.trim()) return value.claim.trim();
  }
  return fallback;
}

function buildConsensusDebate(
  factStep: RuntimeStep,
  sourceStep: RuntimeStep,
  searchResult?: Search360Response
): ConsensusDebateUpdate {
  const factCounterEvidence = stringItems(factStep.output.counterEvidence);
  const contradictingSources = stringItems(factStep.output.contradictingSources);
  const questionableSources = stringItems(sourceStep.output.questionableSources);
  const missingSources = stringItems(sourceStep.output.missingSources);
  const searchGaps = Array.isArray(searchResult?.unresolvedEvidenceGaps)
    ? searchResult.unresolvedEvidenceGaps.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const conflicts = [
    ...factCounterEvidence,
    ...contradictingSources,
    ...questionableSources,
    ...missingSources,
    ...searchGaps,
  ];

  if (conflicts.length === 0) {
    return {
      id: `debate-${Date.now()}`,
      status: "not_needed",
      title: "未发现需要调解的 Agent 冲突",
      conflictCount: 0,
      rounds: [],
      finalConsensus: "FactChecker 与 SourceValidator 没有返回显著冲突，ReportComposer 可以直接按证据边界收束。",
      confidenceAdjustment: 0,
    };
  }

  const challenge = questionableSources[0] || missingSources[0] || "信源层提示：部分材料只能支持局部事实，不能直接推出强结论。";
  const response = factCounterEvidence[0] || contradictingSources[0] || "事实层已记录反证或未解决缺口，需要降低结论强度。";

  return {
    id: `debate-${Date.now()}`,
    status: "resolved",
    title: "Agent 冲突调解室",
    conflictCount: conflicts.length,
    rounds: [
      {
        challenger: "SourceValidator",
        respondent: "FactChecker",
        challenge,
        response,
      },
    ],
    finalConsensus: "进入收束前，将高风险断言降级为证据允许的谨慎表达，并把缺失来源保留为后续追查问题。",
    confidenceAdjustment: Math.max(-18, -4 * Math.min(conflicts.length, 4)),
  };
}

function stringItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function compactMemoryReport(report: unknown) {
  if (!report || typeof report !== "object") return report;
  const value = report as Record<string, unknown>;
  return {
    verdictType: typeof value.verdictType === "string" ? value.verdictType : undefined,
    conclusion: typeof value.conclusion === "string" ? value.conclusion.slice(0, 360) : undefined,
    credibilityLabel: typeof value.credibilityLabel === "string" ? value.credibilityLabel : undefined,
    summaryForPublic: typeof value.summaryForPublic === "string" ? value.summaryForPublic.slice(0, 360) : undefined,
    causalBoundary: typeof value.causalBoundary === "string" ? value.causalBoundary.slice(0, 260) : undefined,
  };
}

function projectAcceptedMemoryForAgent(agentId: string, hits: MemoryCandidateHit[]) {
  const limit = agentId === "fact_checker" || agentId === "source_validator" ? 4 : 6;
  return hits.slice(0, limit).map((hit) => {
    const candidate = hit.candidate;
    const base = {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      confidence: candidate.confidence,
      score: Number(hit.score.toFixed(3)),
      matchedTerms: hit.matchedTerms.slice(0, 8),
      tags: candidate.tags.slice(0, 6),
    };
    if (agentId === "source_validator" && candidate.kind === "source_reputation") {
      return {
        ...base,
        payload: candidate.payload,
      };
    }
    if (agentId === "fact_checker" && ["search_strategy", "recursive_path", "reasoning_pattern"].includes(candidate.kind)) {
      return {
        ...base,
        payload: candidate.payload,
      };
    }
    if (agentId === "report_composer") {
      return {
        ...base,
        provenance: {
          claim: candidate.provenance.claim,
          sourceUrls: candidate.provenance.sourceUrls.slice(0, 3),
        },
      };
    }
    return base;
  });
}

function compactSourceSnippets(searchResult: Search360Response, maxLength: number) {
  const shorten = (source: { snippet?: string }) => {
    if (typeof source.snippet === "string" && source.snippet.length > maxLength) {
      source.snippet = `${source.snippet.slice(0, maxLength)}…`;
    }
  };
  searchResult.sources?.forEach(shorten);
  searchResult.supportingEvidence?.forEach(shorten);
  searchResult.contradictingEvidence?.forEach(shorten);
}

function canContinueAfterAgentFailure(agentId: string) {
  return agentId === "fact_checker" || agentId === "source_validator";
}

function buildAgentFailureOutput(agentId: string, message: string, searchResult?: Search360Response): Record<string, unknown> {
  const sourceUrls = (searchResult?.sources ?? [])
    .map((source: any) => source?.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .slice(0, 6);
  const boundary = `该 Agent 的真实模型调用失败：${message}`;

  if (agentId === "fact_checker") {
    return {
      factCheckResult: "unverified",
      confidence: "low",
      sources: sourceUrls,
      supportingEvidence: [],
      contradictingSources: [],
      keyFindings: [],
      counterEvidence: [],
      unresolvedEvidenceGaps: [
        "FactChecker 未能完成结构化核查，不能据此给出真假判断。",
        "需要依赖搜索证据、信源审计或后续人工复核补齐事实判断。",
      ],
      logicRisks: [boundary],
    };
  }

  if (agentId === "source_validator") {
    return {
      sourceReliability: "unverified",
      verifiedSources: [],
      questionableSources: [],
      missingSources: ["SourceValidator 未能完成信源结构化审计。"],
      verificationNotes: boundary,
    };
  }

  return {
    errorBoundary: boundary,
  };
}

async function withRuntimeTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildAgentEvidenceBundle(agentId: string, output: Record<string, unknown>, searchResult?: Search360Response) {
  const supportSources = Array.isArray(searchResult?.supportingEvidence) ? searchResult.supportingEvidence : [];
  const contradictSources = Array.isArray(searchResult?.contradictingEvidence) ? searchResult.contradictingEvidence : [];
  const unresolvedQuestions = [
    ...(Array.isArray(searchResult?.unresolvedEvidenceGaps) ? searchResult.unresolvedEvidenceGaps : []),
    ...(Array.isArray(output.unresolvedEvidenceGaps) ? output.unresolvedEvidenceGaps.filter((item): item is string => typeof item === "string") : []),
    ...(Array.isArray(output.missingSources) ? output.missingSources.filter((item): item is string => typeof item === "string") : []),
  ];
  const sourceScores = [...supportSources, ...contradictSources]
    .map((source: any) => typeof source?.credibilityScore === "number" ? source.credibilityScore : null)
    .filter((score: number | null): score is number => score !== null);
  const logicRiskCount =
    (Array.isArray(output.logicRisks) ? output.logicRisks.length : 0) +
    (Array.isArray(output.biasWarnings) ? output.biasWarnings.length : 0) +
    (Array.isArray(output.cannotInfer) ? output.cannotInfer.length : 0) +
    (Array.isArray(output.doNotInfer) ? output.doNotInfer.length : 0);

  return {
    agentId,
    claimIds: ["claim-root"],
    supportEvidenceIds: supportSources.map((source: any, index: number) => String(source?.id || source?.url || source?.title || `support-${index + 1}`)),
    contradictEvidenceIds: contradictSources.map((source: any, index: number) => String(source?.id || source?.url || source?.title || `contradict-${index + 1}`)),
    confidenceDelta: Math.max(-30, Math.min(20, supportSources.length * 3 - contradictSources.length * 5 - unresolvedQuestions.length * 2 - logicRiskCount * 4)),
    unresolvedQuestions: Array.from(new Set(unresolvedQuestions)).slice(0, 6),
    sourceQualityScore: sourceScores.length > 0
      ? Math.round(sourceScores.reduce((sum: number, score: number) => sum + score, 0) / sourceScores.length)
      : undefined,
    logicRiskCount,
  };
}

function applyRuleBasedConfidence(output: Record<string, unknown>, steps: RuntimeStep[]) {
  const credibilityScore =
    typeof output.credibilityScore === "number" && Number.isFinite(output.credibilityScore)
      ? output.credibilityScore
      : 50;

  return {
    ...output,
    confidenceDimensions: buildConfidenceAssessments(credibilityScore, steps, output as any),
  };
}

function buildFollowUpsFromRun(steps: RuntimeStep[], searchResult?: Search360Response): FollowUpTask[] {
  const unresolved = new Set<string>();
  for (const item of searchResult?.unresolvedEvidenceGaps ?? []) {
    if (typeof item === "string" && item) unresolved.add(item);
  }
  for (const step of steps) {
    for (const item of step.evidenceBundle.unresolvedQuestions ?? []) {
      if (typeof item === "string" && item) unresolved.add(item);
    }
  }

  return Array.from(unresolved).slice(0, 4).map((reason, index) => ({
    id: `follow-up-${Date.now()}-${index + 1}`,
    title: index === 0 ? "继续补足关键证据" : "追查未解决证据缺口",
    reason,
    status: "pending",
    createdAt: Date.now(),
  }));
}
