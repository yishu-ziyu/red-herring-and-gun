import crypto from "node:crypto";
import type { Request, Response } from "express";

export interface AipingConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authBaseUrl: string;
  scope: string;
  sessionSecret: string;
  publicBaseUrl: string;
}

export interface AipingUserInfo {
  sub?: string;
  email?: string;
  picture?: string;
  another_name?: string;
  phone_number?: string;
  short_phone_number?: string;
  point_remain?: number;
  recharge_remain?: number;
  [key: string]: unknown;
}

export interface AipingTokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expiry?: number;
  expires_in?: number;
  [key: string]: unknown;
}

export interface AipingSession {
  user: AipingUserInfo;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt: number;
}

const STATE_COOKIE = "aiping_oauth_state";
const SESSION_COOKIE = "aiping_session";
const DEFAULT_AUTH_BASE_URL = "https://central.qc-ai.cn";
const DEFAULT_SCOPE = "profile phone";
const DEFAULT_PUBLIC_BASE_URL = "https://gun.yishuziyu.cn";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function envValue(env: Record<string, string | undefined>, key: string) {
  return (env[key] || "").trim();
}

export function getAipingConfig(env: Record<string, string | undefined>): AipingConfig {
  const publicBaseUrl = trimTrailingSlash(envValue(env, "PUBLIC_BASE_URL") || DEFAULT_PUBLIC_BASE_URL);
  const redirectUri = envValue(env, "AIPING_REDIRECT_URI") || `${publicBaseUrl}/api/auth/aiping/callback`;
  const clientId = envValue(env, "AIPING_CLIENT_ID");
  const clientSecret = envValue(env, "AIPING_CLIENT_SECRET");
  const sessionSecret = envValue(env, "AIPING_SESSION_SECRET");

  return {
    enabled: Boolean(clientId && clientSecret && sessionSecret),
    clientId,
    clientSecret,
    redirectUri,
    authBaseUrl: trimTrailingSlash(envValue(env, "AIPING_AUTH_BASE_URL") || DEFAULT_AUTH_BASE_URL),
    scope: envValue(env, "AIPING_SCOPE") || DEFAULT_SCOPE,
    sessionSecret,
    publicBaseUrl,
  };
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
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function emailCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function buildAuthorizeUrl(config: AipingConfig, state: string) {
  const url = new URL("/api/v1/oauth/authorize", config.authBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", crypto.randomBytes(12).toString("hex"));
  return url.toString();
}

export function createOauthState(next: string | undefined) {
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return {
    id: crypto.randomBytes(18).toString("hex"),
    next: safeNext,
    createdAt: Date.now(),
  };
}

export function setStateCookie(res: Response, config: AipingConfig, statePayload: ReturnType<typeof createOauthState>) {
  res.cookie(STATE_COOKIE, encodeSignedJson(statePayload, config.sessionSecret), cookieOptions(10 * 60));
}

export function readStateCookie(req: Request, config: AipingConfig) {
  const cookies = parseCookies(req.headers.cookie);
  return decodeSignedJson<ReturnType<typeof createOauthState>>(cookies[STATE_COOKIE], config.sessionSecret);
}

export function clearStateCookie(res: Response) {
  res.clearCookie(STATE_COOKIE, { path: "/" });
}

export function setSessionCookie(res: Response, config: AipingConfig, session: AipingSession) {
  res.cookie(SESSION_COOKIE, encodeSignedJson(session, config.sessionSecret), cookieOptions(14 * 24 * 60 * 60));
}

export function readSessionCookie(req: Request, config: AipingConfig) {
  const cookies = parseCookies(req.headers.cookie);
  return decodeSignedJson<AipingSession>(cookies[SESSION_COOKIE], config.sessionSecret);
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function exchangeCodeForToken(config: AipingConfig, code: string): Promise<AipingTokenResponse> {
  const body = new URLSearchParams();
  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", config.redirectUri);

  const response = await fetch(`${config.authBaseUrl}/api/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error_description === "string" ? data.error_description : response.statusText;
    throw new Error(`AI Ping token exchange failed: ${message}`);
  }
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new Error("AI Ping token exchange failed: missing access_token");
  }
  return data as AipingTokenResponse;
}

export async function fetchAipingUserInfo(config: AipingConfig, accessToken: string): Promise<AipingUserInfo> {
  const url = new URL("/api/v1/oauth/userinfo", config.authBaseUrl);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : response.statusText;
    throw new Error(`AI Ping userinfo failed: ${message}`);
  }
  return data as AipingUserInfo;
}

export async function fetchAipingApiKeys(config: AipingConfig, accessToken: string) {
  const url = new URL("/api/v1/oauth/apikey/list", config.authBaseUrl);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : response.statusText;
    throw new Error(`AI Ping apikey list failed: ${message}`);
  }
  return data;
}
