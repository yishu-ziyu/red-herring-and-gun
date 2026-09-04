import { describe, expect, it } from "vitest";
import { defaultSearchProviders } from "./searchAll.js";
import { listSearchProviders, parseUserSearchKeys } from "./searchCatalog.js";

describe("search catalog", () => {
  it("空 env 只预置 AnySearch", () => {
    const names = defaultSearchProviders({}).map((fn) => fn.name);
    expect(names).toEqual(["any_search"]);
  });

  it("有密钥才挂上收费源", () => {
    const names = defaultSearchProviders({
      TAVILY_API_KEY: "tvly-x",
      BOCHA_API_KEY: "bk",
    }).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "tavily_search", "bocha_search"]);
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
      })
    ).toEqual({ TAVILY_API_KEY: "tvly-user" });
  });
});
