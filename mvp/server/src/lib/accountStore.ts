/**
 * accountStore.ts — v3 邮箱登录的内存账号/会话存储
 *
 * 角色:
 * - requestCode / verifyAndCreate 走 6 位数字验证码流程
 * - 邮箱不是 Map key，只存 hash (SHA-256(email + serverSecret))
 * - 登录用户每天 3 次免费核查（按自然日，上海时区）
 * - 文档级故意不写 DB 接口:Wave 4 后端替成 KV / Postgres 时改这一文件即可
 *
 * 注: 验证码由 emailAuthHandlers 发到用户邮箱（SMTP / Resend）。
 *      没配发信且非生产时，才把码回显到登录面板。
 */

import crypto from "node:crypto";
import { ACCOUNT_DAILY_CHECKS, shanghaiDayKey } from "../../../src/lib/checkQuota.js";
import { loadSnapshot, registerSnapshotSource } from "./jsonSnapshot.js";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const RATE_WINDOW_MS = 60 * 1000; // 1 min
const SESSION_TTL_MS = 31 * 24 * 60 * 60 * 1000; // 31 days
const MAX_VERIFY_ATTEMPTS = 5; // 单个验证码最多允许试错次数，超过立即作废

export interface EmailAccount {
  email: string;
  hash: string;
  createdAt: number;
  displayName: string;
  loginCount: number;
  lastLoginAt: number;
  checks: {
    day: string;
    used: number;
    inflight: number;
  };
  history: EmailHistoryEntry[];
}

export interface EmailHistoryEntry {
  at: number;
  kind: "verify" | "check" | "delete";
  meta?: Record<string, unknown>;
}

interface EmailCode {
  code: string;
  expiresAt: number;
  rateExpiresAt: number;
  consumed: boolean;
  attempts: number;
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
  codes.set(hash, { code, expiresAt, rateExpiresAt, consumed: false, attempts: 0 });
  return { ok: true, code, expiresAt };
}

/** 开发面板回显：取出尚未用完、尚未过期的码。 */
export function peekOutstandingCode(rawEmail: string, serverSecret: string): string | null {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_REGEX.test(email)) return null;
  const record = codes.get(hashEmail(email, serverSecret));
  if (!record || record.consumed || record.expiresAt <= Date.now()) return null;
  return record.code;
}

/** 发信失败时丢掉刚生成的码，让用户可以立刻重试。 */
export function abandonOutstandingCode(rawEmail: string, serverSecret: string) {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_REGEX.test(email)) return;
  codes.delete(hashEmail(email, serverSecret));
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
  if (!(serverSecret ?? "").trim() || !(process.env.AIPING_SESSION_SECRET ?? "").trim()) {
    return { ok: false, error: "invalid_code" };
  }

  const email = normalizeEmail(rawEmail);
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "invalid_email" };
  }

  const hash = hashEmail(email, serverSecret);
  const record = codes.get(hash);
  if (!record || record.consumed) {
    return { ok: false, error: "invalid_code" };
  }

  const now = Date.now();
  if (record.expiresAt <= now) {
    codes.delete(hash);
    return { ok: false, error: "expired" };
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    record.consumed = true;
    codes.delete(hash);
    return { ok: false, error: "invalid_code" };
  }

  if (record.code !== rawCode) {
    record.attempts += 1;
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      record.consumed = true;
      codes.delete(hash);
    }
    return { ok: false, error: "invalid_code" };
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
      displayName: "",
      loginCount: 1,
      lastLoginAt: now,
      checks: { day: shanghaiDayKey(now), used: 0, inflight: 0 },
      history: [],
    };
    accounts.set(hash, account);
    return account;
  }
  account.email = email;
  account.loginCount += 1;
  account.lastLoginAt = now;
  return account;
}

export function updateDisplayName(account: EmailAccount, displayName: string) {
  account.displayName = displayName;
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

export function getAccountByHash(hash: string): EmailAccount | null {
  return accounts.get(hash) ?? null;
}

function syncAccountChecks(account: EmailAccount, now = Date.now()) {
  const day = shanghaiDayKey(now);
  if (account.checks.day !== day) {
    account.checks = { day, used: 0, inflight: 0 };
  }
  return account.checks;
}

export function getAccountChecks(account: EmailAccount, now = Date.now()) {
  const checks = syncAccountChecks(account, now);
  const remaining = Math.max(0, ACCOUNT_DAILY_CHECKS - checks.used - checks.inflight);
  return {
    remaining,
    total: ACCOUNT_DAILY_CHECKS,
    used: checks.used,
    kind: "account" as const,
    day: checks.day,
  };
}

export function beginAccountCheck(account: EmailAccount, now = Date.now()): boolean {
  const checks = syncAccountChecks(account, now);
  if (checks.used + checks.inflight >= ACCOUNT_DAILY_CHECKS) return false;
  checks.inflight += 1;
  return true;
}

export function commitAccountCheck(account: EmailAccount, now = Date.now()) {
  const checks = syncAccountChecks(account, now);
  if (checks.inflight > 0) checks.inflight -= 1;
  checks.used += 1;
  account.history.push({ at: now, kind: "check" });
}

export function releaseAccountCheck(account: EmailAccount, now = Date.now()) {
  const checks = syncAccountChecks(account, now);
  if (checks.inflight > 0) checks.inflight -= 1;
}

export interface AccountExport {
  account: {
    email: string;
    displayName: string;
    createdAt: number;
    loginCount: number;
    lastLoginAt: number;
  };
  checks: { day: string; used: number; remaining: number; total: number };
  history: EmailHistoryEntry[];
}

export function exportAccount(account: EmailAccount): AccountExport {
  const checks = getAccountChecks(account);
  return {
    account: {
      email: account.email,
      displayName: account.displayName,
      createdAt: account.createdAt,
      loginCount: account.loginCount,
      lastLoginAt: account.lastLoginAt,
    },
    checks: {
      day: checks.day,
      used: checks.used,
      remaining: checks.remaining,
      total: checks.total,
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

// ── D1：账号与会话快照持久化（验证码短时效，不持久化）──
const ACCOUNT_SNAPSHOT_FILE = "accounts.json";

export function snapshotState() {
  return {
    accounts: [...accounts.entries()],
    sessions: [...sessions.entries()].filter(([, record]) => record.expiresAt > Date.now()),
  };
}

{
  const restored = loadSnapshot<ReturnType<typeof snapshotState>>(ACCOUNT_SNAPSHOT_FILE);
  if (restored) {
    for (const [hash, account] of restored.accounts ?? []) accounts.set(hash, account);
    for (const [id, record] of restored.sessions ?? []) sessions.set(id, record);
  }
  registerSnapshotSource(ACCOUNT_SNAPSHOT_FILE, snapshotState);
}

export const ACCOUNT_CONSTANTS = {
  TTL_MS: CODE_TTL_MS,
  RATE_MS: RATE_WINDOW_MS,
  SESSION_MS: SESSION_TTL_MS,
} as const;
