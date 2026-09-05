import { describe, expect, it } from "vitest";
import { defaultSearchProviders } from "./searchAll.js";
import { listSearchProviders, parseUserSearchKeys } from "./searchCatalog.js";

describe("search catalog", () => {
  it("空 env 只预置 AnySearch", () => {
    const names = defaultSearchProviders({}).map((fn) => fn.name);
    expect(names).toEqual(["any_search"]);
  });

  it("有 MiniMax / 阶跃模型套餐密钥时挂上对应检索，不当收费搜索源", () => {
    const names = defaultSearchProviders({
      MINIMAX_API_KEY: "sk-cp-fake",
      STEPFUN_API_KEY: "step-fake",
    }).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "minimax_search", "stepfun_search"]);
    const rows = listSearchProviders({ MINIMAX_API_KEY: "sk-cp-fake", STEPFUN_API_KEY: "step-fake" });
    const minimax = rows.find((r) => r.id === "minimax_search");
    const stepfun = rows.find((r) => r.id === "stepfun_search");
    expect(minimax?.billing).toBe("included");
    expect(stepfun?.billing).toBe("included");
    expect(minimax?.configured).toBe(true);
    expect(stepfun?.configured).toBe(true);
    expect(minimax?.signupUrl).toBeUndefined();
    expect(stepfun?.signupUrl).toBeUndefined();
    expect(minimax?.label).toBe("MiniMax Token Plan");
    expect(minimax?.hint).toMatch(/MiniMax Token Plan/);
    expect(minimax?.hint).toMatch(/不需要单独的搜索密钥/);
    expect(stepfun?.hint).toMatch(/Step Plan/);
    expect(stepfun?.hint).toMatch(/不需要单独的搜索密钥/);
  });

  it("有密钥才挂上收费源", () => {
    const names = defaultSearchProviders({
      TAVILY_API_KEY: "tvly-x",
      BOCHA_API_KEY: "bk",
    }).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "tavily_search", "bocha_search"]);
  });

  it("SEARCH_DISABLED_PROVIDERS 停用已配置源，不删除密钥，未知 id 无影响", () => {
    const env = {
      TAVILY_API_KEY: "tvly-keep",
      EXA_API_KEY: "exa-keep",
      MINIMAX_API_KEY: "sk-cp-keep",
      SEARCH_DISABLED_PROVIDERS: " tavily_search, not_a_real_source , minimax_search ",
    };
    const names = defaultSearchProviders(env).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "exa_search"]);
    expect(env.TAVILY_API_KEY).toBe("tvly-keep");
    expect(env.MINIMAX_API_KEY).toBe("sk-cp-keep");
    expect(env.EXA_API_KEY).toBe("exa-keep");
  });

  it("SearXNG 只在有地址时启用", () => {
    const names = defaultSearchProviders({
      SEARXNG_URL: "http://127.0.0.1:8888",
    }).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "searxng_search"]);
  });

  it("对外目录不泄漏密钥，收费源带开通/充值链接", () => {
    const rows = listSearchProviders({ TAVILY_API_KEY: "secret" });
    const tavily = rows.find((r) => r.id === "tavily_search");
    const any = rows.find((r) => r.id === "any_search");
    expect(any?.billing).toBe("included");
    expect(any?.configured).toBe(true);
    expect(tavily?.billing).toBe("byo");
    expect(tavily?.configured).toBe(true);
    expect(tavily?.signupUrl).toMatch(/^https:\/\//);
    expect(tavily?.rechargeUrl).toMatch(/^https:\/\//);
    expect(JSON.stringify(rows)).not.toMatch(/secret/);
  });

  it("用户密钥只接受目录里的收费源", () => {
    expect(
      parseUserSearchKeys({
        tavily_search: " tvly-user ",
        PATH: "/bin",
        SEARXNG_URL: "http://evil.example",
        searxng_search: "http://evil.example",
        minimax_search: "sk-cp-from-browser",
        stepfun_search: "step-from-browser",
        MINIMAX_API_KEY: "nope",
      })
    ).toEqual({ TAVILY_API_KEY: "tvly-user" });
  });
});
