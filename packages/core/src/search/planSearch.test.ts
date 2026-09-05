import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSearchProviders, searchAll } from "./searchAll.js";
import { listSearchProviders } from "./searchCatalog.js";
import {
  callSearchProvider,
  resetSearchQuotaSkipForTests,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "./searchProviders.js";
import { toPublicStreamEvent } from "../text/toPublicStreamEvent.js";

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
    text: async () => JSON.stringify(body),
  };
}

describe("MiniMax / 阶跃套餐搜索", () => {
  it("MiniMax 走 Bearer POST /v1/coding_plan/search，按 BASE_URL host 分流", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url: String(input),
        headers,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return jsonResponse(200, {
        organic: [
          {
            title: "官方页",
            link: "https://docs.python.org/3/",
            snippet: "Python 文档",
            date: "2026-09-01",
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
        request_id: "mm-req-secret",
      });
    });

    const result = await callSearchProvider({
      env: {
        MINIMAX_API_KEY: "fake-minimax",
        MINIMAX_BASE_URL: "https://api.minimax.io/anthropic",
        MINIMAX_AUTH_HEADER: "x-api-key",
      },
      provider: "minimax_search",
      query: "Python 文档",
    });

    expect(seen[0]?.url).toBe("https://api.minimax.io/v1/coding_plan/search");
    expect(seen[0]?.headers.Authorization).toBe("Bearer fake-minimax");
    expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
    expect(seen[0]?.body).toEqual({ q: "Python 文档" });
    expect(result.sources).toEqual([
      expect.objectContaining({
        title: "官方页",
        url: "https://docs.python.org/3/",
        snippet: "Python 文档",
        publishedAt: "2026-09-01",
      }),
    ]);
    expect(result.traceText).not.toMatch(/req|Authorization|fake-minimax/i);
  });

  it("MiniMax 国内 minimaxi.com 与 minimax.cn host 分别打对应搜索地址", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      urls.push(String(input));
      return jsonResponse(200, { organic: [], base_resp: { status_code: 0, status_msg: "success" } });
    });
    await callSearchProvider({
      env: { MINIMAX_API_KEY: "fake-minimax", MINIMAX_BASE_URL: "https://api.minimaxi.com/anthropic" },
      provider: "minimax_search",
      query: "q",
    });
    await callSearchProvider({
      env: { MINIMAX_API_KEY: "fake-minimax", MINIMAX_API_HOST: "https://api.minimax.cn" },
      provider: "minimax_search",
      query: "q",
    });
    expect(urls).toEqual([
      "https://api.minimaxi.com/v1/coding_plan/search",
      "https://api.minimax.cn/v1/coding_plan/search",
    ]);
  });

  it("阶跃走官方 MCP web_search，不打 /step_plan/v1/search", async () => {
    const seen: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: false,
          structuredContent: {
            query: "Python 文档",
            category: "",
            results: [
              {
                url: "https://docs.python.org/3/",
                position: 1,
                title: "文档首页",
                time: "2026-09-01T00:00:00",
                snippet: "摘要",
                content: "正文摘录",
              },
            ],
          },
        },
      });
    });

    const result = await callSearchProvider({
      env: { STEPFUN_API_KEY: "fake-step", STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan" },
      provider: "stepfun_search",
      query: "Python 文档",
    });

    expect(seen[0]?.url).toBe("https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp");
    expect(seen[0]?.url).not.toMatch(/\/v1\/search$/);
    expect(seen[0]?.headers.Authorization).toBe("Bearer fake-step");
    expect(seen[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "Python 文档", n: 8 } },
    });
    expect(result.sources).toEqual([
      expect.objectContaining({
        url: "https://docs.python.org/3/",
        title: "文档首页",
        snippet: "摘要",
        publishedAt: "2026-09-01T00:00:00",
      }),
    ]);
  });

  it("阶跃 MCP 地址：step_plan 与 step_plan/v1（含尾斜杠）都落到同一官方路径", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      urls.push(String(input));
      return jsonResponse(200, { result: { structuredContent: { results: [] } } });
    });
    const bases = [
      "https://api.stepfun.com/step_plan",
      "https://api.stepfun.com/step_plan/",
      "https://api.stepfun.com/step_plan/v1",
      "https://api.stepfun.com/step_plan/v1/",
    ];
    for (const base of bases) {
      await callSearchProvider({
        env: { STEPFUN_API_KEY: "fake-step", STEPFUN_BASE_URL: base },
        provider: "stepfun_search",
        query: "q",
      });
    }
    expect(urls).toEqual(
      Array(4).fill("https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp"),
    );
  });

  it("阶跃 MCP 无 structuredContent 时从 content 文本 JSON 解析", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [{ url: "https://example.gov/a", title: "通报", snippet: "摘要" }],
              }),
            },
          ],
        },
      })
    );
    const result = await callSearchProvider({
      env: { STEPFUN_API_KEY: "fake-step" },
      provider: "stepfun_search",
      query: "q",
    });
    expect(result.sources[0]).toEqual(
      expect.objectContaining({ url: "https://example.gov/a", title: "通报", snippet: "摘要" })
    );
  });

  it("缺套餐 key 不调用；有 key 才进入默认并行", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      hosts.push(new URL(String(input)).hostname);
      return jsonResponse(200, { organic: [], results: [], base_resp: { status_code: 0 } });
    });
    expect(defaultSearchProviders({}).map((fn) => fn.name)).toEqual(["any_search"]);
    await searchAll({ ANYSEARCH_API_KEY: "fake-any" }, "q", {
      providers: defaultSearchProviders({ ANYSEARCH_API_KEY: "fake-any" }),
    });
    expect(hosts.some((h) => h.includes("minimax") || h.includes("stepfun"))).toBe(false);

    hosts.length = 0;
    const names = defaultSearchProviders({
      MINIMAX_API_KEY: "fake-minimax",
      STEPFUN_API_KEY: "fake-step",
    }).map((fn) => fn.name);
    expect(names).toEqual(["any_search", "minimax_search", "stepfun_search"]);
  });

  it("单路失败不阻断其它源，进度能区分 MiniMax 与阶跃", async () => {
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = String(input);
      if (url.includes("coding_plan/search")) {
        return jsonResponse(500, { error: { message: "provider blew up request_id=req_9f2c" } });
      }
      if (url.includes("mcp/web_search/mcp")) {
        return jsonResponse(200, {
          result: {
            structuredContent: {
              results: [{ url: "https://step.example/ok", title: "阶跃来源", snippet: "ok" }],
            },
          },
        });
      }
      if (url.includes("api.anysearch.com")) {
        return jsonResponse(200, {
          result: {
            content: [{ type: "text", text: "\n### 1. Any\n- **URL**: https://any.example/ok\ndate: 2026-09-04\n摘要" }],
          },
        });
      }
      return jsonResponse(200, { items: [], results: [] });
    });

    const events: SearchProgressEvent[] = [];
    const result = await retrieveAtomSources(
      {
        QIHOO_360_API_KEY: "fake-360",
        METASO_API_KEY: "fake-metaso",
        TAVILY_API_KEY: "fake-tavily",
        EXA_API_KEY: "fake-exa",
        MINIMAX_API_KEY: "fake-minimax",
        STEPFUN_API_KEY: "fake-step",
      },
      "甘南所有景点一律免费",
      undefined,
      (event) => events.push(event)
    );

    expect(result._source).toBe("parallel-search");
    const done = events[events.length - 1];
    expect(done.providers.some((p) => p.id === "minimax_search" && p.label === "MiniMax Token Plan" && p.status === "failed")).toBe(
      true
    );
    expect(
      done.providers.some((p) => p.id === "stepfun_search" && p.label === "阶跃 Step Plan" && p.status === "completed")
    ).toBe(true);
    expect(done.sources?.some((s) => s.url === "https://step.example/ok")).toBe(true);
    const publicEvent = toPublicStreamEvent(done);
    const text = JSON.stringify(publicEvent);
    expect(text).not.toMatch(/fake-minimax|fake-step|Bearer|request_id|req_9f2c|Authorization/i);
    expect(text).toMatch(/MiniMax/);
    expect(text).toMatch(/阶跃 Step Plan/);
  });

  it("MiniMax 额度错误后同进程跳过该源", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return jsonResponse(402, { error: { message: "You exceeded your current quota" } });
    });
    await expect(
      callSearchProvider({ env: { MINIMAX_API_KEY: "fake-minimax" }, provider: "minimax_search", query: "q" })
    ).rejects.toThrow(/HTTP 402|quota/i);
    await expect(
      callSearchProvider({ env: { MINIMAX_API_KEY: "fake-minimax" }, provider: "minimax_search", query: "q" })
    ).rejects.toThrow(/额度耗尽，本进程已跳过/);
    expect(calls).toBe(1);
  });

  it("空结果不抛、目录不把套餐检索写成另购 Search API", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(200, { organic: [], base_resp: { status_code: 0, status_msg: "success" } })
    );
    const result = await callSearchProvider({
      env: { MINIMAX_API_KEY: "fake-minimax" },
      provider: "minimax_search",
      query: "q",
    });
    expect(result.sources).toEqual([]);
    const rows = listSearchProviders({ MINIMAX_API_KEY: "x", STEPFUN_API_KEY: "y" });
    for (const id of ["minimax_search", "stepfun_search"] as const) {
      const row = rows.find((item) => item.id === id);
      expect(row?.billing).toBe("included");
      expect(row?.signupUrl).toBeUndefined();
      expect(row?.hint).toMatch(/不需要单独的搜索密钥/);
    }
  });
});
