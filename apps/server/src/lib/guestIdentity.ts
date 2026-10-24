/**
 * 访客身份：不登录时认「同一个浏览器」靠签名 cookie 里的 id，认「同一条来源 IP」靠加了密钥的 IP 哈希。
 * 额度、分享和调查归属都用这一份身份；cookie 里另带当天已用的核查次数，供额度合并。
 */
import crypto from "node:crypto";
import { shanghaiDayKey } from "../../../shared/quota.js";
import { cookieOptions, decodeSignedJson, encodeSignedJson, getServerSecret, parseCookies } from "./signedCookie.js";

const GUEST_CHECKS_COOKIE = "v3_guest_checks";
// 也是分享的所有者凭证：要比分享有效期（30 天）长，否则分享者撤销不了自己的链接。
const GUEST_COOKIE_TTL_SECONDS = 60 * 24 * 60 * 60;

type GuestCookiePayload = {
  id: string;
  day: string;
  used: number;
};

export type GuestIdentity = {
  id: string;
  /** 来源 IP 的哈希（加了服务端密钥）。 */
  ipKey: string;
  /** 存进 runs.ownerHash 的值：访客 id 的哈希，库里不放 id 原文。 */
  ownerHash: string;
  /** cookie 里记的核查用量；没有 cookie 时为 null。 */
  cookieUse: { day: string; used: number } | null;
};

// A response cookie is not present in the request headers until the next request.
// Share one identity across acceptance, quota reservation and ownership in this request.
const requestGuestIds = new WeakMap<object, string>();

function cookieHeader(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    return raw.join("; ");
  }
  return undefined;
}

export function headerValue(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}

function clientIp(req: { headers?: { [key: string]: unknown }; socket?: { remoteAddress?: string } }) {
  // nginx 用 $remote_addr 覆盖 X-Real-IP，客户端无法伪造（前提：3000 不对外，见 docker-compose）。
  const realIp = headerValue(req.headers?.["x-real-ip"]);
  if (realIp) return realIp.split(",")[0]?.trim() || realIp;
  // XFF 只取最后一跳：由我们自己的反代追加，客户端伪造的段排在前面。
  const forwarded = headerValue(req.headers?.["x-forwarded-for"]);
  if (forwarded) {
    const lastHop = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .pop();
    if (lastHop) return lastHop;
  }
  return req.socket?.remoteAddress || "unknown";
}

function hashIp(ip: string) {
  return crypto.createHash("sha256").update(`${ip}|${getServerSecret()}`, "utf8").digest("hex").slice(0, 32);
}

function ownerHashOf(guestId: string): string {
  return crypto.createHash("sha256").update(`guest-owner|${guestId}`, "utf8").digest("hex").slice(0, 32);
}

function readGuestCookie(req: { headers?: { cookie?: unknown } }): GuestCookiePayload | null {
  const cookies = parseCookies(cookieHeader(req.headers?.cookie));
  const raw = cookies[GUEST_CHECKS_COOKIE];
  if (!raw) return null;
  const decoded = decodeSignedJson<GuestCookiePayload>(raw, getServerSecret());
  if (!decoded || typeof decoded.id !== "string" || typeof decoded.day !== "string") return null;
  if (typeof decoded.used !== "number" || decoded.used < 0) return null;
  return decoded;
}

function identity(req: any, id: string, cookie: GuestCookiePayload | null): GuestIdentity {
  requestGuestIds.set(req, id);
  return {
    id,
    ipKey: hashIp(clientIp(req)),
    ownerHash: ownerHashOf(id),
    cookieUse: cookie ? { day: cookie.day, used: cookie.used } : null,
  };
}

/** 请求里已有的访客；没有 cookie 就是 null（不发新的）。 */
export function guestFromRequest(req: any): GuestIdentity | null {
  const cookie = readGuestCookie(req);
  const id = cookie?.id ?? requestGuestIds.get(req);
  return id ? identity(req, id, cookie) : null;
}

/** 请求里的访客；没有就在这次请求里定一个新 id，cookie 由调用方随用量一起写。 */
export function identifyGuest(req: any): GuestIdentity {
  const cookie = readGuestCookie(req);
  return identity(req, cookie?.id || requestGuestIds.get(req) || crypto.randomBytes(12).toString("hex"), cookie);
}

/**
 * 分享和调查归属靠它认「同一个浏览器」。cookie 已有就沿用里面的 id，不改写（改写会把访客当天的核查用量清零）；
 * 没有或读不出时发一个新的。
 */
export function ensureGuest(req: any, res: any): GuestIdentity {
  const existing = guestFromRequest(req);
  if (existing) return existing;
  const guest = identifyGuest(req);
  writeGuestCookie(res, guest.id, shanghaiDayKey(), 0);
  return guest;
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

function appendSetCookie(res: { setHeader?: Function; getHeader?: Function }, cookie: string) {
  if (typeof res.setHeader !== "function") return;
  const prev = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  if (!prev) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  const list = Array.isArray(prev) ? prev : [String(prev)];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

/** 写访客 cookie（id + 当天核查用量）。响应头已发出时什么也不做。 */
export function writeGuestCookie(
  res: { setHeader?: Function; getHeader?: Function; headersSent?: boolean },
  id: string,
  day: string,
  used: number
) {
  if (res.headersSent) return;
  const token = encodeSignedJson({ id, day, used } satisfies GuestCookiePayload, getServerSecret());
  appendSetCookie(res, buildSetCookie(GUEST_CHECKS_COOKIE, token, cookieOptions(GUEST_COOKIE_TTL_SECONDS)));
}
