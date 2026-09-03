import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webFetch } from "./webFetch.js";

vi.mock("./ssrfGuard.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./ssrfGuard.js")>();
  return {
    ...orig,
    blockedFetchReason: async (url: string) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "127.0.0.1" && parsed.port !== "" && parsed.port !== "80") {
          return undefined;
        }
      } catch {
        /* fall through */
      }
      return orig.blockedFetchReason(url);
    },
  };
});

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

describe("webFetch", () => {
  let port = 0;
  let base = "";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
    if (path === "/gov-notice.html") {
      send(res, 200, "text/html; charset=utf-8", load("gov-notice.html"));
      return;
    }
    if (path === "/central-media.html") {
      send(res, 200, "text/html; charset=utf-8", load("central-media.html"));
      return;
    }
    if (path === "/redirect-gov") {
      res.statusCode = 301;
      res.setHeader("Location", "/gov-notice.html");
      res.end();
      return;
    }
    if (path === "/r1") {
      res.statusCode = 301;
      res.setHeader("Location", "/r2");
      res.end();
      return;
    }
    if (path === "/r2") {
      res.statusCode = 301;
      res.setHeader("Location", "/r3");
      res.end();
      return;
    }
    if (path === "/r3") {
      res.statusCode = 301;
      res.setHeader("Location", "/r4");
      res.end();
      return;
    }
    if (path === "/r4") {
      res.statusCode = 301;
      res.setHeader("Location", "/r5");
      res.end();
      return;
    }
    if (path === "/sleep") {
      const timer = setTimeout(() => send(res, 200, "text/plain", "late"), 10_000);
      req.on("close", () => clearTimeout(timer));
      return;
    }
    if (path === "/huge") {
      send(res, 200, "text/html; charset=utf-8", `<html><body>${"x".repeat(50_000)}</body></html>`);
      return;
    }
    if (path === "/pdf") {
      send(res, 200, "application/pdf", "%PDF-1.4 fake");
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("正常 HTML 抽取 title / publishedAt / links / text 有换行", async () => {
    const page = await webFetch(`${base}/gov-notice.html`);
    expect(page.reachable).toBe(true);
    expect(page.status).toBe(200);
    expect(page.title).toBe("国务院办公厅关于进一步优化政务服务的通知");
    expect(page.publishedAt).toBe("2024-03-12");
    expect(page.text).toContain("\n");
    expect(page.text).toContain("国办发〔2024〕12号");
    const media = await webFetch(`${base}/central-media.html`);
    expect(media.links).toContain("https://www.gov.cn/zhengce/content/2024-03/12/content_gov12.htm");
  });

  it("301 → 200 跟随", async () => {
    const page = await webFetch(`${base}/redirect-gov`);
    expect(page.reachable).toBe(true);
    expect(page.status).toBe(200);
    expect(page.finalUrl).toBe(`${base}/gov-notice.html`);
    expect(page.title).toContain("优化政务服务");
  });

  it("4 跳重定向失败", async () => {
    const page = await webFetch(`${base}/r1`);
    expect(page.reachable).toBe(false);
    expect(page.error).toMatch(/too many redirects/);
  });

  it("超时返回 reachable:false", async () => {
    const page = await webFetch(`${base}/sleep`, { timeoutMs: 80 });
    expect(page.reachable).toBe(false);
    expect(page.error).toBeTruthy();
  });

  it("超 maxBytes 截断", async () => {
    const page = await webFetch(`${base}/huge`, { maxBytes: 1024 });
    expect(page.reachable).toBe(true);
    expect(page.truncated).toBe(true);
    expect((page.html ?? "").length).toBeLessThanOrEqual(1024);
  });

  it("非 HTML application/pdf 不抽正文", async () => {
    const page = await webFetch(`${base}/pdf`);
    expect(page.reachable).toBe(true);
    expect(page.contentType).toMatch(/application\/pdf/);
    expect(page.text).toBe("");
    expect(page.html).toBeUndefined();
  });

  it("SSRF 拦截 127.0.0.1 / 10.0.0.1 / 169.254.169.254 且不发请求", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch should not be called");
    });
    try {
      for (const url of ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/"]) {
        const page = await webFetch(url);
        expect(page.reachable).toBe(false);
        expect(page.error).toMatch(/ssrf/);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
