/**
 * 免费核查闸门。每个访客每天 2 条。
 * 开始时占位，出判断才扣；我们自己失败则放回；用户中途取消仍计一次。
 *
 * 额度分两个独立维度：访客桶（按 cookie id）与 IP 桶（整条来源 IP 的聚合）。
 * IP 是共享的，所以 IP 桶只当天花板、不当单人额度 —— 见 `guestState` 里的说明。
 */

import crypto from "node:crypto";
import {
  GUEST_DAILY_CHECKS,
  IP_DAILY_CHECKS,
  checksExhaustedMessage,
  shanghaiDayKey,
  type CheckQuotaKind,
  type CheckQuotaView,
} from "../../../src/lib/checkQuota.js";
import { cookieOptions, decodeSignedJson, encodeSignedJson, getServerSecret, parseCookies } from "./signedCookie.js";
import { loadSnapshot, registerSnapshotSource } from "./jsonSnapshot.js";

export const GUEST_CHECKS_COOKIE = "v3_guest_checks";
const GUEST_COOKIE_TTL_SECONDS = 2 * 24 * 60 * 60;

/** 非负整数环境变量；未设置或非法时回落到默认值。 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** 单个访客每天的免费核查数。`CHECK_QUOTA_GUEST_LIMIT` 可覆盖（测试期放宽用）。 */
export function guestDailyLimit(): number {
  return envInt("CHECK_QUOTA_GUEST_LIMIT", GUEST_DAILY_CHECKS);
}

/** 整条来源 IP 每天的核查总数上限。`CHECK_QUOTA_IP_LIMIT` 可覆盖。 */
export function ipDailyLimit(): number {
  return envInt("CHECK_QUOTA_IP_LIMIT", IP_DAILY_CHECKS);
}

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

// ── D1：访客配额桶持久化（重启后 inflight 不可信，清零；跨天的桶不再恢复）──
const QUOTA_SNAPSHOT_FILE = "quota.json";

function snapshotQuota() {
  const today = shanghaiDayKey();
  return {
    guests: [...guests.entries()].filter(([, b]) => b.day === today),
    guestsByIp: [...guestsByIp.entries()].filter(([, b]) => b.day === today),
  };
}

{
  const today = shanghaiDayKey();
  const restored = loadSnapshot<ReturnType<typeof snapshotQuota>>(QUOTA_SNAPSHOT_FILE);
  if (restored) {
    for (const [id, b] of restored.guests ?? []) if (b.day === today) guests.set(id, { ...b, inflight: 0 });
    for (const [ip, b] of restored.guestsByIp ?? [])
      if (b.day === today) guestsByIp.set(ip, { ...b, inflight: 0 });
  }
  registerSnapshotSource(QUOTA_SNAPSHOT_FILE, snapshotQuota);
}

