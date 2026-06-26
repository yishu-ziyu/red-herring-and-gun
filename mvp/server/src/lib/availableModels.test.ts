// BDD 行为用例 B1 + B7 + B9：
// - B1: listAvailableModels 按 server 端 env 过滤
// - B7: validateModelChoice（部分 modelChoice 合法、整体校验、不在列表的报错）
// - B9: env 全空时返回空数组
import { describe, expect, it } from "vitest";
import { listAvailableModels, validateModelChoice } from "./availableModels.js";

describe("availableModels", () => {
  // B1: 只列已配 key 的 provider
  it("B1: returns only providers whose API key is configured in env", () => {
    const env = { DEEPSEEK_API_KEY: "sk-ds-test" };
    const models = listAvailableModels(env);
    const providers = new Set(models.map((m) => m.provider));
    expect(providers.has("deepseek")).toBe(true);
    expect(providers.has("mimo")).toBe(false);
    expect(providers.has("stepfun")).toBe(false);
    expect(providers.has("360")).toBe(false);
    expect(providers.has("anthropic")).toBe(false);
    expect(providers.has("codex")).toBe(false);
  });

  // B1-bonus: DeepSeek 至少 1 个 model
  it("B1-bonus: DeepSeek with API key returns at least one model entry with non-empty label", () => {
    const env = { DEEPSEEK_API_KEY: "sk-ds-test" };
    const models = listAvailableModels(env);
    const dsModels = models.filter((m) => m.provider === "deepseek");
    expect(dsModels.length).toBeGreaterThanOrEqual(1);
    for (const m of dsModels) {
      expect(m.label).toBeTruthy();
      expect(m.model).toBeTruthy();
      expect(["high", "mid", "low"]).toContain(m.tier);
    }
  });

  // B1-bonus: 360 智脑多 key 别名支持
  it("B1-bonus: 360 provider is detected when any of QIHOO_360 / ZHINAO / AI360 key is set", () => {
    expect(
      listAvailableModels({ ZHINAO_API_KEY: "x" })
        .some((m) => m.provider === "360")
    ).toBe(true);
    expect(
      listAvailableModels({ AI360_API_KEY: "x" })
        .some((m) => m.provider === "360")
    ).toBe(true);
  });

  it("B1-bonus: MiniMax appears only when MiniMax API key or token-plan key is configured", () => {
    expect(
      listAvailableModels({ ANTHROPIC_MODEL: "MiniMax-M3" })
        .some((m) => m.provider === "minimax")
    ).toBe(false);
    expect(
      listAvailableModels({ MINIMAX_API_KEY: "sk-mm" })
        .some((m) => m.provider === "minimax" && m.model === "MiniMax-M3")
    ).toBe(true);
    expect(
      listAvailableModels({ MINIMAX_TOKEN_PLAN_KEY: "tp-mm" })
        .some((m) => m.provider === "minimax" && m.model === "MiniMax-M3")
    ).toBe(true);
  });

  // B9: env 全空 → 返回 []
  it("B9: returns empty array when no LLM API keys are configured", () => {
    const env = {};
    const models = listAvailableModels(env);
    expect(models).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────
// B7: validateModelChoice（orchestrate handler 校验用）
// ───────────────────────────────────────────────────────────────

describe("validateModelChoice (BDD B3 + B7)", () => {
  const env = { DEEPSEEK_API_KEY: "sk-ds", STEPFUN_API_KEY: "sk-sf", MINIMAX_API_KEY: "sk-mm" };

  it("B7-a: undefined modelChoice 视为合法（全部 agent 走 fallback）", () => {
    expect(validateModelChoice(env, undefined).ok).toBe(true);
    expect(validateModelChoice(env, null).ok).toBe(true);
    expect(validateModelChoice(env, {}).ok).toBe(true);
  });

  it("B7-b: 部分指定合法 modelChoice → 合法", () => {
    const mc = {
      rumor_detector: { provider: "deepseek", model: "deepseek-v4-flash" },
    };
    expect(validateModelChoice(env, mc).ok).toBe(true);
  });

  it("B7-c: 多 agent 各自指定不同 model → 合法", () => {
    const mc = {
      rumor_detector: { provider: "deepseek", model: "deepseek-v4-flash" },
      report_composer: { provider: "deepseek", model: "deepseek-v4-pro" },
    };
    expect(validateModelChoice(env, mc).ok).toBe(true);
  });

  it("B7-minimax: MiniMax modelChoice is legal when MiniMax key is configured", () => {
    const mc = {
      fact_checker: { provider: "minimax", model: "MiniMax-M3" },
    };
    expect(validateModelChoice(env, mc).ok).toBe(true);
  });

  it("B3: modelChoice 引用了没配 key 的 provider → 非法，返回具体哪条 agent 错", () => {
    const mc = {
      rumor_detector: { provider: "mimo", model: "mimo-v2.5-pro" },  // env 没 MIMO_API_KEY
    };
    const result = validateModelChoice(env, mc);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rumor_detector/);
    expect(result.error).toMatch(/MIMO_API_KEY/);
  });

  it("B3-bonus: modelChoice 引用了 provider 配了但 model 名错的 → 非法", () => {
    const mc = {
      rumor_detector: { provider: "deepseek", model: "gpt-999-typo" },
    };
    const result = validateModelChoice(env, mc);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rumor_detector/);
  });

  it("B3-c: 未知 agent id → 非法", () => {
    const mc = {
      tyop_agent: { provider: "deepseek", model: "deepseek-v4-flash" },
    };
    const result = validateModelChoice(env, mc);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tyop_agent/);
  });

  it("B3-d: modelChoice 不是对象 → 非法", () => {
    expect(validateModelChoice(env, "not-an-object").ok).toBe(false);
    expect(validateModelChoice(env, ["array"]).ok).toBe(false);
  });

  it("B3-e: entry 缺 provider / model 字段 → 非法", () => {
    expect(validateModelChoice(env, { rumor_detector: { provider: "deepseek" } }).ok).toBe(false);
    expect(validateModelChoice(env, { rumor_detector: { model: "deepseek-v4-flash" } }).ok).toBe(false);
    expect(validateModelChoice(env, { rumor_detector: "string" }).ok).toBe(false);
  });
});
