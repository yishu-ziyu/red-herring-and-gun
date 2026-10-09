/** R10 E1、E3：StepFun 聊天补全地址的推导，图片解析与健康探针共用。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { stepFunChatCompletionsUrl } from "./agentProviders.js";
import { probeModelServiceHealth } from "./modelServiceHealth.js";
import { resetProviderQuotaSkipForTests } from "./providerRouter.js";

describe("stepFunChatCompletionsUrl", () => {
  it.each([
    ["https://api.stepfun.com/step_plan", "https://api.stepfun.com/step_plan/v1/chat/completions"],
    ["https://api.stepfun.com/step_plan/", "https://api.stepfun.com/step_plan/v1/chat/completions"],
    ["https://api.stepfun.com/step_plan/v1", "https://api.stepfun.com/step_plan/v1/chat/completions"],
    ["https://api.stepfun.com/v1", "https://api.stepfun.com/v1/chat/completions"],
    ["https://api.stepfun.com/v1/", "https://api.stepfun.com/v1/chat/completions"],
  ])("%s -> %s", (base, expected) => {
    expect(stepFunChatCompletionsUrl(base)).toBe(expected);
  });
});

describe("健康探针的 StepFun 地址", () => {
  afterEach(() => {
    resetProviderQuotaSkipForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("E3 step_plan 配置下探针打 step_plan/v1/chat/completions", async () => {
    for (const key of ["DEEPSEEK_API_KEY", "MIMO_API_KEY", "QIHOO_360_API_KEY", "AI360_API_KEY", "ANTHROPIC_API_KEY", "MINIMAX_API_KEY"]) vi.stubEnv(key, "");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => "{}" };
    }));
    await probeModelServiceHealth({ STEPFUN_API_KEY: "sk-test", STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan" });
    expect(urls).toContain("https://api.stepfun.com/step_plan/v1/chat/completions");
  });
});
