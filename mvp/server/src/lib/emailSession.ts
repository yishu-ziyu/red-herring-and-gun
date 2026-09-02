/**
 * 邮箱登录会话：cookie 名、签名密钥、从请求里读出账号。
 * 有 cookie 且有效才返回账号；没有登录返回 null，不写 401。
 */

import { getBySession, type EmailAccount } from "./accountStore.js";
import { decodeSignedJson, parseCookies } from "./aipingAuth.js";

export const EMAIL_SESSION_COOKIE = "v3_email_session";
export const EMAIL_SESSION_TTL_SECONDS = 31 * 24 * 60 * 60;

export function getServerSecret() {
  const secret = (process.env.AIPING_SESSION_SECRET ?? "").trim();
  // 生产环境密钥过短等于可伪造 cookie；空密钥长度是 0，也会被拦住。
  if (process.env.NODE_ENV === "production" && secret.length < 16) {
    throw new Error("AIPING_SESSION_SECRET must be at least 16 characters in production");
  }
  return secret;
}

function cookieHeader(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    return raw.join("; ");
  }
  return undefined;
}

export function readEmailSessionId(rawCookieHeader: unknown): string | null {
  const cookies = parseCookies(cookieHeader(rawCookieHeader));
  const raw = cookies[EMAIL_SESSION_COOKIE];
  if (!raw) return null;
  const decoded = decodeSignedJson<{ sid: string }>(raw, getServerSecret());
  return decoded?.sid ?? null;
}

export async function readEmailAccountOptional(req: {
  headers?: { cookie?: unknown };
}): Promise<EmailAccount | null> {
  const sessionId = readEmailSessionId(req.headers?.cookie);
  if (!sessionId) return null;
  return getBySession(sessionId, getServerSecret());
}