export type CheckTicket = {
  kind: CheckQuotaKind;
  day: string;
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

/**
 * 运维旁路：开发者/服务器自己验证真实链路时不受免费额度限制。
 * token 只存在服务端 env（OPS_CHECK_BYPASS_TOKEN），未配置时旁路完全关闭；
 * 头名 x-ops-check-token。恒时比较防探测。
 */
export function hasOpsCheckBypass(req: { headers?: { [key: string]: unknown } }): boolean {
  const expected = process.env.OPS_CHECK_BYPASS_TOKEN?.trim();
  if (!expected) return false;
  const supplied = headerValue(req.headers?.["x-ops-check-token"]);
  if (!supplied) return false;
  const a = crypto.createHash("sha256").update(expected, "utf8").digest();
  const b = crypto.createHash("sha256").update(supplied, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
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
  // 访客桶只记这个访客自己的用量。
  // 这里曾经写成 `Math.max(memory.used, ip.used, cookieUsed)`：IP 桶是整条出口 IP 的聚合，
  // 那行会让同一网络下的新访客一进门就背上前一个人的用量，等于整条 IP 当天只允许 1 次核查。
  // IP 桶仍照常累加（见 commitFreeCheck），但只在 IP 天花板上起作用，不参与访客自己的额度。
  memory.used = Math.max(memory.used, cookieUsed);
  guests.set(id, memory);
  guestsByIp.set(ipKey, ip);
  return { id, day, memory, ip, ipKey };
}

function remainingOf(used: number, inflight: number, total: number) {
  return Math.max(0, total - used - inflight);
}

function bypassQuotaView(): CheckQuotaView {
  const total = guestDailyLimit();
  return { remaining: total, total, used: 0, kind: "guest", enforced: false };
}

/** 访客桶比单人额度，IP 桶比 IP 天花板；两者独立，任一触顶即拦。 */
function guestBlocked(memory: GuestBucket, ip: GuestBucket) {
  return (
    memory.used + memory.inflight >= guestDailyLimit() ||
    ip.used + ip.inflight >= ipDailyLimit()
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
  appendSetCookie(res, buildSetCookie(GUEST_CHECKS_COOKIE, token, cookieOptions(GUEST_COOKIE_TTL_SECONDS)));
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
  if (hasOpsCheckBypass(req)) return bypassQuotaView();
  if (!isCheckQuotaEnforced()) return bypassQuotaView();
  const { memory, ip } = guestState(req);
  // used 只报访客自己的用量；remaining 取「访客剩余」与「IP 剩余」的较小值，
  // 这样 IP 触顶时界面不会谎报还有额度。
  return {
    remaining: Math.min(
      remainingOf(memory.used, memory.inflight, guestDailyLimit()),
      remainingOf(ip.used, ip.inflight, ipDailyLimit())
    ),
    total: guestDailyLimit(),
    used: memory.used,
    kind: "guest",
    enforced: true,
  };
}

export async function beginFreeCheck(
  req: any,
  res: any
): Promise<{ ok: true; ticket: CheckTicket } | { ok: false; kind: CheckQuotaKind }> {
  if (hasOpsCheckBypass(req) || !isCheckQuotaEnforced()) {
    return { ok: true, ticket: { kind: "guest", day: shanghaiDayKey(), settled: true } };
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
  // 名额由拿到票据的处理器结算（handlers.ts 与 http/runOutcome.ts），这里不挂连接关闭监听：
  // 请求体读完之后才挂的 close 监听，触不触发取决于时序（#117）。
  if (result.ok) return result.ticket;
  writeJson(res, 429, {
    error: "checks_exhausted",
    message: checksExhaustedMessage(),
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

/**
 * 访客身份：分享靠它认「同一个浏览器」。cookie 已有就沿用里面的 id，不改写（改写会把访客当天的核查用量清零）；
 * 没有或读不出时发一个新的。`preferredId` 是额度闸门在这次响应里刚发出的 id，用它免得一次响应里出现两个不同 id。
 */
export function ensureGuestId(req: any, res: any, preferredId?: string): string {
  const cookie = readGuestCookie(req);
  if (cookie?.id) return cookie.id;
  if (preferredId) return preferredId;
  const id = crypto.randomBytes(12).toString("hex");
  writeGuestCookie(res, { id, day: shanghaiDayKey(), used: 0 });
  return id;
}

/** 请求里已有的访客 id；没有 cookie 就是 null（不发新的）。 */
export function guestIdFromRequest(req: any): string | null {
  return readGuestCookie(req)?.id ?? null;
}

/** 存进 runs.ownerHash 的值：访客 id 的哈希，库里不放 id 原文。 */
export function guestOwnerHash(guestId: string): string {
  return crypto.createHash("sha256").update(`guest-owner|${guestId}`, "utf8").digest("hex").slice(0, 32);
}

/** 来源 IP 的哈希（加了服务端密钥），给分享限额用。 */
export function clientIpKey(req: any): string {
  return hashIp(clientIp(req));
}

export function resetCheckQuotaForTests() {
  guests.clear();
  guestsByIp.clear();
  enforcedForTests = null;
}
