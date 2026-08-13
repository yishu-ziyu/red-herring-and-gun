import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "./streamAdapter";
import {
  FIXTURE_AGENT_ERROR,
  FIXTURE_COMPLETE,
  FIXTURE_DEBATE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
  FIXTURE_AGENT_THOUGHT,
} from "./fixtures";

describe("adaptOrchestrateStreamToShell", () => {
  it("FIXTURE_EARLY: planner + memory tool + running agent", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY, {
      claim: "隔夜菜加热会致癌吗",
    });

    expect(model.claim).toContain("隔夜菜");
    expect(model.live).toBe(true);
    expect(model.verdict.present).toBe(false);

    expect(model.thoughtItems.some((t) => t.kind === "planner")).toBe(true);
    expect(model.tools.some((t) => t.key === "tool:memory_search")).toBe(true);
    expect(model.tools.find((t) => t.key === "tool:memory_search")?.status).toBe("success");
    expect(model.agents).toHaveLength(1);
    expect(model.agents[0].agentId).toBe("rumor_detector");
    expect(model.agents[0].status).toBe("loading");
    expect(model.phaseLabel.length).toBeGreaterThan(0);
  });

  it("FIXTURE_MID: collapses search tools and completes dual agents", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);

    expect(model.live).toBe(true);
    const search = model.tools.find((t) => t.key === "tool:web_search");
    expect(search).toBeDefined();
    expect(search?.status).toBe("success");
    expect(search?.title).toBe("检索公开材料");

    const agentIds = model.agents.map((a) => a.agentId);
    expect(agentIds).toContain("rumor_detector");
    expect(agentIds).toContain("fact_checker");
    expect(agentIds).toContain("source_validator");
    expect(model.agents.find((a) => a.agentId === "fact_checker")?.status).toBe("success");

    // Agent summaries must not leak raw English enums into the process UI.
    const fact = model.agents.find((a) => a.agentId === "fact_checker");
    expect(fact?.summary).toBe("事实判定：只能信一部分");
    expect(fact?.summary).not.toMatch(/\bpartial\b/i);

    const source = model.agents.find((a) => a.agentId === "source_validator");
    expect(source?.summary).toBe("信源：中");
    expect(source?.summary).not.toMatch(/\bmedium\b/i);
  });

  it("humanizes claimType when planner has no rationale", () => {
    const model = adaptOrchestrateStreamToShell([
      {
        type: "planner_update",
        claim: "测试命题",
        plan: {
          id: "dag-x",
          claimType: "causal",
          nodes: [],
          edges: [],
          criticalPath: [],
        } as never,
        timestamp: 1,
      },
    ]);
    const planner = model.thoughtItems.find((t) => t.kind === "planner");
    expect(planner?.description).toBe("这是因果推断。");
    expect(planner?.description).not.toMatch(/causal/i);
  });

  it("FIXTURE_COMPLETE: review node + verdict card", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);

    expect(model.live).toBe(false);
    expect(model.verdict.present).toBe(true);
    expect(model.verdict.verdictType).toBe("mixed_misleading");
    expect(model.verdict.credibilityScore).toBe(42);
    expect(model.verdict.reviewPassed).toBe(true);
    expect(model.verdict.reviewScore).toBe(92);

    const review = model.tools.find((t) => t.key === "tool:report_reviewer");
    expect(review).toBeDefined();
    expect(review?.title).toBe("报告审稿");
    expect(review?.status).toBe("success");
    expect(review?.detail).toMatch(/审稿通过/);

    expect(model.thoughtItems.some((t) => t.kind === "review")).toBe(true);
    expect(model.thoughtItems.some((t) => t.kind === "report")).toBe(true);
    expect(model.phaseLabel).toBe("结论已出");

    // ThoughtChain may mirror tools strip (Kimi-like); keys must still be unique.
    const thoughtKeys = model.thoughtItems.map((t) => t.key);
    expect(thoughtKeys).toEqual([...new Set(thoughtKeys)]);
  });

  it("collapses repeated agent_start/complete to one thought row", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const rumorThoughts = model.thoughtItems.filter((t) => t.key === "agent:rumor_detector");
    expect(rumorThoughts).toHaveLength(1);
    expect(rumorThoughts[0].status).toBe("success");
  });

  it("empty events yields idle shell", () => {
    const model = adaptOrchestrateStreamToShell([]);
    expect(model.live).toBe(true);
    expect(model.thoughtItems).toHaveLength(0);
    expect(model.tools).toHaveLength(0);
    expect(model.agents).toHaveLength(0);
    expect(model.verdict.present).toBe(false);
  });

  it("maps tool_error and top-level error", () => {
    const model = adaptOrchestrateStreamToShell([
      {
        type: "tool_start",
        toolId: "search360",
        toolName: "360 Search",
        timestamp: 1,
      },
      {
        type: "tool_error",
        toolId: "search360",
        toolName: "360 Search",
        message: "搜索超时",
        timestamp: 2,
      },
      {
        type: "error",
        message: "核查失败：上游中断",
        timestamp: 3,
      },
    ]);
    expect(model.live).toBe(false);
    expect(model.errorMessage).toContain("核查失败");
    const search = model.tools.find((t) => t.key === "tool:web_search");
    expect(search?.status).toBe("error");
    expect(model.thoughtItems.some((t) => t.status === "error")).toBe(true);
  });

  it("FIXTURE_ERROR: tool_error + stream error stops live and surfaces message", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_ERROR);

    expect(model.live).toBe(false);
    expect(model.phaseLabel).toBe("过程中断");
    expect(model.verdict.present).toBe(false);
    expect(model.errorMessage).toBe("核查失败：上游中断");
    expect(model.claim).toContain("隔夜菜");

    const search = model.tools.find((t) => t.key === "tool:web_search");
    expect(search).toBeDefined();
    expect(search?.status).toBe("error");
    expect(search?.detail).toMatch(/搜索超时/);

    expect(model.thoughtItems.some((t) => t.key === "error" && t.status === "error")).toBe(true);
    expect(model.thoughtItems.find((t) => t.key === "error")?.description).toContain("上游中断");
    expect(model.agents.find((a) => a.agentId === "fact_checker")?.status).toBe("success");
  });

  it("FIXTURE_AGENT_ERROR: agent_error marks chip/thought fail without stream abort", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_ERROR);

    // No top-level error: stream stays live; shell alert not set.
    expect(model.live).toBe(true);
    expect(model.errorMessage).toBeUndefined();
    expect(model.verdict.present).toBe(false);
    expect(model.phaseLabel).toBe("角色异常");
    expect(model.claim).toContain("隔夜菜");

    const rumor = model.agents.find((a) => a.agentId === "rumor_detector");
    expect(rumor).toBeDefined();
    expect(rumor?.status).toBe("error");
    expect(rumor?.summary).toContain("拆题超时");

    const thought = model.thoughtItems.find((t) => t.key === "agent:rumor_detector");
    expect(thought?.status).toBe("error");
    expect(thought?.description).toContain("拆题超时");
    expect(model.thoughtItems.some((t) => t.key === "error")).toBe(false);
  });

  it("FIXTURE_REVIEW_FAIL: verdict present with reviewPassed=false", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_REVIEW_FAIL);

    expect(model.live).toBe(false);
    expect(model.verdict.present).toBe(true);
    expect(model.verdict.reviewPassed).toBe(false);
    expect(model.verdict.reviewScore).toBe(48);
    expect(model.verdict.verdictType).toBe("unverified");
    expect(model.phaseLabel).toBe("结论已出");
    const review = model.tools.find((t) => t.key === "tool:report_reviewer");
    expect(review?.status).toBe("success");
    expect(review?.detail).toMatch(/需补证/);
  });

  it("FIXTURE_DEBATE: phase 冲突调解 + thought kind debate", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_DEBATE);

    expect(model.live).toBe(true);
    expect(model.verdict.present).toBe(false);
    expect(model.phaseLabel).toBe("冲突调解");
    expect(model.claim).toContain("隔夜菜");

    const debates = model.thoughtItems.filter((t) => t.kind === "debate");
    expect(debates).toHaveLength(1);
    expect(debates[0].key).toBe("debate-fixture-1");
    expect(debates[0].title).toBe("Agent 冲突调解室");
    expect(debates[0].status).toBe("success");
    expect(debates[0].description).toMatch(/降级/);
  });

  it("humanizes second-pass counter-search from speculative_update and tool_result", () => {
    const model = adaptOrchestrateStreamToShell([
      {
        type: "speculative_update",
        timestamp: 10,
        relay: {
          id: "relay-second-pass-counter-search",
          title: "second_pass_counter_search",
          upstream: "FactChecker",
          downstream: "ReportComposer",
          trigger: "反证材料为空且未决缺口≥2，建议发起二次反证检索。",
          status: "queued",
          savedReason: "应触发二次反证检索",
          confidence: "medium",
        },
      },
      {
        type: "tool_result",
        toolId: "second_pass_counter_search",
        toolName: "second_pass_counter_search",
        timestamp: 11,
        result: {
          shouldSecondPassCounterSearch: true,
          hint: "建议二次反证检索",
        },
      },
    ]);

    const relay = model.thoughtItems.find((t) => t.key === "relay-second-pass-counter-search");
    expect(relay?.title).toBe("建议二次反证检索");

    const toolThought = model.thoughtItems.find(
      (t) => t.kind === "tool" && t.title === "建议二次反证检索"
    );
    expect(toolThought).toBeDefined();
    expect(toolThought?.key).toBe("tool:second_pass_counter_search");

    const tool = model.tools.find((t) => t.key === "tool:second_pass_counter_search");
    expect(tool?.title).toBe("建议二次反证检索");
  });

  it("FIXTURE_AGENT_THOUGHT: appends real reasoning to agent thought row and marks loading", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_THOUGHT);

    const rumor = model.thoughtItems.find((t) => t.key === "agent:rumor_detector");
    expect(rumor).toBeDefined();
    expect(rumor?.status).toBe("loading");
    expect(rumor?.reasoning).toEqual([
      "这句是拆题的真实思考句一。",
      "这句是拆题的真实思考句二。",
      "这句是拆题的真实思考句三。",
    ]);
    // agent_start ts=4 → last thought ts=7
    expect(rumor?.reasoningStartedAt).toBe(4);
    expect(rumor?.reasoningElapsedMs).toBe(3);
    expect(model.agents.find((a) => a.agentId === "rumor_detector")?.status).toBe("loading");
  });

  it("agent_thought reasoning survives agent_complete (status success, reasoning kept)", () => {
    const model = adaptOrchestrateStreamToShell([
      ...FIXTURE_AGENT_THOUGHT,
      {
        type: "agent_complete",
        agent: "rumor_detector",
        agentName: "RumorDetector",
        output: { analysis: "已识别因果健康类断言" },
        latencyMs: 5100,
        timestamp: 99,
      },
    ]);

    const rumor = model.thoughtItems.find((t) => t.key === "agent:rumor_detector");
    expect(rumor?.status).toBe("success");
    expect(rumor?.reasoning).toHaveLength(3);
    // Prefer agent latencyMs (model wall-clock), not SSE pacing span.
    expect(rumor?.reasoningElapsedMs).toBe(5100);
  });

  it("agent_thought dedups out-of-order/duplicate seq (no double append)", () => {
    const model = adaptOrchestrateStreamToShell([
      ...FIXTURE_EARLY,
      {
        type: "agent_thought",
        agent: "rumor_detector",
        content: "思考句A",
        seq: 0,
        done: false,
        timestamp: 5,
      },
      {
        type: "agent_thought",
        agent: "rumor_detector",
        content: "思考句B",
        seq: 1,
        done: false,
        timestamp: 6,
      },
      // 重复 seq=1（回退）不应再次追加
      {
        type: "agent_thought",
        agent: "rumor_detector",
        content: "思考句B(duplicate)",
        seq: 1,
        done: true,
        timestamp: 7,
      },
    ]);

    const rumor = model.thoughtItems.find((t) => t.key === "agent:rumor_detector");
    expect(rumor?.reasoning).toEqual(["思考句A", "思考句B"]);
  });

  it("agent without reasoning exposes no reasoning (no fabricated thinking)", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    const rumor = model.thoughtItems.find((t) => t.key === "agent:rumor_detector");
    expect(rumor?.reasoning).toBeUndefined();
    expect(rumor?.reasoningElapsedMs).toBeUndefined();
  });

  it("understanding: rumor_detector claimAtomTypes 升格为一级理解卡", () => {
    const model = adaptOrchestrateStreamToShell([
      {
        type: "agent_complete",
        agent: "rumor_detector",
        agentName: "RumorDetector",
        output: {
          claimAtoms: ["某药能治愈失眠", "某药已获批准上市"],
          claimAtomTypes: [
            { text: "某药能治愈失眠", verifiable: true, type: "causal" },
            { text: "某药已获批准上市", verifiable: false, type: "normative" },
          ],
        },
        timestamp: 1,
      },
    ], { claim: "某药宣称能治愈失眠，且声称已获批准" });

    expect(model.understanding).toBeDefined();
    expect(model.understanding?.claim).toBe("某药宣称能治愈失眠，且声称已获批准");
    expect(model.understanding?.atoms).toEqual([
      { text: "某药能治愈失眠", verifiable: true, type: "causal" },
      { text: "某药已获批准上市", verifiable: false, type: "normative" },
    ]);
  });

  it("understanding: 无 claimAtomTypes 时退回 claimAtoms 字符串", () => {
    const model = adaptOrchestrateStreamToShell([
      {
        type: "agent_complete",
        agent: "rumor_detector",
        agentName: "RumorDetector",
        output: {
          claimAtoms: ["隔夜菜加热产生致癌物"],
        },
        timestamp: 1,
      },
    ], { claim: "隔夜菜加热会致癌吗" });

    expect(model.understanding?.atoms).toEqual([
      { text: "隔夜菜加热产生致癌物", verifiable: true, type: "fact" },
    ]);
  });

  it("understanding: 非 rumor_detector 或无原子时不升格", () => {
    const noRumor = adaptOrchestrateStreamToShell([
      {
        type: "agent_complete",
        agent: "fact_checker",
        agentName: "FactChecker",
        output: { factCheckResult: "partial" },
        timestamp: 1,
      },
    ]);
    expect(noRumor.understanding).toBeUndefined();

    const emptyAtoms = adaptOrchestrateStreamToShell([
      {
        type: "agent_complete",
        agent: "rumor_detector",
        agentName: "RumorDetector",
        output: { analysis: "无原子" },
        timestamp: 1,
      },
    ]);
    expect(emptyAtoms.understanding).toBeUndefined();
  });

});
