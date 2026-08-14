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

function mockReq(cookie = "", ip = "127.0.0.1") {
  const listeners = new Map<string, Array<() => void>>();
  return {
    headers: { cookie },
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

  it("gives a guest one free check per Shanghai day", async () => {
    const req = mockReq();
    const first = mockRes();
    const peek = await peekCheckQuota(req);
    expect(peek).toEqual({ remaining: 1, total: 1, used: 0, kind: "guest", enforced: true });

    const begun = await beginFreeCheck(req, first);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    commitFreeCheck(first, begun.ticket);

    const cookie = String(first.headers["Set-Cookie"] ?? "");
    const again = await peekCheckQuota(mockReq(cookie.split(";")[0]));
    expect(again.remaining).toBe(0);
    expect(again.kind).toBe("guest");

    const blocked = mockRes();
    const second = await beginFreeCheck(mockReq(cookie.split(";")[0], "127.0.0.1"), blocked);
    expect(second.ok).toBe(false);
  });

  it("blocks a second guest on the same IP even with a fresh cookie", async () => {
    const firstReq = mockReq("", "10.0.0.8");
    const firstRes = mockRes();
    const begun = await beginFreeCheck(firstReq, firstRes);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    commitFreeCheck(firstRes, begun.ticket);

    const second = await beginFreeCheck(mockReq("", "10.0.0.8"), mockRes());
    expect(second.ok).toBe(false);
  });

  it("releases a guest slot when the run fails before a verdict", async () => {
    const req = mockReq();
    const res = mockRes();
    const begun = await beginFreeCheck(req, res);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    releaseFreeCheck(begun.ticket);
    const peek = await peekCheckQuota(req);
    expect(peek.remaining).toBe(1);
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

    const blocked = mockRes();
    const ticket = await gateFreeCheck(mockReq(String(first.headers["Set-Cookie"] ?? "").split(";")[0]), blocked);
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
    expect(await peekCheckQuota(req)).toMatchObject({ remaining: 1, used: 0, kind: "guest", enforced: false });

    for (let i = 0; i < 5; i += 1) {
      const res = mockRes();
      const begun = await beginFreeCheck(req, res);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      commitFreeCheck(res, begun.ticket);
    }

    expect(await peekCheckQuota(req)).toMatchObject({ remaining: 1, used: 0, enforced: false });
    const ticket = await gateFreeCheck(req, mockRes());
    expect(ticket).not.toBeNull();
  });
});
