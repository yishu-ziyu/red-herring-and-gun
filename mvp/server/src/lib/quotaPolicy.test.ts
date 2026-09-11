import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GUEST_DAILY_CHECKS } from "../../../src/lib/checkQuota.js";
import { peekCheckQuota, resetCheckQuotaForTests, setCheckQuotaEnforcedForTests } from "./checkQuota.js";
import { QUOTA_GATED_PATHS, isQuotaGatedPath, quotaGate } from "./quotaPolicy.js";

/**
 * 契约：`docs/evals/2026-09-11-health-probe-quota.md`
 *
 * 线上曾出现：访客只打开首页、一次调查都没发起，额度就归零。原因是输入页每次加载
 * 都会调 `/api/models/health` 探服务可用性，而该端点挂在配额闸后面，探针被当成一次核查记账。
 */
describe("quotaPolicy 计额度端点集合", () => {
  it("服务可用性探针不计入每日额度", () => {
    expect(isQuotaGatedPath("/api/models/health")).toBe(false);
  });

  it("只读模型列表、配额查询自身都不计入每日额度", () => {
    expect(isQuotaGatedPath("/api/models/list")).toBe(false);
    expect(isQuotaGatedPath("/api/checks/quota")).toBe(false);
  });

  it("真正发起核查的端点仍计入每日额度", () => {
    for (const path of ["/api/agent/orchestrate-stream", "/api/agent/batch", "/mcp"]) {
      expect(isQuotaGatedPath(path), path).toBe(true);
    }
  });

  it("未列出的路径一律不计额度（新增端点必须显式登记）", () => {
    expect(isQuotaGatedPath("/api/cases")).toBe(false);
    expect(isQuotaGatedPath("/health")).toBe(false);
  });

  it("闸门清单不含探针与只读端点", () => {
    for (const path of ["/api/models/health", "/api/models/list", "/api/checks/quota"]) {
      expect(QUOTA_GATED_PATHS as readonly string[], path).not.toContain(path);
    }
  });
});

describe("quotaGate 在真实 HTTP 上的行为", () => {
  const TEST_IP = "127.0.0.1";
  let server: ReturnType<typeof createServer>;
  let baseUrl = "";

  // 与 HTTP 请求同源同 IP，才能读到同一个访客桶
  const quotaView = () => peekCheckQuota({ headers: {}, socket: { remoteAddress: TEST_IP } });

  beforeEach(async () => {
    resetCheckQuotaForTests();
    setCheckQuotaEnforcedForTests(true);

    const app = express();
    app.get("/api/models/health", quotaGate("/api/models/health"), (_req, res) => {
      res.json({ status: "available" });
    });
    app.get("/api/agent/orchestrate-stream", quotaGate("/api/agent/orchestrate-stream"), (_req, res) => {
      res.json({ ok: true });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetCheckQuotaForTests();
  });

  it("加载首页触发的探针不消耗额度，重复加载也一样", async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${baseUrl}/api/models/health`);
      expect(response.status).toBe(200);
    }

    const quota = await quotaView();
    // remaining 已计入 inflight：探针若被挂闸，remaining 会立刻掉到 0，不必等 close 事件
    expect(quota.remaining).toBe(GUEST_DAILY_CHECKS);
    expect(quota.used).toBe(0);
  });

  it("真实核查端点仍消耗额度，额度用尽后返回 429", async () => {
    // 访客额度见 GUEST_DAILY_CHECKS（当前 2 条）。必须带着同一个访客 cookie 连查，
    // 才是在测「这个访客的额度」——不带 cookie 每次都是新访客，永远用不满。
    let cookie = "";
    const call = async () => {
      const response = await fetch(`${baseUrl}/api/agent/orchestrate-stream`, {
        headers: cookie ? { cookie } : {},
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie && !cookie) cookie = setCookie.split(";")[0] ?? "";
      return response;
    };

    for (let i = 0; i < GUEST_DAILY_CHECKS; i += 1) {
      const allowed = await call();
      expect(allowed.status, `第 ${i + 1} 次应放行`).toBe(200);
    }

    const blocked = await call();
    expect(blocked.status).toBe(429);

    // 读额度也要带同一个 cookie，否则读到的是另一个访客桶
    const quota = await peekCheckQuota({ headers: { cookie }, socket: { remoteAddress: TEST_IP } });
    expect(quota.remaining).toBe(0);
  });

  it("探针在核查额度用尽后依然可用（否则界面会谎报服务不可用）", async () => {
    await fetch(`${baseUrl}/api/agent/orchestrate-stream`);

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${baseUrl}/api/models/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "available" });
    }
  });
});
