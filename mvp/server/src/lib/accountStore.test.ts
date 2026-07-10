import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeQuota,
  deleteAccount,
  generateCode,
  getBySession,
  getQuota,
  hashEmail,
  requestCode,
  resetForTests,
  verifyAndCreate,
  type EmailAccount,
} from "./accountStore.js";

const SERVER_SECRET = "test-server-secret-for-account-store";
const EMAIL = "user@example.com";

beforeEach(() => {
  resetForTests();
  process.env.AIPING_SESSION_SECRET = SERVER_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

function emailAccount(email: string): EmailAccount {
  return {
    email,
    hash: hashEmail(email, SERVER_SECRET),
    createdAt: Date.now(),
    quota: { total: 5, used: 0, periodStartAt: Date.now() },
    history: [],
  };
}

describe("hashEmail integration", () => {
  it("produces the hash that the EmailAccount helper writes", () => {
    const a = emailAccount(EMAIL);
    expect(a.hash).toBe(hashEmail(EMAIL, SERVER_SECRET));
  });
});

describe("accountStore", () => {
  describe("generateCode", () => {
    it("returns a 6-digit string of digits", () => {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it("produces different values across calls", () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i += 1) set.add(generateCode());
      // 50 抽样基本不可能撞 6 位 space，但理论上不保证，这里宽松断言
      expect(set.size).toBeGreaterThan(40);
    });
  });

  describe("hashEmail", () => {
    it("returns a stable SHA-256 hex digest given the same email and secret", () => {
      const a = hashEmail(EMAIL, "secret-1");
      const b = hashEmail(EMAIL, "secret-1");
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns a different digest when the secret changes", () => {
      expect(hashEmail(EMAIL, "secret-1")).not.toBe(hashEmail(EMAIL, "secret-2"));
    });

    it("returns a different digest when the email changes", () => {
      expect(hashEmail("a@example.com", "secret-1")).not.toBe(hashEmail("b@example.com", "secret-1"));
    });
  });

  describe("requestCode", () => {
    it("generates a 6-digit code and expires it within 10 minutes", async () => {
      const result = await requestCode(EMAIL, SERVER_SECRET);
      expect(result.ok).toBe(true);
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 50);
    });

    it("rejects the same email within 1 minute with rate_limit", async () => {
      const first = await requestCode(EMAIL, SERVER_SECRET);
      expect(first.ok).toBe(true);

      const second = await requestCode(EMAIL, SERVER_SECRET);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("rate_limit");
    });

    it("rejects malformed emails", async () => {
      const result = await requestCode("not-an-email", SERVER_SECRET);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_email");
    });

    it("accepts a new request after the 1-minute rate window has elapsed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-04T00:00:00Z"));

      const first = await requestCode(EMAIL, SERVER_SECRET);
      expect(first.ok).toBe(true);

      vi.setSystemTime(new Date(first.expiresAt));
      // 10 min 之后已经超过 1 分钟 rate window，但仍小于 1 小时
      const second = await requestCode(EMAIL, SERVER_SECRET);
      expect(second.ok).toBe(true);
      expect(second.code).toMatch(/^\d{6}$/);
    });
  });

  describe("verifyAndCreate", () => {
    it("accepts a valid code and creates account + session", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      expect(req.ok).toBe(true);

      const verify = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      expect(verify.ok).toBe(true);
      expect(verify.sessionId).toMatch(/^[a-f0-9]+$/);

      const account = await getBySession(verify.sessionId!, SERVER_SECRET);
      expect(account).not.toBeNull();
      expect(account!.email).toBe(EMAIL);
      expect(account!.quota.total).toBe(5);
      expect(account!.quota.used).toBe(0);
    });

    it("rejects an invalid code", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      expect(req.ok).toBe(true);

      const verify = await verifyAndCreate(EMAIL, "000000", SERVER_SECRET);
      expect(verify.ok).toBe(false);
      expect(verify.error).toBe("invalid_code");
    });

    it("rejects an expired code", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      expect(req.ok).toBe(true);

      vi.useFakeTimers();
      vi.setSystemTime(new Date(req.expiresAt! + 1000));

      const verify = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      expect(verify.ok).toBe(false);
      expect(verify.error).toBe("expired");
    });

    it("rejects a consumed code on second attempt", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      expect(req.ok).toBe(true);

      const first = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      expect(first.ok).toBe(true);

      // Clear rate window by waiting briefly using a fresh fake-timer sweep is not necessary
      // because the consumed flag is checked separately; just retry immediately.
      const second = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("invalid_code");
    });
  });

  describe("consumeQuota / getQuota", () => {
    async function bootstrap(email: string) {
      const req = await requestCode(email, SERVER_SECRET);
      expect(req.ok).toBe(true);
      const verify = await verifyAndCreate(email, req.code!, SERVER_SECRET);
      return verify.sessionId!;
    }

    it("decrements remaining quota and persists", async () => {
      const sessionId = await bootstrap(EMAIL);
      const before = await getBySession(sessionId, SERVER_SECRET);
      expect(before!.quota.used).toBe(0);

      const result = await consumeQuota(sessionId, SERVER_SECRET);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(4);

      const after = await getBySession(sessionId, SERVER_SECRET);
      expect(after!.quota.used).toBe(1);
      expect(getQuota(after!)).toEqual({ remaining: 4, total: 5 });
    });

    it("rejects when quota is exhausted for the active 30-day period", async () => {
      const sessionId = await bootstrap(EMAIL);
      for (let i = 0; i < 5; i += 1) {
        const r = await consumeQuota(sessionId, SERVER_SECRET);
        expect(r.ok).toBe(true);
      }
      const sixth = await consumeQuota(sessionId, SERVER_SECRET);
      expect(sixth.ok).toBe(false);
      expect(sixth.error).toBe("quota_exceeded");
    });

    it("resets the quota window after 30 days", async () => {
      // 先用真实时间启动，到 bootstrap 这一刻
      const baseline = Date.now();

      const sessionId = await bootstrap(EMAIL);
      for (let i = 0; i < 5; i += 1) {
        await consumeQuota(sessionId, SERVER_SECRET);
      }
      const exhausted = await consumeQuota(sessionId, SERVER_SECRET);
      expect(exhausted.ok).toBe(false);

      // 越过 30 天 quota 窗口,但离 31 天 session TTL 还差 1 小时
      vi.useFakeTimers();
      vi.setSystemTime(new Date(baseline + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000));

      const after = await consumeQuota(sessionId, SERVER_SECRET);
      expect(after.ok).toBe(true);
      expect(after.remaining).toBe(4);
    });

    it("returns null for a missing session", async () => {
      const account = await getBySession("not-a-real-session", SERVER_SECRET);
      expect(account).toBeNull();
    });
  });

  describe("deleteAccount", () => {
    it("removes the account and any associated sessions", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      expect(req.ok).toBe(true);
      const verify = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      const sessionId = verify.sessionId!;

      await deleteAccount(sessionId, SERVER_SECRET);
      const account = await getBySession(sessionId, SERVER_SECRET);
      expect(account).toBeNull();
    });

    it("is a no-op for unknown sessions", async () => {
      await expect(deleteAccount("does-not-exist", SERVER_SECRET)).resolves.toBeUndefined();
    });
  });

  describe("history hook", () => {
    it("records a verify event at first login", async () => {
      const req = await requestCode(EMAIL, SERVER_SECRET);
      const verify = await verifyAndCreate(EMAIL, req.code!, SERVER_SECRET);
      const account = (await getBySession(verify.sessionId!, SERVER_SECRET)) as EmailAccount | null;
      expect(account).not.toBeNull();
      expect(account!.history.length).toBeGreaterThanOrEqual(1);
      expect(account!.history[0].kind).toBe("verify");
    });
  });
});
