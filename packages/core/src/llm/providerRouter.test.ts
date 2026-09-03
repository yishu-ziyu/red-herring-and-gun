import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentEnvKey,
  callAgentWithFallback,
  envValue,
  isEmptyProviderResponse,
  isHardProviderQuotaError,
  modelForAgent,
  parseAgentJson,
  providerOrderForAgent,
  resetProviderQuotaSkipForTests,
} from "./providerRouter.js";

// Mock LLM provider；让 B2-B5 测试可以验证"哪个被调用、哪个没被调用"
vi.mock("./agentProviders.js", () => ({
  callDeepSeekAgent: vi.fn(),
  callMimoAgent: vi.fn(),
  callMiniMaxAgent: vi.fn(),
  callStepFunAgent: vi.fn(),
  call360ChatAgent: vi.fn(),
  callAnthropicAgent: vi.fn(),
  callCodexAgent: vi.fn(),
}));

import {
  call360ChatAgent,
  callAnthropicAgent,
  callCodexAgent,
  callDeepSeekAgent,
  callMimoAgent,
  callMiniMaxAgent,
  callStepFunAgent,
} from "./agentProviders.js";

const allProviders = {
  callDeepSeekAgent: vi.mocked(callDeepSeekAgent),
  callMimoAgent: vi.mocked(callMimoAgent),
  callMiniMaxAgent: vi.mocked(callMiniMaxAgent),
  callStepFunAgent: vi.mocked(callStepFunAgent),
  call360ChatAgent: vi.mocked(call360ChatAgent),
  callAnthropicAgent: vi.mocked(callAnthropicAgent),
  callCodexAgent: vi.mocked(callCodexAgent),
};

function resetAllMocks() {
  for (const fn of Object.values(allProviders)) {
    fn.mockReset();
  }
}

