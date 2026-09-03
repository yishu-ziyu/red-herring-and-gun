import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp, DEFAULT_PORT } from "./app.js";

describe("server smoke", () => {
  it("defaults to port 3100", () => {
    expect(DEFAULT_PORT).toBe(3100);
  });

  it("GET /health returns { ok: true }", async () => {
    const server = createServer(createApp());
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
    }
  });
});
