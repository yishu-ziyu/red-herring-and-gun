/**
 * search_progress（SSE 多路检索进度）单测：全部走 stub fetch，零真实外呼。
 * 覆盖 7 个必测用例：全成功 / 3 成 2 败 / 跨 provider 共源 / 同 provider 双 query 共源 /
 * 全空 / 全败 / 完成顺序 ≠ 启动顺序；另验 SSE 出口无密钥与诊断泄漏。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetSearchQuotaSkipForTests,
  retrieveAtomSources,
  type SearchProgressEvent,
} from "./searchProviders";
import { toPublicStreamEvent } from "../text/toPublicStreamEvent";

const ATOM = "甘南所有景点一律免费";

/** 五个 provider 都要求 key（any_search 除外）：给假 key 才能走到 fetch（fetch 已被 stub，不外呼）。 */
const ENV: Record<string, string> = {
  QIHOO_360_API_KEY: "fake-360",
  METASO_API_KEY: "fake-metaso",
  TAVILY_API_KEY: "fake-tavily",
  EXA_API_KEY: "fake-exa",
};

const PROVIDER_HOSTS: Record<string, string> = {
  "api.360.cn": "360_search",
  "api.anysearch.com": "any_search",
  "metaso.cn": "metaso_search",
  "api.tavily.com": "tavily_search",
  "api.exa.ai": "exa_search",
};

type ProviderSpec = { fail?: boolean; urls?: string[] };
type StubOptions = {
  byProvider?: Record<string, ProviderSpec | ((query: string) => ProviderSpec)>;
  gates?: Record<string, Promise<void>>;
  started?: Record<string, () => void>;
};

function providerOfUrl(url: string): string {
  const host = new URL(url).hostname;
  const id = PROVIDER_HOSTS[host];
  if (!id) throw new Error(`unexpected fetch host: ${host}`);
  return id;
}

function providerResponse(provider: string, urls: string[]) {
  const items = urls.map((url, i) => ({ title: `标题 ${url}`, url, snippet: `摘要 ${i}` }));
  switch (provider) {
    case "360_search":
      return { items };
    case "any_search": {
      // 解析器按 /\n###\s+\d+\.\s+/ 切段：每段必须以换行 + "### n." 开头
      const text = urls
        .map((url, i) => `\n### ${i + 1}. 标题 ${url}\n- **URL**: ${url}\ndate: 2026-01-0${i}\n摘要 ${i}`)
        .join("");
      return { result: { content: [{ type: "text", text }] } };
    }
    case "metaso_search":
      return { data: { webpages: items } };
    case "tavily_search":
      // request_id 故意混入响应：验证它绝不进 SSE 事件
      return { answer: "tavily answer", request_id: "req_secret_123", results: items };
    case "exa_search":
      return { requestId: "exa_req_secret", results: items.map((s) => ({ ...s, highlights: [s.snippet] })) };
    default:
      throw new Error(provider);
  }
}

