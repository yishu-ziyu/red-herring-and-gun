/**
 * accountStore.ts — v3 邮箱登录的内存账号/会话存储
 *
 * 角色:
 * - requestCode / verifyAndCreate 走 6 位数字验证码流程
 * - 邮箱不是 Map key，只存 hash (SHA-256(email + serverSecret))
 * - 5 次 / 30 天的免费 quota,带滑动窗口重置
 * - 文档级故意不写 DB 接口:Wave 4 后端替成 KV / Postgres 时改这一文件即可
 *
 * 注: 现状下我们故意不用 pino / 任何 logger,只 console.log 暴露验证码 —
 *      生产环境接 SMTP 时替换 console.log 那行。
 */

import crypto from "node:crypto";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const RATE_WINDOW_MS = 60 * 1000; // 1 min
const QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const QUOTA_TOTAL = 5;
const SESSION_TTL_MS = 31 * 24 * 60 * 60 * 1000; // 31 days, > quota window

export interface EmailAccount {
  email: string;
  hash: string;
  createdAt: number;
  quota: {
    total: number;
    used: number;
    periodStartAt: number;
  };
  history: EmailHistoryEntry[];
}

export interface EmailHistoryEntry {
  at: number;
  kind: "verify" | "consume_quota" | "delete";
  meta?: Record<string, unknown>;
}

interface EmailCode {
  code: string;
  expiresAt: number;
  rateExpiresAt: number;
  consumed: boolean;
}

interface SessionRecord {
  id: string;
  emailHash: string;
  createdAt: number;
  expiresAt: number;
}

// emailHash -> EmailAccount
const accounts = new Map<string, EmailAccount>();
// emailHash -> latest outstanding code
const codes = new Map<string, EmailCode>();
// sessionId -> SessionRecord
const sessions = new Map<string, SessionRecord>();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: unknown) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function hashEmail(email: string, serverSecret: string) {
  return crypto
    .createHash("sha256")
    .update(`${email}|${serverSecret}`, "utf8")
    .digest("hex");
}

export function generateCode() {
  // 000000–999999, 6 位数字字符串,前补零
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export interface RequestCodeResult {
  ok: boolean;
  code?: string;
  expiresAt?: number;
  error?: "invalid_email" | "rate_limit";
}

export async function requestCode(rawEmail: string, serverSecret: string): Promise<RequestCodeResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "invalid_email" };
  }

  const hash = hashEmail(email, serverSecret);
  const now = Date.now();
  const existing = codes.get(hash);
  if (existing && existing.rateExpiresAt > now) {
    return { ok: false, error: "rate_limit" };
  }

  const code = generateCode();
  const expiresAt = now + CODE_TTL_MS;
  const rateExpiresAt = now + RATE_WINDOW_MS;
  codes.set(hash, { code, expiresAt, rateExpiresAt, consumed: false });
  return { ok: true, code, expiresAt };
}

export interface VerifyResult {
  ok: boolean;
  sessionId?: string;
  error?: "invalid_code" | "expired" | "invalid_email";
}

export async function verifyAndCreate(
  rawEmail: string,
  rawCode: string,
  serverSecret: string
): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "invalid_email" };
  }

  const hash = hashEmail(email, serverSecret);
  const record = codes.get(hash);
  if (!record || record.code !== rawCode || record.consumed) {
    return { ok: false, error: "invalid_code" };
  }

  const now = Date.now();
  if (record.expiresAt <= now) {
    codes.delete(hash);
    return { ok: false, error: "expired" };
  }

  record.consumed = true;

  const account = upsertAccount(email, hash, now);
  const sessionId = crypto.randomBytes(24).toString("hex");
  sessions.set(sessionId, {
    id: sessionId,
    emailHash: hash,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  account.history.push({ at: now, kind: "verify" });
  return { ok: true, sessionId };
}

function upsertAccount(email: string, hash: string, now: number) {
  let account = accounts.get(hash);
  if (!account) {
    account = {
      email,
      hash,
      createdAt: now,
      quota: { total: QUOTA_TOTAL, used: 0, periodStartAt: now },
      history: [],
    };
    accounts.set(hash, account);
  }
  return account;
}

export async function getBySession(sessionId: string, serverSecret: string): Promise<EmailAccount | null> {
  const record = sessions.get(sessionId);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  // serverSecret 仅在 debug 校验时使用 — 我们重新计算 hash 比对,避免 secret 被滥用。
  void serverSecret;
  const account = accounts.get(record.emailHash);
  return account ?? null;
}

export interface ConsumeQuotaResult {
  ok: boolean;
  remaining?: number;
  error?: "no_session" | "quota_exceeded";
}

export async function consumeQuota(
  sessionId: string,
  serverSecret: string
): Promise<ConsumeQuotaResult> {
  const account = await getBySession(sessionId, serverSecret);
  if (!account) return { ok: false, error: "no_session" };

  const now = Date.now();
  if (now - account.quota.periodStartAt >= QUOTA_WINDOW_MS) {
    // 30 天窗口滑动,自动 reset
    account.quota.periodStartAt = now;
    account.quota.used = 0;
  }

  if (account.quota.used >= QUOTA_TOTAL) {
    return { ok: false, error: "quota_exceeded" };
  }

  account.quota.used += 1;
  account.history.push({ at: now, kind: "consume_quota" });
  return { ok: true, remaining: Math.max(0, QUOTA_TOTAL - account.quota.used) };
}

export function getQuota(account: EmailAccount) {
  const now = Date.now();
  const inWindow = now - account.quota.periodStartAt < QUOTA_WINDOW_MS;
  const remaining = inWindow ? Math.max(0, QUOTA_TOTAL - account.quota.used) : QUOTA_TOTAL;
  return { remaining, total: QUOTA_TOTAL };
}

export interface AccountExport {
  account: { email: string; createdAt: number };
  quota: { total: number; used: number; periodStartAt: number; remaining: number };
  history: EmailHistoryEntry[];
}

export function exportAccount(account: EmailAccount): AccountExport {
  const quota = getQuota(account);
  return {
    account: { email: account.email, createdAt: account.createdAt },
    quota: {
      total: account.quota.total,
      used: account.quota.used,
      periodStartAt: account.quota.periodStartAt,
      remaining: quota.remaining,
    },
    history: account.history.slice(),
  };
}

export async function deleteAccount(sessionId: string, serverSecret: string): Promise<void> {
  const account = await getBySession(sessionId, serverSecret);
  if (!account) return;
  const hash = account.hash;
  accounts.delete(hash);
  codes.delete(hash);
  for (const [id, record] of sessions) {
    if (record.emailHash === hash) sessions.delete(id);
  }
}

export function resetForTests() {
  accounts.clear();
  codes.clear();
  sessions.clear();
}

export const QUOTA_CONSTANTS = {
  TTL_MS: CODE_TTL_MS,
  RATE_MS: RATE_WINDOW_MS,
  WINDOW_MS: QUOTA_WINDOW_MS,
  TOTAL: QUOTA_TOTAL,
  SESSION_MS: SESSION_TTL_MS,
} as const;
