import { describe, expect, it, vi } from "vitest";
import {
  agentEnvKey,
  callAgentWithFallback,
  envValue,
  modelForAgent,
  parseAgentJson,
  providerOrderForAgent,
} from "./providerRouter.js";

// Mock 6 个 LLM provider；让 B2-B5 测试可以验证"哪个被调用、哪个没被调用"
vi.mock("./agentProviders.js", () => ({
  callDeepSeekAgent: vi.fn(),
  callMimoAgent: vi.fn(),
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
  callStepFunAgent,
} from "./agentProviders.js";

const allProviders = {
  callDeepSeekAgent: vi.mocked(callDeepSeekAgent),
  callMimoAgent: vi.mocked(callMimoAgent),
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
  // 1. providerOrderForAgent: env 为空时返回默认 6 provider
  it("getAgentTextProviderOrder({}) returns default 6-provider order", () => {
    expect(providerOrderForAgent({})).toEqual([
      "deepseek",
      "mimo",
      "stepfun",
      "360",
      "anthropic",
      "codex",
    ]);
  });

  // 2. providerOrderForAgent: 强制 deepseek 第一、codex 最后；不补全缺失 provider
  it("getAgentTextProviderOrder forces deepseek first and codex last; does not backfill missing providers", () => {
    const result = providerOrderForAgent({
      ORCHESTRATE_TEXT_PROVIDER_ORDER: "stepfun,deepseek,360",
    });
    // 原行为：只保留 env 中列出的有效 provider，强制 deepseek 跳到首位，codex 默认追加
    expect(result).toEqual(["deepseek", "stepfun", "360", "codex"]);
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
    // per-agent 优先 → stepfun, mimo；强制 deepseek 第一、codex 最后
    expect(result).toEqual(["deepseek", "stepfun", "mimo", "codex"]);
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

  // 6. envValue: 优先传入 env，再 process.env，最后空串
  it("envValue prefers passed env over process.env, returns empty string if neither has key", () => {
    const prev = process.env.PROVIDER_ROUTER_TEST_KEY;
    try {
      delete process.env.PROVIDER_ROUTER_TEST_KEY;
      expect(envValue({ FOO: "from-env" }, "FOO")).toBe("from-env");
      expect(envValue({}, "FOO")).toBe("");
      process.env.PROVIDER_ROUTER_TEST_KEY = "from-process";
      expect(envValue({}, "PROVIDER_ROUTER_TEST_KEY")).toBe("from-process");
      // 传入的 env 优先
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

  // 9. parseAgentJson: 无法解析时抛带 label 的错误
  it("parseAgentJson throws with label prefix when input is not parseable", () => {
    expect(() => parseAgentJson("not json at all", "my-label")).toThrow(/my-label/);
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
// BDD 行为用例 B2-B5：modelOverride 旁路 fallback chain
// ───────────────────────────────────────────────────────────────

describe("providerRouter modelOverride (BDD B2-B5)", () => {
  it("B2: when modelOverride is set, only the specified provider is tried (NOT the env default first one)", async () => {
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

    // 关键断言 2: deepseek 完全没被调（虽然它在 fallback chain 排第一）
    expect(allProviders.callDeepSeekAgent).not.toHaveBeenCalled();
    expect(allProviders.callStepFunAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callMimoAgent).not.toHaveBeenCalled();
    expect(allProviders.call360ChatAgent).not.toHaveBeenCalled();
    expect(allProviders.callAnthropicAgent).not.toHaveBeenCalled();
    expect(allProviders.callCodexAgent).not.toHaveBeenCalled();
  });

  it("B3: when modelOverride provider has no API key, throws without trying fallback", async () => {
    resetAllMocks();
    // 选 stepfun，但 env 里 STEPFUN_API_KEY 没配
    // 期望: router 抛错, 其他 provider 也不能被兜底调用

    await expect(
      callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: { DEEPSEEK_API_KEY: "sk-ds" },  // 只有 deepseek, 没有 stepfun
        codexBin: "/usr/bin/codex",
        modelOverride: { provider: "stepfun", model: "step-1" },
      })
    ).rejects.toThrow(/stepfun/);

    // 任何 provider 都没被调用（既没走 stepfun 也没兜底到 deepseek）
    expect(allProviders.callStepFunAgent).not.toHaveBeenCalled();
    expect(allProviders.callDeepSeekAgent).not.toHaveBeenCalled();
  });

  it("B4: when modelOverride call fails, the error is thrown (no fallback to other providers)", async () => {
    resetAllMocks();
    allProviders.callDeepSeekAgent.mockRejectedValueOnce(new Error("DeepSeek 502"));

    await expect(
      callAgentWithFallback({
        agentId: "rumor_detector",
        systemPrompt: "x",
        userContent: "x",
        responseSchema: { type: "object" },
        maxTokens: 100,
        env: {
          DEEPSEEK_API_KEY: "sk-ds",
          MIMO_API_KEY: "sk-mimo",  // 故意配 mimo, 期望它**不**被兜底
        },
        codexBin: "/usr/bin/codex",
        modelOverride: { provider: "deepseek", model: "deepseek-chat" },
      })
    ).rejects.toThrow(/DeepSeek 502/);

    expect(allProviders.callDeepSeekAgent).toHaveBeenCalledTimes(1);
    expect(allProviders.callMimoAgent).not.toHaveBeenCalled();  // 关键: 不兜底
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
