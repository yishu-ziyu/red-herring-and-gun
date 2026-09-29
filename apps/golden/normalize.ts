/**
 * 归一化：把每次运行都会变、又不属于行为的东西换成稳定占位符，其余逐字保留。
 *
 * 换掉的：时间（按键名）、今天的日期字符串、ISO 时间串、runId / caseId / 分享令牌 / UUID / 验证码
 * （按首次出现顺序编号）、耗时毫秒。对象键按字母序输出（JSON 对象无序，键序不是契约）；数组顺序保留。
 *
 * SSE 帧分两组：客户端消费的帧按到达顺序严格比对；客户端显式忽略的过程帧（agent_* / tool_* /
 * search_progress / consensus_*）按多重集合比对，另留一份类型序列供查看顺序变化。
 */
import type { Capture, Frame } from "./harness.js";

/** 客户端 `useInvestigationRun` 消费的帧类型（其余在 IGNORED_LEGACY_EVENT_TYPES 里被丢弃）。 */
export const CONSUMED_FRAME_TYPES = new Set([
  "run_started",
  "run_state",
  "investigation_snapshot",
  "investigation_activity",
  "timeout_pending",
  "complete",
  "error",
]);

const TIME_KEYS = new Set([
  "timestamp",
  "at",
  "createdAt",
  "updatedAt",
  "ts",
  "checkedAt",
  "retrievedAt",
  "lastLoginAt",
  "expiresAt",
  "appliedAt",
  "scrapedAt",
  "lastVerifiedAt",
  "revokedAt",
  "rateExpiresAt",
  "startedAt",
  "finishedAt",
  "ranAt",
  "time",
  "occurredAt",
]);
const DURATION_KEYS = new Set(["latencyMs", "elapsedMs", "ms", "seconds", "durationMs"]);
const ID_KINDS: Record<string, string> = {
  runId: "run",
  sourceRunId: "run",
  caseId: "case",
  priorCaseId: "case",
  shareId: "share",
  devCode: "code",
  guestId: "guest",
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

export function today(now = new Date()): string[] {
  const shanghai = new Date(now.getTime() + 8 * 3600_000);
  const y = shanghai.getUTCFullYear();
  const m = shanghai.getUTCMonth() + 1;
  const d = shanghai.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = new Date(now);
  const ly = local.getFullYear();
  const lm = local.getMonth() + 1;
  const ld = local.getDate();
  return [...new Set([
    `${y}-${pad(m)}-${pad(d)}`,
    `${y}/${m}/${d}`,
    `${y}年${m}月${d}日`,
    `${ly}-${pad(lm)}-${pad(ld)}`,
    `${ly}/${lm}/${ld}`,
    `${ly}年${lm}月${ld}日`,
  ])];
}

type Registry = {
  byValue: Map<string, string>;
  counters: Map<string, number>;
};

function register(registry: Registry, kind: string, value: string): string {
  const existing = registry.byValue.get(value);
  if (existing) return existing;
  const n = (registry.counters.get(kind) ?? 0) + 1;
  registry.counters.set(kind, n);
  const placeholder = `<${kind}:${n}>`;
  registry.byValue.set(value, placeholder);
  return placeholder;
}

/** 第一遍：按确定的遍历顺序登记所有易变标识。 */
function collect(value: unknown, registry: Registry, key = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, registry, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>).sort()) collect((value as Record<string, unknown>)[k], registry, k);
    return;
  }
  if (typeof value !== "string" || !value) return;
  const kind = ID_KINDS[key];
  if (kind) register(registry, kind, value);
  if (key === "url" && value.startsWith("/s/")) register(registry, "share-token", value.slice(3));
  for (const match of value.match(UUID_RE) ?? []) register(registry, "uuid", match.toLowerCase());
}

/** 字符串里嵌着的毫秒时间戳（如 `debate-1790617194865`）。 */
const EPOCH_IN_TEXT_RE = /(?<!\d)1[6-9]\d{11}(?!\d)/g;