describe("providerRouter env helpers", () => {
  // 1. providerOrderForAgent: env 为空时返回默认 order（MiniMax 优先，360 靠后）
  it("getAgentTextProviderOrder({}) returns default provider order with minimax first", () => {
    expect(providerOrderForAgent({})).toEqual([
      "minimax",
      "stepfun",
      "anthropic",
      "deepseek",
      "mimo",
      "360",
      "codex",
    ]);
  });

  // 2. providerOrderForAgent: 尊重配置顺序、codex 最后；不补全缺失 provider
  it("getAgentTextProviderOrder respects configured order and keeps codex last; does not backfill missing providers", () => {
    const result = providerOrderForAgent({
      ORCHESTRATE_TEXT_PROVIDER_ORDER: "stepfun,deepseek,360",
    });
    expect(result).toEqual(["stepfun", "deepseek", "360", "codex"]);
  });

  // 3. providerOrderForAgent: per-agent env 优先
  it("getAgentTextProviderOrder with agentId prefers per-agent env", () => {
    const result = providerOrderForAgent(
      {
        ORCHESTRATE_RUMOR_DETECTOR_PROVIDER_ORDER: "stepfun,mimo",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "deepseek,360",
      },
      "rumor_detector"
    );
    expect(result).toEqual(["stepfun", "mimo", "codex"]);
  });

  // 4. providerOrderForAgent: 跳过未知 provider
  it("getAgentTextProviderOrder silently drops unknown provider names", () => {
    const result = providerOrderForAgent({
      ORCHESTRATE_TEXT_PROVIDER_ORDER: "foo,deepseek,bar",
    });
    // foo/bar 未知被丢；只剩 deepseek；codex 默认追加
    expect(result).toEqual(["deepseek", "codex"]);
  });

  // 5. agentEnvKey: 规整化 agent id
  it("agentEnvKey normalizes agent ids to upper-snake", () => {
    expect(agentEnvKey("rumor_detector")).toBe("RUMOR_DETECTOR");
    expect(agentEnvKey("report-composer")).toBe("REPORT_COMPOSER");
    expect(agentEnvKey("fact_checker.v2")).toBe("FACT_CHECKER_V2");
    expect(agentEnvKey(undefined)).toBe("");
    expect(agentEnvKey("")).toBe("");
  });

  // 6. envValue: 只读传入 env，缺省空串；不读 process.env
  it("envValue prefers passed env over process.env, returns empty string if neither has key", () => {
    const prev = process.env.PROVIDER_ROUTER_TEST_KEY;
    try {
      delete process.env.PROVIDER_ROUTER_TEST_KEY;
      expect(envValue({ FOO: "from-env" }, "FOO")).toBe("from-env");
      expect(envValue({}, "FOO")).toBe("");
      process.env.PROVIDER_ROUTER_TEST_KEY = "from-process";
      expect(envValue({}, "PROVIDER_ROUTER_TEST_KEY")).toBe("");
      expect(envValue({ PROVIDER_ROUTER_TEST_KEY: "from-env" }, "PROVIDER_ROUTER_TEST_KEY")).toBe("from-env");
    } finally {
      if (prev === undefined) delete process.env.PROVIDER_ROUTER_TEST_KEY;
      else process.env.PROVIDER_ROUTER_TEST_KEY = prev;
    }
  });

  // 7. parseAgentJson: 合法 JSON
  it("parseAgentJson returns parsed object for valid JSON", () => {
    expect(parseAgentJson('{"a":1,"b":"x"}', "test")).toEqual({ a: 1, b: "x" });
  });

  // 8. parseAgentJson: 尾部逗号自动 repair
  it("parseAgentJson repairs trailing comma in loose JSON", () => {
    expect(parseAgentJson('{"a":1,}', "test")).toEqual({ a: 1 });
  });

  it("parseAgentJson repairs truncated object by closing braces", () => {
    expect(parseAgentJson('{"title":"hello","items":[1,2', "test")).toEqual({
      title: "hello",
      items: [1, 2],
    });
  });

  it("parseAgentJson repairs unquoted bare values and smart quotes", () => {
    expect(parseAgentJson('{“ok”: yes, "note": done,}', "test")).toEqual({ ok: "yes", note: "done" });
  });

  it("parseAgentJson repairs unescaped inner quotes inside string values", () => {
    const broken =
      '{"conclusion":"酒精擦身不能退烧，医生说"物理降温"已过时","items":[{"claim":"酒精经皮吸收"可能中毒","verdict":false}]}';
    const parsed = parseAgentJson(broken, "test");
    expect(parsed.conclusion).toContain("物理降温");
    expect(parsed.items[0].claim).toContain("可能中毒");
  });

  it("parseAgentJson keeps legitimate closing quotes untouched", () => {
    expect(parseAgentJson('{"a":"x","b":[1,{"c":"y"}]}', "test")).toEqual({
      a: "x",
      b: [1, { c: "y" }],
    });
  });

  // 9. parseAgentJson: 无法解析时抛带 label 的错误
  it("parseAgentJson throws with label prefix when input is not parseable", () => {
    expect(() => parseAgentJson("not json at all", "my-label")).toThrow(/my-label/);
  });

  it("B-json-retry: bad JSON then repair call on same provider avoids whole-step failure", async () => {
    resetAllMocks();
    allProviders.callMiniMaxAgent
      .mockResolvedValueOnce({
        // 本地 repair 救不回来，必须触发同 provider json_repair_retry
        text: 'Sure — here you go:\n{title: broken, items: [1 2, "x": }',
        model: "minimax:MiniMax-M3",
      })
      .mockResolvedValueOnce({
        text: '{"title":"fixed","ok":true}',
        model: "minimax:MiniMax-M3",
      });

    const result = await callAgentWithFallback({
      agentId: "counter_evidence_grader",
      systemPrompt: "return json",
      userContent: "grade this",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MINIMAX_API_KEY: "sk-mm",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax",
      },
      codexBin: "/usr/bin/codex",
    });

    expect(result.output).toEqual({ title: "fixed", ok: true });
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(2);
  });

  // 10. modelForAgent: per-agent > global > fallback
  it("modelForAgent resolves per-agent > global > fallback in that order", () => {
    // per-agent 优先
    expect(
      modelForAgent(
        { DEEPSEEK_RUMOR_DETECTOR_MODEL: "agent-specific" },
        "DEEPSEEK",
        "rumor_detector",
        "fb"
      )
    ).toBe("agent-specific");
    // per-agent 没有时用 global
    expect(modelForAgent({ DEEPSEEK_MODEL: "global" }, "DEEPSEEK", "rumor_detector", "fb")).toBe(
      "global"
    );
    // 都没有时用 fallback
    expect(modelForAgent({}, "DEEPSEEK", "rumor_detector", "fb")).toBe("fb");
  });
});

