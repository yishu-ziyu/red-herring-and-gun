import { describe, expect, it, beforeEach, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime";
import type { AgentRuntimeDependencies } from "./AgentRuntime";
import { getTraceCollector, resetTraceCollector } from "../reasoningTrace";

const mockCallAgent = vi.fn();

function makeDeps(overrides: Partial<AgentRuntimeDependencies> = {}): AgentRuntimeDependencies {
  return {
    env: {},
    codexBin: "echo",
    getSearchForClaim: vi.fn().mockResolvedValue({
      _source: "tool-ok",
      model: "mock",
      answer: "test answer",
      sources: [],
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: [],
      traceText: "",
    }),
    getAgentTimeoutMs: () => 5000,
    getAgentReasoningEffort: () => "medium",
    callAgentWithFallback: mockCallAgent as AgentRuntimeDependencies["callAgentWithFallback"],
    ...overrides,
  };
}

describe("AgentRuntime — DAG migration pipelines", () => {
  beforeEach(() => {
    resetTraceCollector();
    vi.clearAllMocks();
    mockCallAgent.mockResolvedValue({
      output: { factCheckResult: "true", confidence: "high" },
      model: "mock",
    });
  });

  it("event: produces rumor_detector, fact_checker, source_validator, report_composer steps", async () => {
    const runtime = new AgentRuntime(makeDeps());
    const result = await runtime.runCase({ claim: "网传某地发生食品安全事件" });
    const agentIds = result.steps.map((s) => s.agent);
    expect(agentIds).toContain("rumor_detector");
    expect(agentIds).toContain("fact_checker");
    expect(agentIds).toContain("source_validator");
    expect(agentIds).toContain("report_composer");
    expect(agentIds).not.toContain("concept_extractor");
  });

  it("causal: produces alternative_explanation_searcher and counter_evidence_grader", async () => {
    mockCallAgent.mockResolvedValue({
      output: { factCheckResult: "partial", confidence: "medium", counterEvidence: [], unresolvedEvidenceGaps: [] },
      model: "mock",
    });
    const runtime = new AgentRuntime(makeDeps());
    const result = await runtime.runCase({ claim: "吃某食物会导致癌症" });
    const agentIds = result.steps.map((s) => s.agent);
    expect(agentIds).toContain("alternative_explanation_searcher");
    expect(agentIds).toContain("counter_evidence_grader");
    expect(agentIds).toContain("rumor_detector");
    expect(agentIds).toContain("fact_checker");
    expect(agentIds).toContain("source_validator");
    expect(agentIds).toContain("report_composer");
  });

  it("concept: skips fact-checking agents (existing behavior preserved)", async () => {
    const runtime = new AgentRuntime(makeDeps());
    const result = await runtime.runCase({ claim: "什么是量子纠缠" });
    const agentIds = result.steps.map((s) => s.agent);
    expect(agentIds).toContain("report_composer");
    expect(agentIds).not.toContain("rumor_detector");
    expect(agentIds).not.toContain("fact_checker");
    expect(agentIds).not.toContain("source_validator");
  });

  it("mixed: routes through standard pipeline with per-sub-claim trace", async () => {
    // "某保健品说吃了能降血压，这究竟是科学还是营销话术" — doesn't match concept/causal/event patterns → mixed
    const runtime = new AgentRuntime(makeDeps());
    const result = await runtime.runCase({ claim: "某保健品说吃了能降血压，这究竟是科学还是营销话术" });
    const agentIds = result.steps.map((s) => s.agent);
    expect(agentIds).toContain("rumor_detector");
    expect(agentIds).toContain("report_composer");
  });

  it("injects reactTrace for fact_checker/source_validator and secondary note for report_composer", async () => {
    // Always return gaps for all agents so report_composer can see fact_checker gaps via steps
    mockCallAgent.mockResolvedValue({
      output: {
        factCheckResult: "partial",
        confidence: "low",
        unresolvedEvidenceGaps: ["缺官方确认", "缺检测报告"],
        claimAtoms: ["x"],
        sourceReliability: "mixed",
      },
      model: "mock",
    });

    // search 层也给 ≥2 gaps + 空反证，驱动 reactTrace.shouldSecondPassCounterSearch
    const runtime = new AgentRuntime(
      makeDeps({
        getSearchForClaim: vi.fn().mockResolvedValue({
          _source: "tool-ok",
          model: "mock",
          answer: "test answer",
          sources: [{ title: "S", url: "https://s.example", snippet: "s" }],
          supportingEvidence: [{ title: "S", url: "https://s.example", snippet: "s" }],
          contradictingEvidence: [],
          unresolvedEvidenceGaps: ["缺官方通报", "缺原始数据"],
          traceText: "",
        }),
      })
    );
    const events: Array<{ type: string; relay?: { title?: string }; toolId?: string; toolName?: string }> = [];
    const result = await runtime.runCase(
      { claim: "网传某地发生食品安全事件" },
      (event) => events.push(event as { type: string; relay?: { title?: string }; toolId?: string; toolName?: string })
    );

    const fact = result.steps.find((s) => s.agent === "fact_checker");
    const source = result.steps.find((s) => s.agent === "source_validator");
    const report = result.steps.find((s) => s.agent === "report_composer");
    const rumor = result.steps.find((s) => s.agent === "rumor_detector");

    expect(fact?.input.reactTrace).toBeTruthy();
    expect((fact?.input.reactTrace as { thoughtHint?: string })?.thoughtHint).toMatch(/Think/);
    expect(
      (fact?.input.reactTrace as { shouldSecondPassCounterSearch?: boolean })?.shouldSecondPassCounterSearch
    ).toBe(true);
    expect(source?.input.reactTrace).toBeTruthy();
    expect(rumor?.input.reactTrace).toBeUndefined();
    // fact_checker output has >=2 gaps + empty contradictingEvidence → report gets note + hint
    expect(report?.input.reactObserveNote).toBe("应触发二次反证检索");
    expect(report?.input.secondPassCounterSearchHint).toBe("建议二次反证检索");

    // fact 完成后应 emit speculative_update / tool_result 提示
    expect(
      events.some(
        (e) =>
          e.type === "speculative_update" &&
          e.relay?.title === "建议二次反证检索"
      )
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "tool_result" && e.toolId === "second_pass_counter_search"
      )
    ).toBe(true);
  });

  it("skips report_composer LLM after two prior error-boundaries", async () => {
    mockCallAgent.mockImplementation(async (req: { traceLabel?: string }) => {
      if (req.traceLabel === "FactChecker" || req.traceLabel === "SourceValidator") {
        throw new Error("模型调用失败");
      }
      return {
        output: { claimAtoms: ["网传某地发生食品安全事件"], factCheckResult: "unverified" },
        model: "mock",
      };
    });

    const runtime = new AgentRuntime(makeDeps());
    const result = await runtime.runCase({ claim: "网传某地发生食品安全事件" });
    const report = result.steps.find((s) => s.agent === "report_composer");
    expect(report?.model).toBe("runtime:error-boundary");
    expect(report?.output.verdictType).toBe("unverified");
    expect(report?.output.credibilityLabel).toBe("未能判断");
    const labels = mockCallAgent.mock.calls.map((call) => call[0]?.traceLabel);
    expect(labels).not.toContain("ReportComposer");
  });
});
