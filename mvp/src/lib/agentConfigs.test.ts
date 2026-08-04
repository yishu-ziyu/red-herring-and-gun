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

  it("rumor_detector prompt 包含原子命题判定标准与原句自证约束", () => {
    const agent = getAgentConfig("rumor_detector");
    expect(agent).toBeDefined();
    const prompt = agent!.systemPrompt;
    expect(prompt).toContain("原子命题的判定标准");
    expect(prompt).toContain("必须能被原句自证");
    expect(prompt).toContain("不要求原子命题彼此独立");
    expect(prompt).toContain("不得引入原句未声称的信息");
  });

  it("fact_checker responseSchema 包含 subclaimVerdicts 逐命题定罪字段", () => {
    const agent = getAgentConfig("fact_checker");
    const props = (agent!.responseSchema as any).properties;
    expect(props.subclaimVerdicts).toBeDefined();
    expect(props.subclaimVerdicts.type).toBe("array");
    const item = props.subclaimVerdicts.items.properties;
    expect(item.claimAtom).toBeDefined();
    expect(item.verdict).toBeDefined();
    expect(item.evidence).toBeDefined();
    expect(item.boundary).toBeDefined();
  });

  it("report_composer 透传 subclaimVerdicts 并补齐覆盖不全项", () => {
    const steps = [
      { agent: "rumor_detector", output: { claimAtoms: ["原子A", "原子B"] } },
      { agent: "fact_checker", output: { subclaimVerdicts: [{ claimAtom: "原子A", verdict: "false", evidence: "证据", boundary: "边界" }] } },
    ];
    const input = buildAgentInput("report_composer", "测试claim", steps as any);
    const verdicts = (input.factCheck as any).subclaimVerdicts;
    expect(verdicts).toHaveLength(2);
    expect(verdicts.find((v: any) => v.claimAtom === "原子A")!.verdict).toBe("false");
    const missing = verdicts.find((v: any) => v.claimAtom === "原子B")!;
    expect(missing.verdict).toBe("unverified");
    expect(missing.boundary).toContain("未覆盖");
  });
});
