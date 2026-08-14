import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peekOutstandingCode, resetForTests } from "./accountStore.js";
import { emailRequestHandler } from "./emailAuthHandlers.js";
import { DEV_PANEL_MESSAGE, EMAIL_SENT_MESSAGE, MAIL_SEND_FAILED_MESSAGE, MAIL_UNAVAILABLE_MESSAGE, setVerificationMailSenderForTests } from "./mailer.js";

const SECRET = "test-server-secret-for-email-auth";
const MAIL_KEYS = [
  "RESEND_API_KEY",
  "MAIL_FROM",
  "EMAIL_FROM",
  "MAIL_FROM_NAME",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
] as const;

function mockReq(body: unknown) {
  return { method: "POST", body, headers: {} };
}

function mockRes() {
  const res: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    setHeader: (key: string, value: string) => void;
    end: (payload: string) => void;
  } = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = JSON.parse(payload);
    },
  };
  return res;
}

function clearMailEnv() {
  for (const key of MAIL_KEYS) {
    delete process.env[key];
  }
}

describe("emailRequestHandler", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMail = Object.fromEntries(MAIL_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    resetForTests();
    clearMailEnv();
    setVerificationMailSenderForTests(null);
    process.env.AIPING_SESSION_SECRET = SECRET;
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    setVerificationMailSenderForTests(null);
    clearMailEnv();
    for (const key of MAIL_KEYS) {
      const value = previousMail[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns a panel code in development instead of pretending email was sent", async () => {
    const res = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      delivery: "dev-panel",
      message: DEV_PANEL_MESSAGE,
    });
    expect((res.body as { devCode: string }).devCode).toMatch(/^\d{6}$/);
  });

  it("re-shows the same development code during the rate window", async () => {
    const first = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), first);
    const second = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), second);
    expect(second.statusCode).toBe(200);
    expect((second.body as { devCode: string }).devCode).toBe((first.body as { devCode: string }).devCode);
  });

  it("does not include the code once mail is configured, even in development", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_FROM = "noreply@example.com";
    const send = vi.fn(async () => {});
    setVerificationMailSenderForTests(send);

    const res = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, delivery: "email", message: EMAIL_SENT_MESSAGE });
    expect((res.body as { devCode?: string }).devCode).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe("yishuziyu@gmail.com");
    expect(send.mock.calls[0]?.[1]).toMatch(/^\d{6}$/);
  });

  it("does not include the code in production when mail is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_FROM = "noreply@example.com";
    const send = vi.fn(async () => {});
    setVerificationMailSenderForTests(send);

    const res = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, delivery: "email", message: EMAIL_SENT_MESSAGE });
    expect((res.body as { devCode?: string }).devCode).toBeUndefined();
  });

  it("does not pretend email was sent in production without mail config", async () => {
    process.env.NODE_ENV = "production";
    const res = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "mail_unconfigured", message: MAIL_UNAVAILABLE_MESSAGE });
    expect((res.body as { devCode?: string }).devCode).toBeUndefined();
  });

  it("returns send_failed without the code if delivery throws", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_FROM = "noreply@example.com";
    setVerificationMailSenderForTests(async () => {
      throw new Error("provider down");
    });

    const res = mockRes();
    await emailRequestHandler(mockReq({ email: "yishuziyu@gmail.com" }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: "send_failed", message: MAIL_SEND_FAILED_MESSAGE });
    expect((res.body as { devCode?: string }).devCode).toBeUndefined();
    expect(peekOutstandingCode("yishuziyu@gmail.com", SECRET)).toBeNull();
  });
});
