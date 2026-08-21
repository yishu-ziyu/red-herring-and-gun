/**
 * 免费核查闸门。未登录每天 1 条，登录后每天 3 条。
 * 开始时占位，出判断才扣；我们自己失败则放回；用户中途取消仍计一次。
 */

import crypto from "node:crypto";
import {
  ACCOUNT_DAILY_CHECKS,
  GUEST_DAILY_CHECKS,
  checksExhaustedMessage,
  shanghaiDayKey,
  type CheckQuotaKind,
  type CheckQuotaView,
} from "../../../src/lib/checkQuota.js";
import {
  beginAccountCheck,
  commitAccountCheck,
  getAccountByHash,
  getAccountChecks,
  releaseAccountCheck,
  type EmailAccount,
} from "./accountStore.js";
import { decodeSignedJson, emailCookieOptions, encodeSignedJson, parseCookies } from "./aipingAuth.js";
import { getServerSecret, readEmailAccountOptional } from "./emailSession.js";

export const GUEST_CHECKS_COOKIE = "v3_guest_checks";
const GUEST_COOKIE_TTL_SECONDS = 2 * 24 * 60 * 60;

let enforcedForTests: boolean | null = null;

export function setCheckQuotaEnforcedForTests(value: boolean | null) {
  enforcedForTests = value;
}

export function isCheckQuotaEnforced() {
  if (enforcedForTests !== null) return enforcedForTests;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return true;
  return process.env.NODE_ENV === "production";
}

type GuestCookiePayload = {
  id: string;
  day: string;
  used: number;
};

type GuestBucket = {
  day: string;
  used: number;
  inflight: number;
};

const guests = new Map<string, GuestBucket>();
const guestsByIp = new Map<string, GuestBucket>();

export type CheckTicket = {
  kind: CheckQuotaKind;
  day: string;
  accountHash?: string;
  guestId?: string;
  ipKey?: string;
  settled: boolean;
};

function cookieHeader(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    return raw.join("; ");
  }
  return undefined;
}

