import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createFakeLlm, type RunTurnDeps } from "@rhg/core";
import { createApp, DEFAULT_PORT } from "./app.js";
import { createQuota } from "./quota.js";
import { FileCaseStore } from "./store.js";
import { TurnRunner } from "./turns.js";

function smokeDeps(): RunTurnDeps {
  return {
    llm: createFakeLlm({}),
    searchProviders: [],
    tools: {
      search: async () => [],
      fetch: async () => {
        throw new Error("unused");
      },
    },
  };
}

describe("server smoke", () => {
  it("defaults to port 3100", () => {
    expect(DEFAULT_PORT).toBe(3100);
  });

  it("GET /api/search-providers 区分预置与收费源", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhg-search-cat-"));
    const store = new FileCaseStore(dir);
    const deps = smokeDeps();
    const turns = new TurnRunner(store, deps);
    const server = createServer(
      createApp({
        deps,
        store,
        turns,
        quota: createQuota({ limit: 0 }),
        operatorEnv: { TAVILY_API_KEY: "secret-should-not-leak" },
      }),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/search-providers`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as {
        providers: Array<{ id: string; billing: string; configured: boolean }>;
      };
      const any = body.providers.find((p) => p.id === "any_search");
      const tavily = body.providers.find((p) => p.id === "tavily_search");
      expect(any?.billing).toBe("included");
      expect(any?.configured).toBe(true);
      expect(tavily?.billing).toBe("byo");
      expect(tavily?.configured).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/secret-should-not-leak/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /health returns { ok: true }", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhg-health-"));
    const store = new FileCaseStore(dir);
    const deps = smokeDeps();
    const turns = new TurnRunner(store, deps);
    const server = createServer(
      createApp({ deps, store, turns, quota: createQuota({ limit: 0 }) }),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
