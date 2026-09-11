import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVerificationEmail,
  extractMailAddress,
  formatFromHeader,
  isMailConfigured,
  resolveMailTransport,
  sendVerificationCodeEmail,
  setVerificationMailSenderForTests,
} from "./mailer.js";

describe("mailer config", () => {
  it("is unconfigured without keys", () => {
    const env = {};
    expect(isMailConfigured(env)).toBe(false);
    expect(resolveMailTransport(env)).toBeNull();
  });

  it("uses Resend when RESEND_API_KEY and MAIL_FROM are set", () => {
    const transport = resolveMailTransport({
      RESEND_API_KEY: "re_test",
      MAIL_FROM: "noreply@example.com",
    });
    expect(transport).toMatchObject({ kind: "resend", apiKey: "re_test", from: "noreply@example.com" });
  });

  it("uses SMTP when host/user/pass/from are set and Resend is absent", () => {
    const transport = resolveMailTransport({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
      MAIL_FROM: "noreply@example.com",
    });
    expect(transport).toMatchObject({
      kind: "smtp",
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "mailer",
    });
  });

  it("prefers Resend when both Resend and SMTP are set", () => {
    const transport = resolveMailTransport({
      RESEND_API_KEY: "re_test",
      MAIL_FROM: "noreply@example.com",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
    });
    expect(transport?.kind).toBe("resend");
  });

  it("does not treat a lone API key as configured", () => {
    expect(isMailConfigured({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(isMailConfigured({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" })).toBe(false);
  });
});

describe("verification email copy", () => {
  it("keeps the body short and about the checker, not an account platform", () => {
    const mail = buildVerificationEmail("272879");
    expect(mail.subject).toBe("红鲱鱼与枪 验证码");
    expect(mail.text).toContain("272879");
    expect(mail.text).toContain("红鲱鱼与枪");
    expect(mail.text).toContain("不登录也可以继续核查");
    expect(mail.text).not.toMatch(/额度|BYOK|配额|quota/i);
  });

  it("formats a named from address", () => {
    expect(formatFromHeader("noreply@example.com", "红鲱鱼与枪")).toBe("红鲱鱼与枪 <noreply@example.com>");
    expect(extractMailAddress("红鲱鱼与枪 <beth.t@example.com>")).toBe("beth.t@example.com");
  });
});

describe("sendVerificationCodeEmail", () => {
  afterEach(() => {
    setVerificationMailSenderForTests(null);
  });

  it("posts the code to Resend and does not throw on 200", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    await sendVerificationCodeEmail({
      to: "reader@example.com",
      code: "482917",
      env: { RESEND_API_KEY: "re_test", MAIL_FROM: "noreply@example.com" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "User-Agent": "red-herring-and-gun/mvp",
    });
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["reader@example.com"]);
    expect(body.from).toBe("noreply@example.com");
    expect(body.text).toContain("482917");
  });

  it("maps Resend auth failures to a fixable message", async () => {
    const { publicMailSendFailureMessage, MAIL_KEY_INVALID_MESSAGE, MAIL_DOMAIN_UNVERIFIED_MESSAGE } =
      await import("./mailer.js");
    expect(publicMailSendFailureMessage("Resend 发信失败：API key is invalid")).toBe(MAIL_KEY_INVALID_MESSAGE);
    expect(
      publicMailSendFailureMessage("Resend 发信失败：The example.com domain is not verified")
    ).toBe(MAIL_DOMAIN_UNVERIFIED_MESSAGE);
  });

  it("throws when Resend returns an error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "domain not verified" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
    );
    await expect(
      sendVerificationCodeEmail({
        to: "reader@example.com",
        code: "482917",
        env: { RESEND_API_KEY: "re_test", MAIL_FROM: "noreply@example.com" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/domain not verified/);
  });
});
