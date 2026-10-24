/**
 * 每日额度账本：核查（check）和建分享（share）共用。
 * 开始时占位（inflight），出结果才记一次（used）；我们自己失败则放回。
 *
 * 每种额度分两个独立维度：访客桶（按 cookie id）与 IP 桶（整条来源 IP 的聚合）。
 * IP 是共享的，所以 IP 桶只当天花板、不当单人额度；任一触顶即拦。
 */
import {
  GUEST_DAILY_CHECKS,
  GUEST_DAILY_SHARES,
  IP_DAILY_CHECKS,
  IP_DAILY_SHARES,
  shanghaiDayKey,
} from "../../../shared/quota.js";
import type { GuestIdentity } from "./guestIdentity.js";
import { loadSnapshot, registerSnapshotSource } from "./jsonSnapshot.js";
import type { RunOutcome } from "./run/outcome.js";

export type QuotaKind = "check" | "share";

/** 一次占位。只有第一次结算生效；run 的占位由 RunService 在 run 落终态时按结局结算。 */
export type Reservation = {
  commit(): void;
  release(): void;
  settle(outcome: RunOutcome): void;
};

/** 每种结局的核查额度结算：commit 计入今天的次数，release 退还。 */
const QUOTA_SETTLEMENT: Record<RunOutcome, "commit" | "release"> = {
  completed: "commit",
  reused: "release",
  cancelled: "release",
  // 超时给了中间结论，照常计费。
  "timed-out": "commit",
  "client-gone": "commit",
  "server-error": "release",
};

/** 非负整数环境变量；未设置或非法时回落到默认值。 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** 单人每天的上限与整条来源 IP 每天的上限。核查额度可用 `CHECK_QUOTA_GUEST_LIMIT` / `CHECK_QUOTA_IP_LIMIT` 覆盖（放宽额度用）。 */
const LIMITS: Record<QuotaKind, () => { guest: number; ip: number }> = {
  check: () => ({
    guest: envInt("CHECK_QUOTA_GUEST_LIMIT", GUEST_DAILY_CHECKS),
    ip: envInt("CHECK_QUOTA_IP_LIMIT", IP_DAILY_CHECKS),
  }),
  share: () => ({ guest: GUEST_DAILY_SHARES, ip: IP_DAILY_SHARES }),
};

type Bucket = {
  day: string;
  used: number;
  inflight: number;
};

const buckets: Record<QuotaKind, { guests: Map<string, Bucket>; ips: Map<string, Bucket> }> = {
  check: { guests: new Map(), ips: new Map() },
  share: { guests: new Map(), ips: new Map() },
};

// ── 持久化（重启后 inflight 不可信，清零；跨天的桶不再恢复）──
const QUOTA_SNAPSHOT_FILE = "quota.json";
type BucketRows = Array<[string, Bucket]>;
type QuotaSnapshot = { guests?: BucketRows; guestsByIp?: BucketRows; shareGuests?: BucketRows; shareIps?: BucketRows };

function snapshotQuota(): QuotaSnapshot {
  const today = shanghaiDayKey();
  const rows = (map: Map<string, Bucket>): BucketRows => [...map.entries()].filter(([, b]) => b.day === today);
  return {
    guests: rows(buckets.check.guests),
    guestsByIp: rows(buckets.check.ips),
    shareGuests: rows(buckets.share.guests),
    shareIps: rows(buckets.share.ips),
  };
}

{
  const today = shanghaiDayKey();
  const restored = loadSnapshot<QuotaSnapshot>(QUOTA_SNAPSHOT_FILE);
  const restore = (map: Map<string, Bucket>, rows: BucketRows | undefined) => {
    for (const [key, b] of rows ?? []) if (b.day === today) map.set(key, { ...b, inflight: 0 });
  };
  if (restored) {
    restore(buckets.check.guests, restored.guests);
    restore(buckets.check.ips, restored.guestsByIp);
    restore(buckets.share.guests, restored.shareGuests);
    restore(buckets.share.ips, restored.shareIps);
  }
  registerSnapshotSource(QUOTA_SNAPSHOT_FILE, snapshotQuota);
}

function syncBucket(bucket: Bucket | undefined, day: string): Bucket {
  if (!bucket || bucket.day !== day) return { day, used: 0, inflight: 0 };
  return bucket;
}

function bucketsFor(identity: GuestIdentity, kind: QuotaKind, now = Date.now()) {
  const day = shanghaiDayKey(now);
  const { guests, ips } = buckets[kind];
  const guest = syncBucket(guests.get(identity.id), day);
  const ip = syncBucket(ips.get(identity.ipKey), day);
  // 核查用量还记在访客 cookie 里：只合并本人的内存与 cookie 计数；IP 聚合用量只用于 IP 限额，不能计入个人额度。
  if (kind === "check" && identity.cookieUse?.day === day) guest.used = Math.max(guest.used, identity.cookieUse.used);
  guests.set(identity.id, guest);
  ips.set(identity.ipKey, ip);
  return { day, guest, ip };
}

const remainingOf = (bucket: Bucket, total: number) => Math.max(0, total - bucket.used - bucket.inflight);

export function guestDailyLimit(kind: QuotaKind): number {
  return LIMITS[kind]().guest;
}

/** 访客自己的用量；remaining 取「访客剩余」与「IP 剩余」的较小值，这样 IP 触顶时界面不会谎报还有额度。 */
export function quotaUsage(identity: GuestIdentity, kind: QuotaKind) {
  const { day, guest, ip } = bucketsFor(identity, kind);
  const limits = LIMITS[kind]();
  return {
    day,
    used: guest.used,
    total: limits.guest,
    remaining: Math.min(remainingOf(guest, limits.guest), remainingOf(ip, limits.ip)),
  };
}

/** 占一个名额；任一维度触顶时返回 null。 */
export function reserveQuota(identity: GuestIdentity, kind: QuotaKind): Reservation | null {
  const { guest, ip } = bucketsFor(identity, kind);
  const limits = LIMITS[kind]();
  if (guest.used + guest.inflight >= limits.guest || ip.used + ip.inflight >= limits.ip) return null;
  guest.inflight += 1;
  ip.inflight += 1;
  const { guests, ips } = buckets[kind];
  const finish = (used: boolean) => {
    for (const bucket of [guests.get(identity.id), ips.get(identity.ipKey)]) {
      if (!bucket) continue;
      if (bucket.inflight > 0) bucket.inflight -= 1;
      if (used) bucket.used += 1;
    }
  };
  return settledOnce(() => finish(true), () => finish(false));
}

/** 不计额度的占位（开发环境、运维旁路）：结算什么也不做。 */
export function unmeteredReservation(): Reservation {
  return settledOnce(() => {}, () => {});
}

function settledOnce(onCommit: () => void, onRelease: () => void): Reservation {
  let settled = false;
  const once = (fn: () => void) => () => {
    if (settled) return;
    settled = true;
    fn();
  };
  const commit = once(onCommit);
  const release = once(onRelease);
  return {
    commit,
    release,
    settle: (outcome) => (QUOTA_SETTLEMENT[outcome] === "commit" ? commit() : release()),
  };
}
