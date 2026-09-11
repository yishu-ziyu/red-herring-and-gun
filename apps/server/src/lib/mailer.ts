/**
 * 把登录验证码发到用户邮箱。支持 Resend（HTTPS）或 SMTP。
 * 没配发信凭据时不要假装已经寄出。
 */

import { readFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import tls from "node:tls";

export type EnvMap = Record<string, string | undefined>;

export type MailTransport =
  | { kind: "resend"; apiKey: string; from: string; fromName: string }
  | {
      kind: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      from: string;
      fromName: string;
    };

export const DEV_PANEL_MESSAGE = "还没配发信。开发环境验证码显示在面板上。";
export const EMAIL_SENT_MESSAGE = "验证码已发送";
export const MAIL_UNAVAILABLE_MESSAGE = "还没配发信，暂时没法发验证码。不登录也能查。";
export const MAIL_SEND_FAILED_MESSAGE = "验证码邮件没发出去，请稍后再试";
export const MAIL_KEY_INVALID_MESSAGE = "发信钥匙无效。请到 Resend 点复制，把完整 API Key 贴进 .env.local。";
export const MAIL_DOMAIN_UNVERIFIED_MESSAGE =
  "测试发件地址已经不能用。需要在 Resend 验证 mail.yishuziyu.cn，并把 DNS 加到阿里云。";

const PRODUCT_FROM_NAME = "红鲱鱼与枪";
const SMTP_TIMEOUT_MS = 20_000;
const MAIL_ENV_KEYS = new Set([
  "RESEND_API_KEY",
  "MAIL_FROM",
  "MAIL_FROM_NAME",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
]);

function overlayMailEnvFromDotenv(env: EnvMap): EnvMap {
  if (env.VITEST === "true" || env.NODE_ENV === "test") return env;
  const candidates = [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), "../.env.local")];
  let text = "";
  for (const path of candidates) {
    try {
      text = readFileSync(path, "utf8");
      break;
    } catch {
      // try next
    }
  }
  if (!text) return env;
  const extra: EnvMap = { ...env };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!MAIL_ENV_KEYS.has(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    extra[key] = value;
  }
  return extra;
}

function readEnv(env: EnvMap, key: string): string {
  return (env[key] ?? "").trim();
}

function mailFrom(env: EnvMap): string {
  return readEnv(env, "MAIL_FROM");
}

function mailFromName(env: EnvMap): string {
  return readEnv(env, "MAIL_FROM_NAME") || PRODUCT_FROM_NAME;
}

export function resolveMailTransport(env: EnvMap = process.env): MailTransport | null {
  const resolved = env === process.env ? overlayMailEnvFromDotenv(env) : env;
  const from = mailFrom(resolved);
  const fromName = mailFromName(resolved);
  if (!from) return null;

  const resendKey = readEnv(resolved, "RESEND_API_KEY");
  if (resendKey) {
    return { kind: "resend", apiKey: resendKey, from, fromName };
  }

  const host = readEnv(resolved, "SMTP_HOST");
  const user = readEnv(resolved, "SMTP_USER");
  const pass = readEnv(resolved, "SMTP_PASS");
  if (!host || !user || !pass) return null;

  const portRaw = readEnv(resolved, "SMTP_PORT");
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port) || port <= 0) return null;

  const secureFlag = readEnv(resolved, "SMTP_SECURE").toLowerCase();
  const secure = secureFlag === "true" || secureFlag === "1" || (!secureFlag && port === 465);

  return { kind: "smtp", host, port, secure, user, pass, from, fromName };
}

export function isMailConfigured(env: EnvMap = process.env): boolean {
  return resolveMailTransport(env) !== null;
}

export function publicMailSendFailureMessage(detail: string): string {
  if (/API key is invalid/i.test(detail)) return MAIL_KEY_INVALID_MESSAGE;
  if (/example\.com domain is not verified/i.test(detail)) return MAIL_DOMAIN_UNVERIFIED_MESSAGE;
  if (/domain/i.test(detail) && /verif/i.test(detail)) return MAIL_DOMAIN_UNVERIFIED_MESSAGE;
  if (/only send testing emails to your own email/i.test(detail)) {
    return "这个测试发件人只能寄到 Resend 账号本人邮箱。要给任意邮箱发，需要验证 mail.yishuziyu.cn。";
  }
  return MAIL_SEND_FAILED_MESSAGE;
}

export function formatFromHeader(from: string, fromName: string): string {
  if (from.includes("<")) return from;
  return `${fromName} <${from}>`;
}

export function extractMailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] ?? from).trim();
}

export function buildVerificationEmail(code: string): { subject: string; text: string } {
  return {
    subject: "红鲱鱼与枪 验证码",
    text: [
      `这是红鲱鱼与枪的登录验证码：${code}`,
      "",
      "10 分钟内有效。用来确认是你在查这条信息。不登录也可以继续核查。",
    ].join("\n"),
  };
}

type VerificationMailSender = (to: string, code: string) => Promise<void>;

let senderForTests: VerificationMailSender | null = null;

export function setVerificationMailSenderForTests(sender: VerificationMailSender | null) {
  senderForTests = sender;
}

export async function deliverVerificationCode(to: string, code: string): Promise<void> {
  if (senderForTests) {
    await senderForTests(to, code);
    return;
  }
  await sendVerificationCodeEmail({ to, code });
}

