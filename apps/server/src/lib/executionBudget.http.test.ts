// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callAgentWithFallback, resetProviderQuotaSkipForTests } from "./providerRouter.js";
import { callByoAgent } from "./orchestrateByo.js";
import { callSearchProvider, resetSearchQuotaSkipForTests } from "./searchProviders.js";

const nativeFetch = globalThis.fetch;
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

async function stalled(headers: boolean) {
  let acknowledge: () => void = () => {};
  let close: () => void = () => {};
  let requests = 0;
  const received = new Promise<void>((resolve) => { acknowledge = resolve; });
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const server = createServer((req, res) => {
    requests++;
    req.resume();
    res.on("close", close);
    if (headers) { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); }
    acknowledge();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Every network call is redirected to this local test server. No provider is contacted.
  vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => nativeFetch(base, init));
  return { received, closed, requests: () => requests };
}

async function closesPromptly(closed: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([closed, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("upstream still connected after cancellation")), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

describe("real HTTP sockets close on cancellation", () => {
  for (const target of ["provider", "byo", "search"] as const) {
    for (const headers of [false, true]) {
      it(`${target}: abort ${headers ? "during body" : "before headers"} closes the socket`, async () => {
        resetProviderQuotaSkipForTests(); resetSearchQuotaSkipForTests();
        const upstream = await stalled(headers);
        const ac = new AbortController();
        const result = target === "provider"
          ? callAgentWithFallback({
              systemPrompt: "json", userContent: "test", responseSchema: {}, maxTokens: 10,
              codexBin: "never-run", env: { MINIMAX_API_KEY: "test", ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax" },
              options: { signal: ac.signal },
            })
          : target === "byo"
            ? callByoAgent({
                byo: { baseUrl: "https://test.invalid/v1", apiKey: "test", modelName: "test" },
                systemPrompt: "json", userContent: "test", maxTokens: 10, timeoutMs: 3000, signal: ac.signal,
              })
            : callSearchProvider({
                env: { MINIMAX_API_KEY: "test" }, provider: "minimax_search", query: "test", signal: ac.signal,
              });
        const rejected = expect(result).rejects.toThrow("user-stop");
        await upstream.received;
        ac.abort(new Error("user-stop"));
        await rejected;
        await closesPromptly(upstream.closed);
        expect(upstream.requests()).toBe(1);
      });
    }
  }
});
