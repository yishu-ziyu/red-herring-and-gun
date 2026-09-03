import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callJob } from "./callJob.js";
import { resetProviderQuotaSkipForTests } from "./providerRouter.js";

describe("callJob", () => {
  beforeEach(() => {
    resetProviderQuotaSkipForTests();
  });

  afterEach(() => {
    resetProviderQuotaSkipForTests();
    vi.unstubAllGlobals();
  });

  function jsonResponse(ok: boolean, body: unknown, statusText = "OK") {
    return {
      ok,
      status: ok ? 200 : 502,
      statusText,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  it("首选厂商失败时回退到次选且 model 为次选", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("deepseek")) {
        return jsonResponse(false, { error: { message: "deepseek 502" } }, "Bad Gateway");
      }
      return jsonResponse(true, {
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callJob({
      job: "rumor_detector",
      systemPrompt: "return json",
      userContent: "claim",
      responseSchema: { type: "object" },
      env: {
        DEEPSEEK_API_KEY: "sk-ds",
        STEPFUN_API_KEY: "sk-sf",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "deepseek,stepfun",
      },
    });

    expect(result.model).toBe("stepfun:step-2-mini");
    expect(result.output).toEqual({ ok: true });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("deepseek"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("stepfun"))).toBe(true);
  });

  it("全部失败时抛错且错误信息含各厂商错误摘要", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("deepseek")) {
        return jsonResponse(false, { error: { message: "deepseek quota exceeded" } }, "Payment Required");
      }
      return jsonResponse(false, { error: { message: "stepfun unauthorized" } }, "Unauthorized");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callJob({
        job: "rumor_detector",
        systemPrompt: "return json",
        userContent: "claim",
        env: {
          DEEPSEEK_API_KEY: "sk-ds",
          STEPFUN_API_KEY: "sk-sf",
          ORCHESTRATE_TEXT_PROVIDER_ORDER: "deepseek,stepfun",
        },
      })
    ).rejects.toThrow(/deepseek quota exceeded.*stepfun unauthorized|stepfun unauthorized.*deepseek quota exceeded/s);
  });

  it("latencyMs 为非负数", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(true, { choices: [{ message: { content: '{"ok":true}' } }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callJob({
      job: "rumor_detector",
      systemPrompt: "return json",
      userContent: "claim",
      env: {
        DEEPSEEK_API_KEY: "sk-ds",
        ORCHESTRATE_TEXT_PROVIDER_ORDER: "deepseek",
      },
    });

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("deepseek:deepseek-v4-pro");
  });
});
