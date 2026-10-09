/**
 * signedCookie — 签名 cookie 的编码、解码与会话密钥。现在只有访客额度 cookie 在用。
 *
 * 会话密钥读 SESSION_SECRET；没有设时回退读旧名 AIPING_SESSION_SECRET，
 * 这样已部署的环境不用改配置。AI Ping 登录已在 2026-10-09 删除，旧名只为兼容保留。
 */
import crypto from "node:crypto";

export function sessionSecretFromEnv(): string {
  return (process.env.SESSION_SECRET || process.env.AIPING_SESSION_SECRET || "").trim();
}

export function getServerSecret() {
  const secret = sessionSecretFromEnv();
  // 生产环境密钥过短等于可伪造 cookie；空密钥长度是 0，也会被拦住。
  if (process.env.NODE_ENV === "production" && secret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters in production");
  }
  return secret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSignedJson(value: unknown, secret: string) {
  const payload = base64url(JSON.stringify(value));
  return `${payload}.${signPayload(payload, secret)}`;
}

export function decodeSignedJson<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload, secret);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  // 长度不匹配时用等长空 buffer 替代，避免早返回泄漏 signature 长度
  const signatureBuffer =
    receivedBuffer.length === expectedBuffer.length
      ? receivedBuffer
      : Buffer.alloc(expectedBuffer.length);
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}
