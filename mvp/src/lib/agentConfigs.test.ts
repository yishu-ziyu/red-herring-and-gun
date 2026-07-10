import { describe, expect, it } from "vitest";
import { AGENT_CONFIGS, getAgentConfig, buildAgentInput } from "./agentConfigs";

describe("agentConfigs — DAG migration new agents", () => {
  it("registers AlternativeExplanationSearcher in AGENT_CONFIGS", () => {
    const agent = getAgentConfig("alternative_explanation_searcher");
    expect(agent).toBeDefined();
    expect(agent!.id).toBe("alternative_explanation_searcher");
    expect(agent!.name).toBe("AlternativeExplanationSearcher");
    expect(agent!.systemPrompt.length).toBeGreaterThan(0);
    expect(agent!.responseSchema).toBeDefined();
  });

  it("registers CounterEvidenceGrader in AGENT_CONFIGS", () => {
    const agent = getAgentConfig("counter_evidence_grader");
    expect(agent).toBeDefined();
    expect(agent!.id).toBe("counter_evidence_grader");
    expect(agent!.name).toBe("CounterEvidenceGrader");
    expect(agent!.systemPrompt.length).toBeGreaterThan(0);
    expect(agent!.responseSchema).toBeDefined();
  });

  it("buildAgentInput produces input for alternative_explanation_searcher", () => {
    const input = buildAgentInput("alternative_explanation_searcher", "test claim", []);
    expect(input.claim).toBe("test claim");
    expect(input.task).toBeDefined();
  });

  it("buildAgentInput produces input for counter_evidence_grader", () => {
    const input = buildAgentInput("counter_evidence_grader", "test claim", []);
    expect(input.claim).toBe("test claim");
    expect(input.task).toBeDefined();
  });
});
