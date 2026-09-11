import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestCode, resetForTests, verifyAndCreate } from "./accountStore.js";
import {
  beginFreeCheck,
  commitFreeCheck,
  gateFreeCheck,
  peekCheckQuota,
  releaseFreeCheck,
  resetCheckQuotaForTests,
  setCheckQuotaEnforcedForTests,
} from "./checkQuota.js";
import { checksExhaustedMessage } from "../../../src/lib/checkQuota.js";
import { encodeSignedJson as sign } from "./aipingAuth.js";
import { EMAIL_SESSION_COOKIE } from "./emailSession.js";

const SECRET = "test-server-secret-for-check-quota";

function mockReq(cookie = "", ip = "127.0.0.1", extraHeaders: Record<string, string> = {}) {
  const listeners = new Map<string, Array<() => void>>();
  return {
    headers: { cookie, ...extraHeaders },
    socket: { remoteAddress: ip },
    on(event: string, fn: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };
}

function mockRes() {
  const headers: Record<string, string | string[]> = {};
  return {
    statusCode: 200,
    body: null as unknown,
    headersSent: false,
    headers,
    setHeader(key: string, value: string | string[]) {
      this.headers[key] = value;
    },
    getHeader(key: string) {
      return this.headers[key];
    },
    end(payload?: string) {
      this.headersSent = true;
      if (payload) this.body = JSON.parse(payload);
    },
  };
}

async function loginCookie(email: string) {
  const req = await requestCode(email, SECRET);
  const verify = await verifyAndCreate(email, req.code!, SECRET);
  const token = sign({ sid: verify.sessionId }, SECRET);
  return `${EMAIL_SESSION_COOKIE}=${token}`;
}

describe("checkQuota", () => {
  beforeEach(() => {
    resetForTests();
    resetCheckQuotaForTests();
    setCheckQuotaEnforcedForTests(true);
    process.env.AIPING_SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a guest two free checks per Shanghai day", async () => {
    const req = mockReq();
    const first = mockRes();
    const peek = await peekCheckQuota(req);
    expect(peek).toEqual({ remaining: 2, total: 2, used: 0, kind: "guest", enforced: true });

    const begun = await beginFreeCheck(req, first);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    commitFreeCheck(first, begun.ticket);

    const cookie = String(first.headers["Set-Cookie"] ?? "").split(";")[0];

    // 用掉一次后还剩一次
    const afterFirst = await peekCheckQuota(mockReq(cookie));
    expect(afterFirst).toEqual({ remaining: 1, total: 2, used: 1, kind: "guest", enforced: true });

    // 第二次仍然放行，用满后才拦
    const secondRes = mockRes();
    const second = await beginFreeCheck(mockReq(cookie, "127.0.0.1"), secondRes);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    commitFreeCheck(secondRes, second.ticket);

    const afterSecond = await peekCheckQuota(mockReq(cookie));
    expect(afterSecond.remaining).toBe(0);
    expect(afterSecond.kind).toBe("guest");

    const blocked = mockRes();
    const third = await beginFreeCheck(mockReq(cookie, "127.0.0.1"), blocked);
    expect(third.ok).toBe(false);
  });

  it("does not block a second guest on the same IP — IP 是共享的", async () => {
    const firstReq = mockReq("", "10.0.0.8");
    const firstRes = mockRes();
    const begun = await beginFreeCheck(firstReq, firstRes);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    commitFreeCheck(firstRes, begun.ticket);

    // 同一 IP、干净 cookie 的第二个人必须能查，且不能继承前一个人的用量
    const secondReq = mockReq("", "10.0.0.8");
    const secondPeek = await peekCheckQuota(secondReq);
    expect(secondPeek).toMatchObject({ remaining: 2, used: 0, kind: "guest", enforced: true });

    const second = await beginFreeCheck(secondReq, mockRes());
    expect(second.ok).toBe(true);
  });

  it("still enforces an IP-wide ceiling so 清 cookie 不能无限刷", async () => {
    process.env.CHECK_QUOTA_IP_LIMIT = "2";
    try {
      const commitFrom = async () => {
        const res = mockRes();
        const begun = await beginFreeCheck(mockReq("", "10.0.0.9"), res);
        expect(begun.ok).toBe(true);
        if (!begun.ok) return;
        commitFreeCheck(res, begun.ticket);
      };

      await commitFrom();
      await commitFrom();

      // 第 3 个人即使 cookie 全新，也被 IP 天花板拦住
      const third = await beginFreeCheck(mockReq("", "10.0.0.9"), mockRes());
      expect(third.ok).toBe(false);
    } finally {
      delete process.env.CHECK_QUOTA_IP_LIMIT;
    }
  });

  it("honors CHECK_QUOTA_GUEST_LIMIT 覆盖（测试期放宽用）", async () => {
    process.env.CHECK_QUOTA_GUEST_LIMIT = "5";
    try {
      const peek = await peekCheckQuota(mockReq("", "10.0.0.10"));
      expect(peek).toEqual({ remaining: 5, total: 5, used: 0, kind: "guest", enforced: true });
    } finally {
      delete process.env.CHECK_QUOTA_GUEST_LIMIT;
    }
  });

  it("does not trust the first X-Forwarded-For hop", async () => {
    // 判据用 IP 天花板（设成 1）：只要落到同一条 IP 键上就会被拦，与单人额度无关。
    process.env.CHECK_QUOTA_IP_LIMIT = "1";
    try {
      const firstReq = mockReq("", "9.9.9.9", { "x-forwarded-for": "1.1.1.1, 8.8.8.8" });
      const firstRes = mockRes();
      const begun = await beginFreeCheck(firstReq, firstRes);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      commitFreeCheck(firstRes, begun.ticket);

      // 改掉首跳、末跳不变 → 仍是同一条 IP 键 → 被拦（证明没有信首跳）
      const spoofedFirstHop = await beginFreeCheck(
        mockReq("", "9.9.9.9", { "x-forwarded-for": "2.2.2.2, 8.8.8.8" }),
        mockRes()
      );
      expect(spoofedFirstHop.ok).toBe(false);

      // 换掉末跳 → 换了一条 IP 键 → 放行
      const otherLastHop = await beginFreeCheck(
        mockReq("", "9.9.9.9", { "x-forwarded-for": "1.1.1.1, 7.7.7.7" }),
        mockRes()
      );
      expect(otherLastHop.ok).toBe(true);
    } finally {
      delete process.env.CHECK_QUOTA_IP_LIMIT;
    }
  });

  it("prefers X-Real-IP over X-Forwarded-For", async () => {
    process.env.CHECK_QUOTA_IP_LIMIT = "1";
    try {
      const firstReq = mockReq("", "9.9.9.9", {
        "x-real-ip": "10.0.0.5",
        "x-forwarded-for": "1.1.1.1, 8.8.8.8",
      });
      const firstRes = mockRes();
      const begun = await beginFreeCheck(firstReq, firstRes);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      commitFreeCheck(firstRes, begun.ticket);

      // X-Real-IP 不变、XFF 变 → 仍是同一条键 → 被拦（证明以 X-Real-IP 为准）
      const sameRealIp = await beginFreeCheck(
        mockReq("", "9.9.9.9", { "x-real-ip": "10.0.0.5", "x-forwarded-for": "3.3.3.3" }),
        mockRes()
      );
      expect(sameRealIp.ok).toBe(false);

      // X-Real-IP 变了 → 新键 → 放行
      const otherRealIp = await beginFreeCheck(
        mockReq("", "9.9.9.9", { "x-real-ip": "10.0.0.6", "x-forwarded-for": "1.1.1.1, 8.8.8.8" }),
        mockRes()
      );
      expect(otherRealIp.ok).toBe(true);
    } finally {
      delete process.env.CHECK_QUOTA_IP_LIMIT;
    }
  });

  it("releases a guest slot when the run fails before a verdict", async () => {
    const req = mockReq();
    const res = mockRes();
    const begun = await beginFreeCheck(req, res);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    releaseFreeCheck(begun.ticket);
    const peek = await peekCheckQuota(req);
    expect(peek.remaining).toBe(2);
  });

  it("lets a logged-in account check three times", async () => {
    const cookie = await loginCookie("user@example.com");
    const req = mockReq(cookie);
    const peek = await peekCheckQuota(req);
    expect(peek).toEqual({ remaining: 3, total: 3, used: 0, kind: "account", enforced: true });

    for (let i = 0; i < 3; i += 1) {
      const res = mockRes();
      const begun = await beginFreeCheck(req, res);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      commitFreeCheck(res, begun.ticket);
    }
    expect((await peekCheckQuota(req)).remaining).toBe(0);
    const blocked = await beginFreeCheck(req, mockRes());
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.kind).toBe("account");
  });

  it("writes checks_exhausted without leaking provider words", async () => {
    const req = mockReq();
    const first = mockRes();
    const begun = await beginFreeCheck(req, first);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    commitFreeCheck(first, begun.ticket);

    // 访客额度是 2，要把两次用满才会被 429 拦住。
    // 第二次必须带上同一个 cookie —— 不带就是另一个访客桶，用不满。
    const cookie = String(first.headers["Set-Cookie"] ?? "").split(";")[0];
    const secondReq = mockReq(cookie);
    const secondRes = mockRes();
    const second = await beginFreeCheck(secondReq, secondRes);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    commitFreeCheck(secondRes, second.ticket);

    const blocked = mockRes();
    const ticket = await gateFreeCheck(mockReq(cookie), blocked);
    expect(ticket).toBeNull();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({
      error: "checks_exhausted",
      message: checksExhaustedMessage("guest"),
    });
    expect(JSON.stringify(blocked.body)).not.toMatch(/quota|token|BYOK/i);
  });

  it("does not consume or block checks while developing", async () => {
    setCheckQuotaEnforcedForTests(false);
    const req = mockReq();
    expect(await peekCheckQuota(req)).toMatchObject({ remaining: 2, used: 0, kind: "guest", enforced: false });

    for (let i = 0; i < 5; i += 1) {
      const res = mockRes();
      const begun = await beginFreeCheck(req, res);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      commitFreeCheck(res, begun.ticket);
    }

    expect(await peekCheckQuota(req)).toMatchObject({ remaining: 2, used: 0, enforced: false });
    const ticket = await gateFreeCheck(req, mockRes());
    expect(ticket).not.toBeNull();
  });

  it("ops bypass token lets owners check without consuming guest quota", async () => {
    process.env.OPS_CHECK_BYPASS_TOKEN = "ops-secret-token";
    try {
      const req = mockReq("", "203.0.113.9", { "x-ops-check-token": "ops-secret-token" });
      const peek = await peekCheckQuota(req);
      expect(peek).toMatchObject({ used: 0, kind: "guest", enforced: false });

      for (let i = 0; i < 3; i += 1) {
        const res = mockRes();
        const begun = await beginFreeCheck(req, res);
        expect(begun.ok).toBe(true);
        if (!begun.ok) return;
        expect(begun.ticket.settled).toBe(true);
        commitFreeCheck(res, begun.ticket);
      }

      // 同 IP 的普通游客不受旁路影响：额度独立计数
      const plain = await peekCheckQuota(mockReq("", "203.0.113.9"));
      expect(plain).toMatchObject({ remaining: 2, used: 0, enforced: true });
    } finally {
      delete process.env.OPS_CHECK_BYPASS_TOKEN;
    }
  });

  it("without OPS_CHECK_BYPASS_TOKEN configured the bypass header does nothing", async () => {
    delete process.env.OPS_CHECK_BYPASS_TOKEN;
    const req = mockReq("", "203.0.113.10", { "x-ops-check-token": "anything" });
    const peek = await peekCheckQuota(req);
    expect(peek).toMatchObject({ remaining: 2, enforced: true });
    const res = mockRes();
    const begun = await beginFreeCheck(req, res);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.ticket.settled).toBe(false);
  });

  it("a wrong ops token does not bypass", async () => {
    process.env.OPS_CHECK_BYPASS_TOKEN = "ops-secret-token";
    try {
      const req = mockReq("", "203.0.113.11", { "x-ops-check-token": "wrong" });
      const res = mockRes();
      const begun = await beginFreeCheck(req, res);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      expect(begun.ticket.settled).toBe(false);
    } finally {
      delete process.env.OPS_CHECK_BYPASS_TOKEN;
    }
  });
});
