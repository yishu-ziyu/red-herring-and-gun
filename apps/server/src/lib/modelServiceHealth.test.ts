import { afterEach, describe, expect, it, vi } from "vitest";
import { probeModelServiceHealth } from "./modelServiceHealth.js";
import { isProviderQuotaSkipped, noteProviderFailure, resetProviderQuotaSkipForTests } from "./providerRouter.js";

describe("probeModelServiceHealth", () => {
  afterEach(() => {
    resetProviderQuotaSkipForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns unavailable when every configured provider is blocked by account errors", async () => {
    noteProviderFailure("deepseek", "Insufficient Balance");
    noteProviderFailure("stepfun", "You exceeded your current quota");
    noteProviderFailure("360", "余额不足");
    noteProviderFailure("mimo", "Invalid API Key");
    noteProviderFailure("minimax", "invalid api key");
    noteProviderFailure("anthropic", "invalid api key");
    const health = await probeModelServiceHealth({
      DEEPSEEK_API_KEY: "sk-test",
      STEPFUN_API_KEY: "sk-test",
      QIHOO_360_API_KEY: "sk-test",
      MIMO_API_KEY: "sk-test",
      MINIMAX_API_KEY: "sk-test",
      ANTHROPIC_BASE_URL: "https://example.invalid",
      ANTHROPIC_MODEL: "dummy",
    });
    expect(health.status).toBe("unavailable");
    expect(health.message).toMatch(/暂时不可用/);
    expect(health.message).not.toMatch(/MiniMax|DeepSeek|quota|API/i);
  });

  // 2026-09-28 错误分析：4 个调查并发时供应商超时 / 空结果被临时拉黑，首页对所有人显示「服务不可用」，29 条里 16 条提交失败。
  it("临时拉黑（空结果 / 超时）不等于服务不可用：直接去问，问通就放回可用名单", async () => {
    // 只留本用例配置的两家：本机 process.env 里的其他密钥不得参与探活。
    for (const key of ["STEPFUN_API_KEY", "MIMO_API_KEY", "QIHOO_360_API_KEY", "AI360_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(key, "");
    noteProviderFailure("minimax", "MiniMax API 没有返回可解析文本。");
    noteProviderFailure("deepseek", "deepseek 超时 90000ms");
    noteProviderFailure("deepseek", "deepseek 超时 90000ms");
    expect(isProviderQuotaSkipped("minimax")).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"ok"}' }));
    const health = await probeModelServiceHealth({ MINIMAX_API_KEY: "sk-test", DEEPSEEK_API_KEY: "sk-test" });
    expect(health.status).toBe("available");
    // 问通的那一家（探活顺序第一个）离开临时跳过名单，调查可以重新用它。
    expect(isProviderQuotaSkipped("deepseek")).toBe(false);
  });

  it("临时拉黑且这次也没问通：未知，不锁住提交", async () => {
    noteProviderFailure("minimax", "MiniMax API 没有返回可解析文本。");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const health = await probeModelServiceHealth({ MINIMAX_API_KEY: "sk-test" });
    expect(health.status).toBe("unknown");
  });

  it("returns available when a lightweight ping succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"id":"ok"}',
      })
    );
    const health = await probeModelServiceHealth({ DEEPSEEK_API_KEY: "sk-test" });
    expect(health.status).toBe("available");
    expect(health.message).toBe("");
  });

  it("returns unavailable on quota/balance errors without naming providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        text: async () => "Insufficient Balance",
      })
    );
    const health = await probeModelServiceHealth({ DEEPSEEK_API_KEY: "sk-test" });
    expect(health.status).toBe("unavailable");
    expect(health.message).toMatch(/暂时不可用/);
    expect(health.message).not.toMatch(/DeepSeek|Insufficient Balance|quota/i);
  });
});