function headerValue(raw: unknown): string {
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

function readGuestCookie(req: { headers?: { cookie?: unknown } }): GuestCookiePayload | null {
  const cookies = parseCookies(cookieHeader(req.headers?.cookie));
  const raw = cookies[GUEST_CHECKS_COOKIE];
  if (!raw) return null;
  const decoded = decodeSignedJson<GuestCookiePayload>(raw, getServerSecret());
  if (!decoded || typeof decoded.id !== "string" || typeof decoded.day !== "string") return null;
  if (typeof decoded.used !== "number" || decoded.used < 0) return null;
  return decoded;
}

function syncBucket(bucket: GuestBucket | undefined, day: string): GuestBucket {
  if (!bucket || bucket.day !== day) return { day, used: 0, inflight: 0 };
  return bucket;
}

function guestState(
  req: { headers?: { cookie?: unknown; [key: string]: unknown }; socket?: { remoteAddress?: string } },
  now = Date.now()
) {
  const day = shanghaiDayKey(now);
  const cookie = readGuestCookie(req);
  const id = cookie?.id || crypto.randomBytes(12).toString("hex");
  const ipKey = hashIp(clientIp(req));
  const memory = syncBucket(guests.get(id), day);
  const ip = syncBucket(guestsByIp.get(ipKey), day);
  const cookieUsed = cookie && cookie.day === day ? cookie.used : 0;
  memory.used = Math.max(memory.used, ip.used, cookieUsed);
  ip.used = Math.max(ip.used, memory.used);
  guests.set(id, memory);
  guestsByIp.set(ipKey, ip);
  return { id, day, memory, ip, ipKey };
}

function remainingOf(used: number, inflight: number, total: number) {
  return Math.max(0, total - used - inflight);
}

function bypassQuotaView(kind: CheckQuotaKind): CheckQuotaView {
  const total = kind === "account" ? ACCOUNT_DAILY_CHECKS : GUEST_DAILY_CHECKS;
  return { remaining: total, total, used: 0, kind, enforced: false };
}

function guestBlocked(memory: GuestBucket, ip: GuestBucket) {
  return (
    memory.used + memory.inflight >= GUEST_DAILY_CHECKS || ip.used + ip.inflight >= GUEST_DAILY_CHECKS
  );
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

function writeGuestCookie(
  res: { setHeader?: Function; getHeader?: Function; headersSent?: boolean },
  payload: GuestCookiePayload
) {
  if (res.headersSent) return;
  const token = encodeSignedJson(payload, getServerSecret());
  appendSetCookie(res, buildSetCookie(GUEST_CHECKS_COOKIE, token, emailCookieOptions(GUEST_COOKIE_TTL_SECONDS)));
}

function writeJson(res: any, status: number, body: unknown) {
  if (res.headersSent) return;
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(body));
}

export async function peekCheckQuota(
  req: { headers?: { cookie?: unknown; [key: string]: unknown }; socket?: { remoteAddress?: string } }
): Promise<CheckQuotaView> {
  const account = await readEmailAccountOptional(req);
  if (!isCheckQuotaEnforced()) {
    return bypassQuotaView(account ? "account" : "guest");
  }
  if (account) {
    const checks = getAccountChecks(account);
    return { remaining: checks.remaining, total: checks.total, used: checks.used, kind: "account", enforced: true };
  }
  const { memory, ip } = guestState(req);
  return {
    remaining: remainingOf(Math.max(memory.used, ip.used), Math.max(memory.inflight, ip.inflight), GUEST_DAILY_CHECKS),
    total: GUEST_DAILY_CHECKS,
    used: Math.max(memory.used, ip.used),
    kind: "guest",
    enforced: true,
  };
}

export async function beginFreeCheck(
  req: any,
  res: any
): Promise<{ ok: true; ticket: CheckTicket } | { ok: false; kind: CheckQuotaKind }> {
  const account: EmailAccount | null = await readEmailAccountOptional(req);
  if (!isCheckQuotaEnforced()) {
    return {
      ok: true,
      ticket: { kind: account ? "account" : "guest", day: shanghaiDayKey(), settled: true },
    };
  }
  if (account) {
    const day = shanghaiDayKey();
    if (!beginAccountCheck(account)) {
      return { ok: false, kind: "account" };
    }
    return { ok: true, ticket: { kind: "account", day, accountHash: account.hash, settled: false } };
  }

  const { id, day, memory, ip, ipKey } = guestState(req);
  if (guestBlocked(memory, ip)) {
    writeGuestCookie(res, { id, day, used: memory.used });
    return { ok: false, kind: "guest" };
  }
  memory.inflight += 1;
  ip.inflight += 1;
  writeGuestCookie(res, { id, day, used: memory.used });
  return { ok: true, ticket: { kind: "guest", day, guestId: id, ipKey, settled: false } };
}

export function commitFreeCheck(res: any, ticket: CheckTicket) {
  if (ticket.settled) return;
  ticket.settled = true;
  if (ticket.kind === "account" && ticket.accountHash) {
    const account = getAccountByHash(ticket.accountHash);
    if (account) commitAccountCheck(account);
    return;
  }
  if (!ticket.guestId) return;
  const bucket = guests.get(ticket.guestId);
  if (bucket) {
    if (bucket.inflight > 0) bucket.inflight -= 1;
    bucket.used += 1;
    writeGuestCookie(res, { id: ticket.guestId, day: bucket.day, used: bucket.used });
  }
  if (ticket.ipKey) {
    const ip = guestsByIp.get(ticket.ipKey);
    if (ip) {
      if (ip.inflight > 0) ip.inflight -= 1;
      ip.used += 1;
    }
  }
}

export function releaseFreeCheck(ticket: CheckTicket) {
  if (ticket.settled) return;
  ticket.settled = true;
  if (ticket.kind === "account" && ticket.accountHash) {
    const account = getAccountByHash(ticket.accountHash);
    if (account) releaseAccountCheck(account);
    return;
  }
  if (ticket.guestId) {
    const bucket = guests.get(ticket.guestId);
    if (bucket && bucket.inflight > 0) bucket.inflight -= 1;
  }
  if (ticket.ipKey) {
    const ip = guestsByIp.get(ticket.ipKey);
    if (ip && ip.inflight > 0) ip.inflight -= 1;
  }
}

export async function gateFreeCheck(req: any, res: any): Promise<CheckTicket | null> {
  const result = await beginFreeCheck(req, res);
  if (result.ok) {
    const ticket = result.ticket;
    if (typeof req?.on === "function") {
      req.on("close", () => {
        if (!ticket.settled) commitFreeCheck(res, ticket);
      });
    }
    return ticket;
  }
  writeJson(res, 429, {
    error: "checks_exhausted",
    message: checksExhaustedMessage(result.kind),
  });
  return null;
}

export async function checksQuotaHandler(req: any, res: any) {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const quota = await peekCheckQuota(req);
  if (quota.enforced && quota.kind === "guest") {
    const { id, day, memory } = guestState(req);
    writeGuestCookie(res, { id, day, used: memory.used });
  }
  writeJson(res, 200, quota);
}

export function resetCheckQuotaForTests() {
  guests.clear();
  guestsByIp.clear();
  enforcedForTests = null;
}
