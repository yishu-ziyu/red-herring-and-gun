import { afterEach, describe, expect, it, vi } from "vitest";
import { toPublicStreamEvent } from "../handlers";
import {
  callSearchProvider,
  resetSearchQuotaSkipForTests,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "./searchProviders";

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

describe("MiniMax / 阶跃套餐搜索（mvp 镜像）", () => {
  it("MiniMax Bearer POST /v1/coding_plan/search，解析 organic.link", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return jsonResponse(200, {
        organic: [{ title: "页", link: "https://example.gov/a", snippet: "摘", date: "2026-09-01" }],
        base_resp: { status_code: 0, status_msg: "success" },
      });
    });
    const result = await callSearchProvider({
      env: { MINIMAX_API_KEY: "fake-minimax", MINIMAX_BASE_URL: "https://api.minimaxi.com/anthropic" },
      provider: "minimax_search",
      query: "q",
    });
    expect(seen[0]?.url).toBe("https://api.minimaxi.com/v1/coding_plan/search");
    expect(seen[0]?.headers.Authorization).toBe("Bearer fake-minimax");
    expect(seen[0]?.body).toEqual({ q: "q" });
    expect(result.sources[0]).toEqual(
      expect.objectContaining({ url: "https://example.gov/a", title: "页", snippet: "摘", publishedAt: "2026-09-01" })
    );
  });

  it("阶跃 MCP web_search，不打未公开的 /step_plan/v1/search", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      urls.push(String(input));
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      expect(body?.method).toBe("tools/call");
      expect(body?.params?.name).toBe("web_search");
      return jsonResponse(200, {
        result: {
          structuredContent: {
            results: [{ url: "https://example.gov/b", title: "通报", snippet: "摘要", time: "2026-01-02", content: "正文" }],
          },
        },
      });
    });
    const result = await callSearchProvider({
      env: { STEPFUN_API_KEY: "fake-step", STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan" },
      provider: "stepfun_search",
      query: "q",
    });
    expect(urls).toEqual(["https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp"]);
    expect(result.sources[0]).toEqual(
      expect.objectContaining({
        url: "https://example.gov/b",
        title: "通报",
        snippet: "摘要",
        publishedAt: "2026-01-02",
      })
    );
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
    expect(urls).toEqual(Array(4).fill("https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp"));
  });

  it("缺 key 不进入并行矩阵；有 key 时进度能区分两路", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = String(input);
      hosts.push(new URL(url).hostname);
      if (url.includes("coding_plan/search")) {
        return jsonResponse(200, {
          organic: [{ title: "mm", link: "https://mm.example/a", snippet: "s" }],
          base_resp: { status_code: 0 },
        });
      }
      if (url.includes("mcp/web_search/mcp")) {
        return jsonResponse(200, {
          result: { structuredContent: { results: [{ url: "https://st.example/a", title: "st", snippet: "s" }] } },
        });
      }
      if (url.includes("api.anysearch.com")) {
        return jsonResponse(200, {
          result: { content: [{ type: "text", text: "\n### 1. Any\n- **URL**: https://any.example/a\n摘要" }] },
        });
      }
      return jsonResponse(200, { items: [], results: [] });
    });

    const without: SearchProgressEvent[] = [];
    await retrieveAtomSources(
      { QIHOO_360_API_KEY: "fake-360", METASO_API_KEY: "m", TAVILY_API_KEY: "t", EXA_API_KEY: "e" },
      "甘南所有景点一律免费",
      undefined,
      (event) => without.push(event)
    );
    expect(without[0]?.providers.map((p) => p.id)).toEqual([
      "360_search",
      "any_search",
      "metaso_search",
      "tavily_search",
      "exa_search",
    ]);
    expect(hosts.some((h) => h.includes("minimax") || h.includes("stepfun"))).toBe(false);

    hosts.length = 0;
    const withKeys: SearchProgressEvent[] = [];
    const result = await retrieveAtomSources(
      {
        QIHOO_360_API_KEY: "fake-360",
        METASO_API_KEY: "m",
        TAVILY_API_KEY: "t",
        EXA_API_KEY: "e",
        MINIMAX_API_KEY: "fake-minimax",
        STEPFUN_API_KEY: "fake-step",
      },
      "甘南所有景点一律免费",
      undefined,
      (event) => withKeys.push(event)
    );
    const done = withKeys[withKeys.length - 1];
    expect(done.providers.some((p) => p.id === "minimax_search" && p.label === "MiniMax Token Plan")).toBe(true);
    expect(done.providers.some((p) => p.id === "stepfun_search" && p.label === "阶跃 Step Plan")).toBe(true);
    expect(result.sources.some((s: { url?: string }) => s.url === "https://mm.example/a")).toBe(true);
    expect(result.sources.some((s: { url?: string }) => s.url === "https://st.example/a")).toBe(true);
    const text = JSON.stringify(toPublicStreamEvent(done));
    expect(text).not.toMatch(/fake-minimax|fake-step|Bearer|Authorization/i);
  });
});