// ───────────────────────────────────────────────────────────────
// BDD 行为用例 B2-B5：modelOverride 优先，失败后继续 fallback chain
// ───────────────────────────────────────────────────────────────

describe("providerRouter modelOverride (BDD B2-B5)", () => {
  it("B2: when modelOverride succeeds, it is tried before the env default provider", async () => {
    resetAllMocks();
    // 用 mockImplementation 把"实际收到的 model"回声到响应里,
    // 这样可以区分 router 是用 modelOverride.model 调的,还是用 env 的 default 调的
    allProviders.callDeepSeekAgent.mockImplementation(async (args: any) => ({
      text: JSON.stringify({ called_with: args.model, by: "deepseek" }),
      model: `deepseek:${args.model}`,
    }));
    allProviders.callStepFunAgent.mockImplementation(async (args: any) => ({
      text: JSON.stringify({ called_with: args.model, by: "stepfun" }),
      model: `stepfun:${args.model}`,
    }));

    // modelOverride 故意选 stepfun（不是 fallback chain 顺位第一的 deepseek）
    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: "you are detector",
      userContent: "claim",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        DEEPSEEK_API_KEY: "sk-ds",
        DEEPSEEK_MODEL: "deepseek-v4-pro",  // env default
        MIMO_API_KEY: "sk-mimo",
        STEPFUN_API_KEY: "sk-sf",
        QIHOO_360_API_KEY: "sk-360",
      },
      codexBin: "/usr/bin/codex",
      modelOverride: { provider: "stepfun", model: "step-2" },
    });

    // 关键断言 1: 实际用的是 modelOverride 指定的 model（不是 env 的 deepseek-v4-pro）
    expect(result.output).toEqual({ called_with: "step-2", by: "stepfun" });
    expect(result.model).toBe("stepfun:step-2");

    // 关键断言 2: deepseek 完全没被调（override 成功后不再 fallback）
    expect(allProviders.callDeepSeekAgent).not.toHaveBeenCalled();
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callMiniMaxAgent).not.toHaveBeenCalled();
    expect(allProviders.callMimoAgent).not.toHaveBeenCalled();
    expect(allProviders.call360ChatAgent).not.toHaveBeenCalled();
    expect(allProviders.callAnthropicAgent).not.toHaveBeenCalled();
    expect(allProviders.callCodexAgent).not.toHaveBeenCalled();
  });

  it("B2-minimax: modelOverride can call the real MiniMax provider path", async () => {
    resetAllMocks();
    allProviders.callMiniMaxAgent.mockImplementation(async (args: any) => ({
      text: JSON.stringify({ called_with: args.model, by: "minimax" }),
      model: `minimax:${args.model}`,
    }));

    const result = await callAgentWithFallback({
      agentId: "fact_checker",
      systemPrompt: "you are checker",
      userContent: "claim",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MINIMAX_API_KEY: "sk-mm",
        DEEPSEEK_API_KEY: "sk-ds",
      },
      codexBin: "/usr/bin/codex",
      modelOverride: { provider: "minimax", model: "MiniMax-M3" },
    });

    expect(result.output).toEqual({ called_with: "MiniMax-M3", by: "minimax" });
    expect(result.model).toBe("minimax:MiniMax-M3");
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callDeepSeekAgent).not.toHaveBeenCalled();
  });

  it("B2-stepfun-3.7: raises max_tokens and uses low reasoning by default for structured Agent JSON", async () => {
    resetAllMocks();
    allProviders.callStepFunAgent.mockImplementation(async (args: any) => ({
      text: JSON.stringify({
        called_with: args.model,
        max_tokens: args.maxTokens,
        reasoning_effort: args.reasoningEffort,
      }),
      model: `stepfun:${args.model}`,
    }));

    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: "you are detector",
      userContent: "claim",
      responseSchema: { type: "object" },
      maxTokens: 800,
      env: {
        STEPFUN_API_KEY: "sk-sf",
      },
      codexBin: "/usr/bin/codex",
      modelOverride: { provider: "stepfun", model: "step-3.7-flash" },
      reasoningEffort: "high",
    });

    expect(result.output).toEqual({
      called_with: "step-3.7-flash",
      max_tokens: 4096,
      reasoning_effort: "low",
    });
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(1);
  });

  it("B2-minimax-m3: adaptive thinking stays on and uses MiniMax recommended max_tokens", async () => {
    resetAllMocks();
    vi.stubEnv("MINIMAX_M3_THINKING", "");
    vi.stubEnv("MINIMAX_M3_MAX_TOKENS", "");
    vi.stubEnv("MINIMAX_M3_MIN_MAX_TOKENS", "");
    allProviders.callMiniMaxAgent.mockImplementation(async (args: any) => ({
      text: JSON.stringify({ max_tokens: args.maxTokens, thinking: args.thinking }),
      model: `minimax:${args.model}`,
    }));

    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: "you are detector",
      userContent: "claim",
      responseSchema: { type: "object" },
      maxTokens: 800,
      env: {
        MINIMAX_API_KEY: "sk-mm",
      },
      codexBin: "/usr/bin/codex",
      modelOverride: { provider: "minimax", model: "MiniMax-M3" },
    });

    expect(result.output).toEqual({ max_tokens: 800, thinking: "adaptive" });
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);
  });

  it("B3: when modelOverride provider has no API key, continues with fallback provider", async () => {
    resetAllMocks();
    // envValue 会 fallback 到 process.env；测试机若配了 STEPFUN_API_KEY 会导致缺 key 不 throw。
    // 用 stubEnv 清空 process.env.STEPFUN_API_KEY，确保 key check 生效。test 结束 vitest 自动 unstub。
    vi.stubEnv("STEPFUN_API_KEY", "");
    allProviders.callDeepSeekAgent.mockResolvedValueOnce({
      text: '{"ok":true,"provider":"deepseek"}',
      model: "deepseek:deepseek-v4-pro",
    });

    const result = await callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: { DEEPSEEK_API_KEY: "sk-ds" },
        codexBin: "/usr/bin/codex",
        modelOverride: { provider: "stepfun", model: "step-1" },
      });

    expect(result.output).toEqual({ ok: true, provider: "deepseek" });
    expect(result.model).toBe("deepseek:deepseek-v4-pro");
    expect(allProviders.callStepFunAgent).not.toHaveBeenCalled();
    expect(allProviders.callDeepSeekAgent).toHaveBeenCalledTimes(1);
  });

  it("B4: when modelOverride call fails, continues with fallback models/providers", async () => {
    resetAllMocks();
    allProviders.callDeepSeekAgent
      .mockRejectedValueOnce(new Error("DeepSeek 502"))
      .mockRejectedValueOnce(new Error("DeepSeek default 502"));
    allProviders.callMimoAgent.mockResolvedValueOnce({
      text: '{"ok":true,"provider":"mimo"}',
      model: "mimo:mimo-v2.5-pro",
    });

    const result = await callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          DEEPSEEK_API_KEY: "sk-ds",
          MIMO_API_KEY: "sk-mimo",
        },
        codexBin: "/usr/bin/codex",
        modelOverride: { provider: "deepseek", model: "deepseek-chat" },
      });

    expect(result.output).toEqual({ ok: true, provider: "mimo" });
    expect(result.model).toBe("mimo:mimo-v2.5-pro");
    expect(allProviders.callDeepSeekAgent).toHaveBeenCalledTimes(2);
    expect(allProviders.callMimoAgent).toHaveBeenCalledTimes(1);
  });

  it("B4-stepfun-3.7-timeout: when selected StepFun 3.7 times out, continues with fallback model", async () => {
    resetAllMocks();
    allProviders.callStepFunAgent
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        text: '{"ok":true,"provider":"stepfun","model":"step-2-mini"}',
        model: "stepfun:step-2-mini",
    });

    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        STEPFUN_API_KEY: "sk-sf",
        STEPFUN_MODEL: "step-2-mini",
        STEPFUN_3_7_PROVIDER_TIMEOUT_MS: "1",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "stepfun,360",
      },
      codexBin: "/usr/bin/codex",
      modelOverride: { provider: "stepfun", model: "step-3.7-flash" },
    });

    expect(result.output).toEqual({ ok: true, provider: "stepfun", model: "step-2-mini" });
    expect(result.model).toBe("stepfun:step-2-mini");
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(2);
    expect(allProviders.call360ChatAgent).not.toHaveBeenCalled();
  });

  it("B5: when modelOverride is undefined, fallback chain behavior is preserved (regression)", async () => {
    resetAllMocks();
    allProviders.callDeepSeekAgent.mockRejectedValueOnce(new Error("DS 502"));
    allProviders.callMimoAgent.mockResolvedValueOnce({
      text: '{"ok":true,"model":"mimo-v2.5-pro"}',
      model: "mimo:mimo-v2.5-pro",
    });

    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        DEEPSEEK_API_KEY: "sk-ds",
        MIMO_API_KEY: "sk-mimo",
      },
      codexBin: "/usr/bin/codex",
      // 故意不传 modelOverride
    });

    expect(result.output).toEqual({ ok: true, model: "mimo-v2.5-pro" });
    expect(result.model).toBe("mimo:mimo-v2.5-pro");
    expect(allProviders.callDeepSeekAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callMimoAgent).toHaveBeenCalledTimes(1);
  });
});

