/**
 * 邮箱验证码登录 HTTP handlers。不挡核查；登录只为记住最近核查。
 * 配了 SMTP / Resend 就把 6 位码发到用户邮箱；没配且非生产才回显到面板。
 */

import {
  abandonOutstandingCode,
  deleteAccount as accountDelete,
  exportAccount,
  getAccountChecks,
  getBySession as accountGetBySession,
  peekOutstandingCode,
  requestCode as accountRequestCode,
  updateDisplayName,
  verifyAndCreate as accountVerifyAndCreate,
  type EmailAccount,
} from "./accountStore.js";
import { accountDisplayName, normalizeAccountName } from "../../../src/lib/accountIdentity.js";
import { emailCookieOptions, encodeSignedJson } from "./aipingAuth.js";
import {
  EMAIL_SESSION_COOKIE,
  EMAIL_SESSION_TTL_SECONDS,
  getServerSecret,
  readEmailSessionId,
} from "./emailSession.js";
import {
  DEV_PANEL_MESSAGE,
  EMAIL_SENT_MESSAGE,
  MAIL_UNAVAILABLE_MESSAGE,
  deliverVerificationCode,
  isMailConfigured,
  publicMailSendFailureMessage,
} from "./mailer.js";

function readJsonFromReq(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function endJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function buildSetCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number }
) {
  const parts: string[] = [`${name}=${value}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  return parts.join("; ");
}

function buildClearCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function pickEmailAccountId(account: EmailAccount): { email: string; id: string } {
  return { email: account.email, id: account.hash };
}

function publicAccount(account: EmailAccount) {
  const name = accountDisplayName(account.email, account.displayName);
  return {
    authenticated: true as const,
    provider: "email" as const,
    email: account.email,
    displayName: account.displayName,
    name,
    createdAt: account.createdAt,
    loginCount: account.loginCount,
    lastLoginAt: account.lastLoginAt,
  };
}

function shouldEchoDevCode() {
  return process.env.NODE_ENV !== "production" && !isMailConfigured();
}

function withDevCode(body: Record<string, unknown>, code?: string | null) {
  if (!shouldEchoDevCode() || !code) return body;
  return {
    ...body,
    delivery: "dev-panel",
    devCode: code,
  };
}

async function readAccountFromRequest(req: any, res: any): Promise<EmailAccount | null> {
  const sessionId = readEmailSessionId(req.headers?.cookie);
  if (!sessionId) {
    endJson(res, 401, { error: "Not authenticated" });
    return null;
  }
  const account = await accountGetBySession(sessionId, getServerSecret());
  if (!account) {
    endJson(res, 401, { error: "Session expired" });
    return null;
  }
  return account;
}

export async function emailRequestHandler(req: any, res: any) {
  if (req.method !== "POST") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: any;
  try {
    body = await readJsonFromReq(req);
  } catch {
    endJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const email = typeof body?.email === "string" ? body.email : "";
  const result = await accountRequestCode(email, getServerSecret());

  if (!result.ok) {
    if (result.error === "rate_limit") {
      const existing = peekOutstandingCode(email, getServerSecret());
      if (shouldEchoDevCode() && existing) {
        endJson(res, 200, withDevCode({ ok: true, message: DEV_PANEL_MESSAGE }, existing));
        return;
      }
      endJson(res, 429, { error: "rate_limit", message: "请稍后再试，1 分钟内只能请求一次验证码" });
      return;
    }
    endJson(res, 400, { error: result.error ?? "invalid_email", message: "邮箱格式不正确" });
    return;
  }

  if (isMailConfigured()) {
    try {
      await deliverVerificationCode(email, result.code ?? "");
      console.log(`[v3-auth] requestCode email=${email} delivery=email expiresAt=${result.expiresAt}`);
      endJson(res, 200, { ok: true, delivery: "email", message: EMAIL_SENT_MESSAGE });
      return;
    } catch (error) {
      abandonOutstandingCode(email, getServerSecret());
      const detail = error instanceof Error ? error.message : "send_failed";
      console.error(`[v3-auth] sendCode failed email=${email} message=${detail}`);
      endJson(res, 502, { error: "send_failed", message: publicMailSendFailureMessage(detail) });
      return;
    }
  }

  if (shouldEchoDevCode()) {
    console.log(`[v3-auth] requestCode email=${email} delivery=dev-panel code=${result.code} expiresAt=${result.expiresAt}`);
    endJson(res, 200, withDevCode({ ok: true, message: DEV_PANEL_MESSAGE }, result.code));
    return;
  }

  abandonOutstandingCode(email, getServerSecret());
  console.error(`[v3-auth] requestCode email=${email} delivery=unconfigured`);
  endJson(res, 503, { error: "mail_unconfigured", message: MAIL_UNAVAILABLE_MESSAGE });
}

export async function emailVerifyHandler(req: any, res: any) {
  if (req.method !== "POST") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: any;
  try {
    body = await readJsonFromReq(req);
  } catch {
    endJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const email = typeof body?.email === "string" ? body.email : "";
  const code = typeof body?.code === "string" ? body.code : "";

  const verify = await accountVerifyAndCreate(email, code, getServerSecret());
  if (!verify.ok || !verify.sessionId) {
    endJson(res, 401, {
      error: verify.error ?? "invalid_code",
      message: verify.error === "expired" ? "验证码已过期，请重新获取" : "验证码不正确或已使用",
    });
    return;
  }

  const signed = encodeSignedJson({ sid: verify.sessionId }, getServerSecret());
  res.setHeader(
    "Set-Cookie",
    buildSetCookie(EMAIL_SESSION_COOKIE, signed, emailCookieOptions(EMAIL_SESSION_TTL_SECONDS))
  );

  endJson(res, 200, { ok: true, message: "登录成功" });
}

export async function emailMeHandler(req: any, res: any) {
  if (req.method !== "GET") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const sessionId = readEmailSessionId(req.headers?.cookie);
  if (!sessionId) {
    endJson(res, 401, { error: "Not authenticated" });
    return;
  }
  const account = await accountGetBySession(sessionId, getServerSecret());
  if (!account) {
    endJson(res, 401, { error: "Session expired" });
    return;
  }
  const checks = getAccountChecks(account);
  endJson(res, 200, {
    ...publicAccount(account),
    checks: {
      remaining: checks.remaining,
      total: checks.total,
      used: checks.used,
      kind: checks.kind,
    },
  });
}

export async function emailProfileHandler(req: any, res: any) {
  if (req.method !== "PATCH") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const account = await readAccountFromRequest(req, res);
  if (!account) return;

  let body: any;
  try {
    body = await readJsonFromReq(req);
  } catch {
    endJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const parsed = normalizeAccountName(body?.displayName ?? body?.name);
  if (!parsed.ok) {
    endJson(res, 400, { error: "too_long", message: "称呼最多 24 个字" });
    return;
  }
  updateDisplayName(account, parsed.value);
  endJson(res, 200, { ok: true, ...publicAccount(account) });
}

export async function emailLogoutHandler(req: any, res: any) {
  if (req.method !== "POST") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }
  res.setHeader("Set-Cookie", buildClearCookie(EMAIL_SESSION_COOKIE));
  endJson(res, 200, { ok: true });
}

export async function accountExportHandler(req: any, res: any) {
  if (req.method !== "GET") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const account = await readAccountFromRequest(req, res);
  if (!account) return;
  const payload = exportAccount(account);
  const id = pickEmailAccountId(account);
  endJson(res, 200, {
    ...payload,
    account: { ...payload.account, id: id.id },
    exportedAt: Date.now(),
  });
}

export async function accountDeleteHandler(req: any, res: any) {
  if (req.method !== "DELETE") {
    endJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const account = await readAccountFromRequest(req, res);
  if (!account) return;

  const sessionId = readEmailSessionId(req.headers?.cookie);
  if (!sessionId) {
    endJson(res, 401, { error: "Not authenticated" });
    return;
  }
  await accountDelete(sessionId, getServerSecret());

  res.setHeader("Set-Cookie", buildClearCookie(EMAIL_SESSION_COOKIE));
  console.log(`[v3-auth] deleteAccount email=${account.email}`);
  endJson(res, 200, { ok: true, message: "账户已删除" });
}
