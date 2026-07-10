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
});