describe("providerRouter quota skip", () => {
  beforeEach(() => {
    resetAllMocks();
    resetProviderQuotaSkipForTests();
  });

  afterEach(() => {
    resetProviderQuotaSkipForTests();
  });

  it("isHardProviderQuotaError 只认额度耗尽，不认普通 502", () => {
    expect(isHardProviderQuotaError("Insufficient Balance")).toBe(true);
    expect(isHardProviderQuotaError("余额不足")).toBe(true);
    expect(isHardProviderQuotaError("quota exceeded")).toBe(true);
    expect(isHardProviderQuotaError("DeepSeek 502")).toBe(false);
    expect(isEmptyProviderResponse("MiniMax API 没有返回可解析文本。")).toBe(true);
    expect(isEmptyProviderResponse("DeepSeek 502")).toBe(false);
  });

  it("额度耗尽后同一进程不再打该 provider", async () => {
    allProviders.callMiniMaxAgent.mockRejectedValue(new Error("insufficient balance"));
    allProviders.callStepFunAgent.mockResolvedValue({
      text: '{"ok":true,"provider":"stepfun"}',
      model: "stepfun:step-2-mini",
    });

    await expect(
      callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          MINIMAX_API_KEY: "sk-mm",
          ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax",
        },
        codexBin: "/usr/bin/codex",
      })
    ).rejects.toThrow(/所有备用模型/);

    const result = await callAgentWithFallback({
      agentId: "fact_checker",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MINIMAX_API_KEY: "sk-mm",
        STEPFUN_API_KEY: "sk-sf",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax,stepfun",
      },
      codexBin: "/usr/bin/codex",
    });

    expect(result.output).toEqual({ ok: true, provider: "stepfun" });
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(1);
  });

  it("Invalid API Key 后同一进程不再打该 provider", async () => {
    allProviders.callMimoAgent.mockRejectedValue(new Error('{"error":{"code":"401","type":"invalid_key","message":"Invalid API Key"}}'));
    allProviders.callStepFunAgent.mockResolvedValue({
      text: '{"ok":true,"provider":"stepfun"}',
      model: "stepfun:step-2-mini",
    });

    await expect(
      callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          MIMO_API_KEY: "sk-bad",
          ORCHESTRATE_TEXT_PROVIDER_ORDER: "mimo",
        },
        codexBin: "/usr/bin/codex",
      })
    ).rejects.toThrow(/所有备用模型/);

    const result = await callAgentWithFallback({
      agentId: "fact_checker",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MIMO_API_KEY: "sk-bad",
        STEPFUN_API_KEY: "sk-sf",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "mimo,stepfun",
      },
      codexBin: "/usr/bin/codex",
    });

    expect(result.output).toEqual({ ok: true, provider: "stepfun" });
    expect(allProviders.callMimoAgent).toHaveBeenCalledTimes(1);
  });

  it("无返回文本后同一进程不再打该 provider", async () => {
    allProviders.callMiniMaxAgent.mockRejectedValue(new Error("MiniMax API 没有返回可解析文本。"));
    allProviders.callStepFunAgent.mockResolvedValue({
      text: '{"ok":true,"provider":"stepfun"}',
      model: "stepfun:step-2-mini",
    });

    await expect(
      callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          MINIMAX_API_KEY: "sk-mm",
          ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax",
        },
        codexBin: "/usr/bin/codex",
      })
    ).rejects.toThrow(/所有备用模型/);

    const result = await callAgentWithFallback({
      agentId: "fact_checker",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MINIMAX_API_KEY: "sk-mm",
        STEPFUN_API_KEY: "sk-sf",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax,stepfun",
      },
      codexBin: "/usr/bin/codex",
    });

    expect(result.output).toEqual({ ok: true, provider: "stepfun" });
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(1);
  });

  it("连续两次硬失败后跳过 Codex 慢速兜底", async () => {
    allProviders.callMiniMaxAgent.mockRejectedValue(new Error("insufficient balance"));
    allProviders.callStepFunAgent.mockRejectedValue(new Error("You exceeded your current quota"));
    allProviders.callCodexAgent.mockRejectedValue(new Error("codex should not run"));

    await expect(
      callAgentWithFallback({
        agentId: "report_composer",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          MINIMAX_API_KEY: "sk-mm",
          STEPFUN_API_KEY: "sk-sf",
          ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax,stepfun,codex",
        },
        codexBin: "/usr/bin/codex",
      })
    ).rejects.toThrow(/所有备用模型/);

    expect(allProviders.callCodexAgent).not.toHaveBeenCalled();
  });

  it("MiniMax 超时一次后本进程含 override 不再打", async () => {
    allProviders.callMiniMaxAgent.mockImplementation(() => new Promise(() => {}));
    allProviders.callStepFunAgent.mockResolvedValue({
      text: '{"ok":true,"provider":"stepfun"}',
      model: "stepfun:step-2-mini",
    });

    const params = {
      agentId: "rumor_detector",
      systemPrompt: "x",
      userContent: "x",
      responseSchema: { type: "object" },
      maxTokens: 100,
      env: {
        MINIMAX_API_KEY: "sk-mm",
        STEPFUN_API_KEY: "sk-sf",
        MINIMAX_MODEL: "MiniMax-M3",
        MINIMAX_M3_PROVIDER_TIMEOUT_MS: "1",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax,stepfun",
      },
      codexBin: "/usr/bin/codex",
    };

    const first = await callAgentWithFallback(params);
    expect(first.output).toEqual({ ok: true, provider: "stepfun" });
    expect(first.model).toBe("stepfun:step-2-mini");
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);

    const second = await callAgentWithFallback({
      ...params,
      agentId: "fact_checker",
      modelOverride: { provider: "minimax", model: "MiniMax-M3" },
    });
    expect(second.output).toEqual({ ok: true, provider: "stepfun" });
    expect(second.model).toBe("stepfun:step-2-mini");
    expect(allProviders.callMiniMaxAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(2);
  });
});