export async function sendVerificationCodeEmail({
  to,
  code,
  env = process.env,
  fetchImpl = fetch,
}: {
  to: string;
  code: string;
  env?: EnvMap;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const transport = resolveMailTransport(env);
  if (!transport) {
    throw new Error("mail_unconfigured");
  }
  const mail = buildVerificationEmail(code);
  const from = formatFromHeader(transport.from, transport.fromName);
  if (transport.kind === "resend") {
    await sendViaResend({
      transport,
      to,
      from: extractMailAddress(from),
      mail,
      fetchImpl,
    });
    return;
  }
  await sendViaSmtp({ transport, to, mail });
}

async function sendViaResend({
  transport,
  to,
  from,
  mail,
  fetchImpl,
}: {
  transport: Extract<MailTransport, { kind: "resend" }>;
  to: string;
  from: string;
  mail: { subject: string; text: string };
  fetchImpl: typeof fetch;
}) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${transport.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "red-herring-and-gun/mvp",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: mail.subject,
      text: mail.text,
    }),
  });
  const payload = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(`Resend 发信失败：${detail}（from=${from}）`);
  }
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function sendViaSmtp({
  transport,
  to,
  mail,
}: {
  transport: Extract<MailTransport, { kind: "smtp" }>;
  to: string;
  mail: { subject: string; text: string };
}) {
  const envelopeFrom = transport.from.includes("<")
    ? (transport.from.match(/<([^>]+)>/)?.[1] ?? transport.from)
    : transport.from;

  await withTimeout(
    (async () => {
      let socket: net.Socket = await connectSocket(transport.host, transport.port, transport.secure);
      try {
        let session = attachSmtp(socket);
        await session.expect(220);
        await session.command(`EHLO red-herring`, 250);
        if (!transport.secure) {
          await session.command("STARTTLS", 220);
          socket = await upgradeTls(socket, transport.host);
          session = attachSmtp(socket);
          await session.command(`EHLO red-herring`, 250);
        }
        await authenticateSmtp(session, transport.user, transport.pass);
        await session.command(`MAIL FROM:<${envelopeFrom}>`, 250);
        await session.command(`RCPT TO:<${to}>`, 250);
        await session.command("DATA", 354);
        const data = [
          `From: ${encodeHeader(transport.fromName)} <${envelopeFrom}>`,
          `To: ${to}`,
          `Subject: ${encodeHeader(mail.subject)}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=utf-8",
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(mail.text, "utf8").toString("base64"),
          ".",
        ].join("\r\n");
        await session.command(data, 250);
        await session.command("QUIT", 221).catch(() => undefined);
      } finally {
        socket.destroy();
      }
    })(),
    SMTP_TIMEOUT_MS,
    "SMTP 发信"
  );
}

async function authenticateSmtp(session: SmtpSession, user: string, pass: string) {
  const plain = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
  const plainReply = await session.command(`AUTH PLAIN ${plain}`);
  if (plainReply.code === 235) return;
  if (plainReply.code === 535) {
    throw new Error(`SMTP 认证失败：${plainReply.text}`);
  }
  if (plainReply.code !== 504 && plainReply.code !== 534 && plainReply.code < 500) {
    throw new Error(`SMTP AUTH PLAIN 失败：${plainReply.code} ${plainReply.text}`);
  }
  await session.command("AUTH LOGIN", 334);
  await session.command(Buffer.from(user, "utf8").toString("base64"), 334);
  await session.command(Buffer.from(pass, "utf8").toString("base64"), 235);
}

function connectSocket(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      socket.removeListener("error", fail);
      resolve(socket);
    };
    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.once("timeout", () => fail(new Error("SMTP 连接超时")));
    socket.once("error", fail);
    if (secure) socket.once("secureConnect", ok);
    else socket.once("connect", ok);
  });
}

function upgradeTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, servername: host });
    upgraded.setTimeout(SMTP_TIMEOUT_MS);
    upgraded.once("timeout", () => {
      upgraded.destroy();
      reject(new Error("SMTP STARTTLS 超时"));
    });
    upgraded.once("error", (error) => {
      upgraded.destroy();
      reject(error);
    });
    upgraded.once("secureConnect", () => resolve(upgraded));
  });
}

type SmtpSession = {
  expect: (code: number) => Promise<{ code: number; text: string }>;
  command: (line: string, expected?: number) => Promise<{ code: number; text: string }>;
};

function attachSmtp(socket: net.Socket): SmtpSession {
  let buffer = "";
  const queued: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queued.push(line);
      idx = buffer.indexOf("\n");
    }
  };
  socket.on("data", onData);

  async function readLine(): Promise<string> {
    if (queued.length > 0) return queued.shift() as string;
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      socket.once("error", fail);
      socket.once("timeout", () => fail(new Error("SMTP 读超时")));
      socket.once("end", () => fail(new Error("SMTP 连接已关闭")));
      waiters.push((line) => {
        socket.off("error", fail);
        socket.off("timeout", fail);
        socket.off("end", fail);
        resolve(line);
      });
    });
  }

  async function readReply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const line = await readLine();
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) throw new Error(`SMTP 无法解析：${line}`);
      if (match[2] === " ") {
        return { code: Number(match[1]), text: lines.join("\n") };
      }
    }
  }

  async function expect(code: number) {
    const reply = await readReply();
    if (reply.code !== code) {
      throw new Error(`SMTP 期望 ${code}，收到 ${reply.code} ${reply.text}`);
    }
    return reply;
  }

  async function command(line: string, expected?: number) {
    socket.write(`${line}\r\n`);
    const reply = await readReply();
    if (expected !== undefined && reply.code !== expected) {
      throw new Error(`SMTP 期望 ${expected}，收到 ${reply.code} ${reply.text}`);
    }
    return reply;
  }

  return { expect, command };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
