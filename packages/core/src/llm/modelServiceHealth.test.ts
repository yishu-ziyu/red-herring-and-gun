import { afterEach, describe, expect, it, vi } from "vitest";
import { probeModelServiceHealth } from "./modelServiceHealth.js";
import { noteProviderFailure, resetProviderQuotaSkipForTests } from "./providerRouter.js";

describe("probeModelServiceHealth", () => {
  afterEach(() => {
    resetProviderQuotaSkipForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns unavailable when configured providers are already skipped", async () => {
    noteProviderFailure("deepseek", "Insufficient Balance");
    noteProviderFailure("stepfun", "You exceeded your current quota");
    noteProviderFailure("360", "余额不足");
    noteProviderFailure("mimo", "Invalid API Key");
    noteProviderFailure("minimax", "MiniMax API 没有返回可解析文本。");
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