function installFetchStub(options: StubOptions) {
  const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const provider = providerOfUrl(url);
    options.started?.[provider]?.();
    let query = new URL(url).searchParams.get("q") ?? new URL(url).searchParams.get("query") ?? "";
    if (!query && typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, any>;
        query = String(body.query ?? body.q ?? body.params?.arguments?.query ?? "");
      } catch {
        query = "";
      }
    }
    const specOrFn = options.byProvider?.[provider];
    const spec = (typeof specOrFn === "function" ? specOrFn(query) : specOrFn) ?? {};
    if (options.gates?.[provider]) await options.gates[provider];
    if (spec.fail) {
      // 模拟 provider 侧 500 + 原始诊断（含 request_id 形状）：绝不进 SSE 事件
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: { message: `provider ${provider} blew up request_id=req_9f2c` } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => providerResponse(provider, spec.urls ?? []),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ALL_PROVIDERS = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"];

function eachProviderUrls(urls: string[]): Record<string, ProviderSpec> {
  return Object.fromEntries(ALL_PROVIDERS.map((p, i) => [p, { urls: [`${urls[i % urls.length]}?p=${p}`] }]));
}

function collectProgress(): { events: SearchProgressEvent[]; onProgress: (e: SearchProgressEvent) => void } {
  const events: SearchProgressEvent[] = [];
  return { events, onProgress: (e) => events.push(e) };
}

const statusOf = (event: SearchProgressEvent, provider: string) =>
  event.providers.find((p) => p.id === provider)?.status;

afterEach(() => {
  resetSearchQuotaSkipForTests();
  vi.unstubAllGlobals();
});

describe("retrieveAtomSources — search_progress 事件", () => {
  it("用例1：5 路全成功 → started/progress/completed，completed 带全量统计", async () => {
    installFetchStub({ byProvider: eachProviderUrls(["https://a.test/x", "https://b.test/y"]) });
    const { events, onProgress } = collectProgress();
    const result = await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    expect(result._source).toBe("parallel-search");
    expect(events[0].phase).toBe("started");
    expect(events[0].providers.every((p) => p.status === "pending" && p.resultCount === 0)).toBe(true);
    expect(events[0].queryCount).toBe(2);
    const done = events[events.length - 1];
    expect(done.phase).toBe("completed");
    expect(done.providers.every((p) => p.status === "completed")).toBe(true);
    // 2 query × 5 provider × 1 条 = 10 raw；5 个不同 URL 去重后 unique=5，全部单源
    expect(done.stats).toEqual({
      rawResultCount: 10,
      uniqueSourceCount: 5,
      sharedSourceCount: 0,
      singleProviderSourceCount: 5,
    });
    expect(done.sources).toHaveLength(5);
    // 2 query × 5 provider × (running+completed) = 20 progress 帧
    expect(events.filter((e) => e.phase === "progress").length).toBe(20);
  });

  it("用例2：3 成功 2 失败 → partial/failed 状态，其余不被取消，检索继续成功", async () => {
    installFetchStub({
      byProvider: {
        ...eachProviderUrls(["https://a.test/x", "https://b.test/y"]),
        // tavily 只在第二路（辟谣）query 失败 → partial；exa 两路全失败 → failed
        tavily_search: (query) => ({
          fail: query.includes("辟谣"),
          urls: ["https://b.test/y?p=tavily_search"],
        }),
        exa_search: { fail: true },
      },
    });
    const { events, onProgress } = collectProgress();
    const result = await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    expect(result._source).toBe("parallel-search");
    const done = events[events.length - 1];
    expect(done.phase).toBe("completed");
    expect(statusOf(done, "tavily_search")).toBe("partial");
    expect(statusOf(done, "exa_search")).toBe("failed");
    expect(statusOf(done, "360_search")).toBe("completed");
    expect(statusOf(done, "any_search")).toBe("completed");
    expect(statusOf(done, "metaso_search")).toBe("completed");
    expect(done.stats).toEqual({
      rawResultCount: 7,
      uniqueSourceCount: 4,
      sharedSourceCount: 0,
      singleProviderSourceCount: 4,
    });
    // 失败诊断绝不进事件
    expect(JSON.stringify(done)).not.toMatch(/blew up|request_id|req_9f2c/i);
  });

  it("用例3：同一 URL 被两个 provider 命中 → sharedSourceCount 计 1，providerOrigins 含两家", async () => {
    const shared = "https://www.piyao.org.cn/hefei";
    installFetchStub({
      byProvider: {
        "360_search": { urls: [shared, "https://a.test/only360"] },
        tavily_search: { urls: [`${shared}?utm_source=x`, "https://b.test/onlytavily"] },
        any_search: { urls: [] },
        metaso_search: { urls: [] },
        exa_search: { urls: [] },
      },
    });
    const { events, onProgress } = collectProgress();
    await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    const done = events[events.length - 1];
    expect(done.stats).toEqual({
      rawResultCount: 8,
      uniqueSourceCount: 3,
      sharedSourceCount: 1,
      singleProviderSourceCount: 2,
    });
    const sharedSources = done.sources!.filter((s) => s.url.startsWith(shared));
    expect(sharedSources).toHaveLength(1); // 规范化后合并成一条
    expect(sharedSources[0].providerOrigins.slice().sort()).toEqual(["360_search", "tavily_search"]);
  });

  it("用例4：同一 provider 的两路 query 命中同一 URL → 不算 shared", async () => {
    const url = "https://a.test/same";
    installFetchStub({
      byProvider: {
        tavily_search: { urls: [url] },
        "360_search": { urls: [] },
        any_search: { urls: [] },
        metaso_search: { urls: [] },
        exa_search: { urls: [] },
      },
    });
    const { events, onProgress } = collectProgress();
    await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    const done = events[events.length - 1];
    expect(done.stats).toEqual({
      rawResultCount: 2,
      uniqueSourceCount: 1,
      sharedSourceCount: 0,
      singleProviderSourceCount: 1,
    });
    expect(done.sources![0].providerOrigins).toEqual(["tavily_search"]);
  });

  it("用例5：全部 provider 返回空数组 → 成功收束、统计全 0、无来源", async () => {
    installFetchStub({ byProvider: Object.fromEntries(ALL_PROVIDERS.map((p) => [p, { urls: [] }])) });
    const { events, onProgress } = collectProgress();
    const result = await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    expect(result._source).toBe("parallel-search");
    expect((result.sources as unknown[])).toEqual([]);
    const done = events[events.length - 1];
    expect(done.phase).toBe("completed");
    expect(done.providers.every((p) => p.status === "completed" && p.resultCount === 0)).toBe(true);
    expect(done.stats).toEqual({
      rawResultCount: 0,
      uniqueSourceCount: 0,
      sharedSourceCount: 0,
      singleProviderSourceCount: 0,
    });
    expect(done.sources).toEqual([]);
  });

  it("用例6：全部 provider 失败 → completed 帧全 failed，兜底结果不变", async () => {
    installFetchStub({ byProvider: Object.fromEntries(ALL_PROVIDERS.map((p) => [p, { fail: true }])) });
    const { events, onProgress } = collectProgress();
    const result = await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    expect(result._source).toBe("tool-error");
    const done = events[events.length - 1];
    expect(done.phase).toBe("completed");
    expect(done.providers.every((p) => p.status === "failed")).toBe(true);
    expect(done.stats).toEqual({
      rawResultCount: 0,
      uniqueSourceCount: 0,
      sharedSourceCount: 0,
      singleProviderSourceCount: 0,
    });
    expect(done.sources).toEqual([]);
    expect(JSON.stringify(done)).not.toMatch(/blew up|api.?key|Bearer/i);
  });

  it("用例7：完成顺序 ≠ 启动顺序 → progress 帧按真实完成先后上报", async () => {
    let releaseTavily: () => void = () => {};
    const tavilyGate = new Promise<void>((resolve) => {
      releaseTavily = resolve;
    });
    const startedOrder: string[] = [];
    installFetchStub({
      byProvider: eachProviderUrls(["https://a.test/x"]),
      gates: { tavily_search: tavilyGate },
      started: Object.fromEntries(
        ALL_PROVIDERS.map((p) => [p, () => startedOrder.push(p)])
      ) as Record<string, () => void>,
    });
    const { events, onProgress } = collectProgress();
    const search = retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    // 等 tavily 真正开始（保持 running），其余 4 路自然完成
    while (!startedOrder.includes("tavily_search")) await Promise.resolve();
    while (!events.some((e) => statusOf(e, "360_search") === "completed")) await Promise.resolve();
    releaseTavily();
    await search;

    expect(startedOrder[0]).toBe("360_search"); // 启动顺序固定
    const firstDoneIndex = events.findIndex((e) => statusOf(e, "360_search") === "completed");
    const tavilyDoneIndex = events.findIndex((e) => statusOf(e, "tavily_search") === "completed");
    expect(firstDoneIndex).toBeLessThan(tavilyDoneIndex); // 完成顺序与启动顺序不同
    const done = events[events.length - 1];
    expect(done.phase).toBe("completed");
    expect(done.providers.every((p) => p.status === "completed")).toBe(true);
    expect(done.stats!.rawResultCount).toBe(10);
  });

  it("统计不受 24 条公开来源展示上限污染", async () => {
    const calls = new Map<string, number>();
    installFetchStub({
      byProvider: Object.fromEntries(
        ALL_PROVIDERS.map((provider) => [
          provider,
          () => {
            const call = (calls.get(provider) ?? 0) + 1;
            calls.set(provider, call);
            return {
              urls: Array.from(
                { length: 3 },
                (_, index) => `https://sources.test/${provider}/${call}/${index}`
              ),
            };
          },
        ])
      ),
    });
    const { events, onProgress } = collectProgress();
    await retrieveAtomSources(ENV, ATOM, undefined, onProgress);

    const done = events[events.length - 1];
    expect(done.stats).toEqual({
      rawResultCount: 30,
      uniqueSourceCount: 30,
      sharedSourceCount: 0,
      singleProviderSourceCount: 30,
    });
    // SSE 来源清单可以限长，但统计必须来自限长前的完整结果集。
    expect(done.sources).toHaveLength(24);
  });

  it("SSE 出口：search_progress 经 toPublicStreamEvent 后只剩产品字段", async () => {
    installFetchStub({ byProvider: eachProviderUrls(["https://a.test/x"]) });
    const { events, onProgress } = collectProgress();
    await retrieveAtomSources({ ...ENV, TAVILY_API_KEY: "sk-secret-key" }, ATOM, undefined, onProgress);

    const done = toPublicStreamEvent(events[events.length - 1]);
    const text = JSON.stringify(done);
    expect(text).not.toMatch(/sk-secret|api.?key|Bearer|request_id|req_secret|Error|at\s+\w/i);
    expect(done.type).toBe("search_progress");
    expect((done.providers as Array<Record<string, unknown>>).length).toBe(5);
    expect(done.stats).toBeDefined();
    expect(done.sources).toBeDefined();
  });
});