/** harness 自己起的本机服务（假 LLM 等）端口每次随机。 */
const LOOPBACK_PORT_RE = /(127\.0\.0\.1|localhost):\d{2,5}/g;
/** 旧 cases.json 导入时的备份文件名带时间：cases.json.bak-2026-09-29T03-37-30-543Z。 */
const BACKUP_STAMP_RE = /\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g;

function replaceStrings(text: string, registry: Registry, todays: string[]): string {
  let out = text
    .replace(ISO_RE, "<iso>")
    .replace(EPOCH_IN_TEXT_RE, "<epoch>")
    .replace(LOOPBACK_PORT_RE, "$1:<port>")
    .replace(BACKUP_STAMP_RE, ".bak-<ts>");
  out = out.replace(UUID_RE, (match) => registry.byValue.get(match.toLowerCase()) ?? "<uuid>");
  // 长的先换，避免短 id 是长 id 的子串时换坏。
  const ids = [...registry.byValue.entries()].filter(([value]) => value.length >= 6).sort((a, b) => b[0].length - a[0].length);
  for (const [value, placeholder] of ids) {
    if (out.includes(value)) out = out.split(value).join(placeholder);
  }
  for (const date of todays) {
    if (out.includes(date)) out = out.split(date).join("<today>");
  }
  return out.replace(/<today> \d{2}:\d{2}(?::\d{2})?/g, "<today> <clock>");
}

function rewrite(value: unknown, registry: Registry, todays: string[], key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, registry, todays, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[replaceStrings(k, registry, todays)] = rewrite((value as Record<string, unknown>)[k], registry, todays, k);
    }
    return out;
  }
  if (TIME_KEYS.has(key) && (typeof value === "number" || (typeof value === "string" && value !== ""))) return "<time>";
  if (DURATION_KEYS.has(key) && typeof value === "number") return "<ms>";
  if (typeof value === "string") return replaceStrings(value, registry, todays);
  return value;
}

function splitFrames(frames: Frame[] | undefined) {
  if (!frames) return undefined;
  const consumed: Frame[] = [];
  const process: Frame[] = [];
  const sequence: string[] = [];
  for (const frame of frames) {
    const type = String(frame.type ?? "?");
    sequence.push(type);
    if (CONSUMED_FRAME_TYPES.has(type)) consumed.push(frame);
    else process.push(frame);
  }
  return { consumed, process, sequence };
}

export type NormalizedCapture = {
  scenario: string;
  steps: unknown[];
  db: unknown;
  files: unknown;
  network: string[];
};

export function normalizeCapture(capture: Capture, options: { today: string[] }): NormalizedCapture {
  const registry: Registry = { byValue: new Map(), counters: new Map() };
  const shaped = {
    steps: capture.steps.map((step) => {
      const frames = splitFrames(step.frames);
      const { frames: _frames, ...rest } = step;
      void _frames;
      return frames ? { ...rest, frames: { consumed: frames.consumed, process: frames.process, sequence: frames.sequence } } : rest;
    }),
    db: capture.db,
    files: capture.files,
  };
  collect(shaped, registry);
  const rewritten = rewrite(shaped, registry, options.today) as { steps: Array<Record<string, unknown>>; db: unknown; files: unknown };
  // 过程帧：先归一化再排序，按多重集合比对。
  for (const step of rewritten.steps) {
    const frames = step.frames as { process?: unknown[] } | undefined;
    if (frames?.process) frames.process = frames.process.map((frame) => JSON.stringify(frame)).sort();
  }
  const network = capture.network
    .filter((entry) => entry.mode !== "release")
    .map((entry) => `${entry.mode} ${entry.method} ${replaceStrings(String(entry.url ?? ""), registry, options.today)} ${entry.key}${entry.status !== undefined ? ` ${entry.status}` : ""}`)
    .sort();
  return { scenario: capture.scenario, steps: rewritten.steps, db: rewritten.db, files: rewritten.files, network };
}
