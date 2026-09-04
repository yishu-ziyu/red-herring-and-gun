import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callSearchProvider,
  isHardSearchQuotaError,
  resetSearchQuotaSkipForTests,
} from "./searchProviders.js";
import { defaultSearchProviders, searchAll } from "./searchAll.js";

const ENV: Record<string, string> = {
  QIHOO_360_API_KEY: "fake-360",
  ANYSEARCH_API_KEY: "fake-any",
  METASO_API_KEY: "fake-metaso",
  TAVILY_API_KEY: "fake-tavily",
  EXA_API_KEY: "fake-exa",
};

afterEach(() => {
  resetSearchQuotaSkipForTests();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  };
}

describe("isHardSearchQuotaError", () => {
  it("认余额不足、credits、HTTP 432", () => {
    expect(isHardSearchQuotaError("360 智搜 aiso-pro 调用失败：余额不足")).toBe(true);
    expect(isHardSearchQuotaError("You have exceeded your credits limit. Please top up")).toBe(true);
    expect(
      isHardSearchQuotaError(
        "Tavily Search 调用失败：HTTP 432 This request exceeds your plan's set usage limit."
      )
    ).toBe(true);
    expect(isHardSearchQuotaError("HTTP 500 Internal Server Error")).toBe(false);
  });
});

describe("search quota skip", () => {
  it("额度错误后同进程不再打该源，活着的源继续", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = String(input);
      hosts.push(new URL(url).hostname);
      if (url.includes("api.360.cn")) {
        return jsonResponse(200, { errno: 1, message: "余额不足" });
      }
      if (url.includes("metaso.cn")) {
        return jsonResponse(402, { error: { message: "余额不足" } });
      }
      if (url.includes("api.tavily.com")) {
        return jsonResponse(432, {
          detail: { error: "This request exceeds your plan's set usage limit." },
        });
      }
      if (url.includes("api.exa.ai")) {
        return jsonResponse(402, {
          error: { message: "You have exceeded your credits limit. Please top up" },
        });
      }
      if (url.includes("api.anysearch.com")) {
        return jsonResponse(200, {
          result: {
            content: [
              {
                type: "text",
                text: "\n### 1. 国家医保局\n- **URL**: http://www.nhsa.gov.cn/\ndate: 2026-09-04\n官网",
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const providers = defaultSearchProviders(ENV);
    const first = await searchAll(ENV, "国家医保局", { providers });
    expect(first.map((e) => e.url)).toEqual(["http://www.nhsa.gov.cn/"]);
    expect(hosts.filter((h) => h === "api.anysearch.com")).toHaveLength(1);
    expect(hosts.filter((h) => h === "api.360.cn")).toHaveLength(1);
    expect(hosts.filter((h) => h === "api.tavily.com")).toHaveLength(1);

    hosts.length = 0;
    const second = await searchAll(ENV, "国家医保局", { providers });
    expect(second.map((e) => e.url)).toEqual(["http://www.nhsa.gov.cn/"]);
    expect(hosts).toEqual(["api.anysearch.com"]);
  });

  it("Tavily 432 的 detail.error 写进错误并触发跳过", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return jsonResponse(432, {
        detail: { error: "This request exceeds your plan's set usage limit." },
      });
    });
    await expect(
      callSearchProvider({ env: ENV, provider: "tavily_search", query: "q" })
    ).rejects.toThrow(/HTTP 432.*usage limit/);
    await expect(
      callSearchProvider({ env: ENV, provider: "tavily_search", query: "q" })
    ).rejects.toThrow(/额度耗尽，本进程已跳过/);
    expect(calls).toBe(1);
  });
});
