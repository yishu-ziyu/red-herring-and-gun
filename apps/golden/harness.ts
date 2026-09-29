/**
 * Golden master harness：同一份外部世界录音，驱动真实服务端进程，采集用户与客户端能观察到的全部输出。
 *
 * 每个场景：独立数据目录、独立工作目录（cwd / HOME）、全新服务进程；外部网络经 tape.mjs 录音或回放。
 * 采集：HTTP 回复、SSE 帧、SQLite 表、落盘的 JSON / JSONL、外部请求清单。归一化后写 normalized.json。
 *
 * 用法见 golden/README.md。录音与运行结果写在 outputs/golden/（git 忽略），不进仓库。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizeCapture, today } from "./normalize.js";

export const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));
export const APPS = resolve(GOLDEN_DIR, "..");
export const REPO = resolve(APPS, "..");
export const OUT = join(REPO, "outputs", "golden");
/**
 * 服务进程直接用 node 起，tsx 以 --import 加载器方式挂上：只有一个进程。
 * 用 tsx 命令行起会多一层父进程，SIGKILL 只杀掉父进程，真正的服务变成孤儿继续跑（g14 第一次就是这样）。
 */
const TSX_LOADER = pathToFileURL(join(APPS, "server", "node_modules", "tsx", "dist", "loader.mjs")).href;
const TAPE_URL = pathToFileURL(join(GOLDEN_DIR, "tape.mjs")).href;
const SERVER_ENTRY = join(APPS, "server", "src", "index.ts");
/** 密钥类变量名：含 KEY / SECRET / PASS，或以 TOKEN 结尾。`*_MAX_TOKENS` 这类数值配置不是密钥。 */
const SECRET_NAME = /KEY|SECRET|PASS|TOKEN$/i;
/** 录音时一律清空：golden 运行绝不发真实邮件。 */
const MAIL_ENV = ["RESEND_API_KEY", "MAIL_FROM", "MAIL_FROM_NAME", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];

export type Mode = "record" | "replay";

export type Frame = Record<string, unknown>;

export type StepCapture = {
  label: string;
  request: { method: string; path: string; body?: unknown };
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
  frames?: Frame[];
  note?: string;
};

export type Capture = {
  scenario: string;
  mode: Mode;
  steps: StepCapture[];
  db: Record<string, unknown[]>;
  files: Record<string, unknown>;
  network: Array<Record<string, unknown>>;
  serverLog?: string;
};

type ServerHandle = {
  proc: ChildProcess;
  port: number;
  base: string;
  exited: Promise<number | null>;
};

export type ScenarioContext = {
  mode: Mode;
  /** 发请求（带 cookie jar）。 */
  request(label: string, method: string, path: string, body?: unknown, options?: { raw?: boolean; headers?: Record<string, string> }): Promise<StepCapture>;
  /** 发起调查，读完 SSE；`until` 返回 true 时本地断开连接（不是取消）。 */
  orchestrate(label: string, payload: Record<string, unknown>, options?: { until?: (frame: Frame, frames: Frame[]) => boolean }): Promise<StepCapture & { runId?: string; finalReport?: Record<string, unknown>; snapshot?: Record<string, unknown> }>;
  /** 读一个 SSE 端点直到服务端关流。 */
  sse(label: string, path: string): Promise<StepCapture>;
  /** 邮箱验证码登录（开发面板返回验证码；邮件已被清空）。 */
  login(label: string, email: string): Promise<void>;
  /** 回放时放行被 RHG_NET_HOLD 扣住的请求。 */
  release(): void;
  /** 等到服务端扣住第 n 个请求。 */
  waitHeld(count?: number, timeoutMs?: number): Promise<void>;
  /** 重启服务进程（同一数据目录）；`kill` 为 true 时 SIGKILL 模拟崩溃。 */
  restart(options?: { kill?: boolean }): Promise<void>;
  sleep(ms: number): Promise<void>;
  note(label: string, text: string): void;
  /** 本场景工作目录（放种子数据等）。 */
  readonly dataDir: string;
};

export type Scenario = {
  /** 用哪一份录音；同一份录音可被多个场景回放。 */
  world: string;
  /** 录音时先回放这些世界的录音（命中不联网），回放时一并载入。追问场景用它复用首轮录音。 */
  bases?: string[];
  /** true：可以真实录音；false：只能回放（依赖扣住请求、清空录音等）。 */
  recordable: boolean;
  description: string;
  env?: Record<string, string>;
  /** 回放时扣住匹配子串的外部请求。 */
  hold?: string;
  /** 回放时把录音里匹配的请求当作不存在（模拟供应商故障）。 */
  dropTapes?: (tape: { url: string; requestBody?: string }) => boolean;
  /** 启动前往数据目录放种子文件。 */
  seed?: (dataDir: string) => void;
  run(ctx: ScenarioContext): Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadLocalEnv(): Record<string, string> {
  const file = join(APPS, ".env.local");
  if (!existsSync(file)) return {};
  const requireFromServer = createRequire(join(APPS, "server", "package.json"));
  const dotenv = requireFromServer("dotenv") as { parse: (src: Buffer) => Record<string, string> };
  return dotenv.parse(readFileSync(file));
}

/** 录音时的配置清单：密钥只记名字，回放时换成假值。 */
function envManifest(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) out[name] = SECRET_NAME.test(name) && value ? "<secret>" : value;
  return out;
}

function replayEnv(manifest: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(manifest)) {
    out[name] = value === "<secret>" ? `golden-replay-${name.toLowerCase()}-0000000000` : value;
  }
  return out;
}

function tapeDir(world: string) {
  return join(OUT, "tapes", world);
}

/** 回放用的录音副本：按场景去掉一部分录音（模拟故障），原录音不动。 */
function prepareReplayTape(world: string, targetDir: string, drop?: Scenario["dropTapes"]) {
  const source = tapeDir(world);
  mkdirSync(targetDir, { recursive: true });
  if (world === "empty") return;
  if (!existsSync(source)) throw new Error(`没有录音：${source}（先 record 这个 world）`);
  cpSync(source, targetDir, { recursive: true, filter: (from) => !from.slice(source.length + 1).startsWith("_") });
  if (!drop) return;
  for (const key of readdirSync(source)) {
    if (key.startsWith("_")) continue;
    const dir = join(source, key);
    const tapes = readdirSync(dir).filter((name) => name.endsWith(".json"));
    if (tapes.length === 0) continue;
    const first = JSON.parse(readFileSync(join(dir, tapes[0]!), "utf8")) as { url: string; requestBody?: string };
    if (drop(first)) rmSync(join(targetDir, key), { recursive: true, force: true });
  }
}

function parseSse(text: string): Frame[] {
  const frames: Frame[] = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        frames.push(JSON.parse(line.slice(6)) as Frame);
      } catch {
        frames.push({ __malformed: line.slice(0, 200) });
      }
    }
  }
  return frames;
}

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "x-robots-tag", "x-accel-buffering", "location"]) {
    const value = headers.get(name);
    if (value) out[name] = value;
  }
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) out["set-cookie"] = cookies.map((c) => c.replace(/=([^;]*)/, "=<value>")).join(" | ");
  return out;
}

function dumpDatabase(file: string): Record<string, unknown[]> {
  if (!existsSync(file)) return {};
  const db = new DatabaseSync(file, { readOnly: true });
  const out: Record<string, unknown[]> = {};
  const jsonColumns = new Set(["report", "claimReview", "feedback", "snapshot", "activities", "payload", "projection", "evidence"]);
  // 按写入顺序（rowid）输出：caseId、runId、令牌都是随机值，按它们排序会让同一次运行每次顺序不同。
  const order: Record<string, string> = {
    cases: "rowid",
    runs: "rowid",
    run_activities: "(SELECT r.rowid FROM runs r WHERE r.runId = run_activities.runId), seq",
    shares: "rowid",
    knowledge_entries: "atomNorm",
    schema_version: "version",
  };
  try {
    for (const [table, orderBy] of Object.entries(order)) {
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as Array<Record<string, unknown>>;
      } catch {
        continue;
      }
      out[table] = rows.map((row) => {
        const parsed: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) {
          if (jsonColumns.has(column) && typeof value === "string") {
            try {
              parsed[column] = JSON.parse(value);
              continue;
            } catch {
              /* 保留原串 */
            }
          }
          parsed[column] = value;
        }
        return parsed;
      });
    }
  } finally {
    db.close();
  }
  return out;
}

function readDataFiles(dirs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (root: string, dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      const rel = full.slice(root.length + 1);
      if (name.isDirectory()) {
        if (name.name === "rhg-uploads" || name.name === "tape" || name.name === "hold") continue;
        walk(root, full);
        continue;
      }
      if (/\.sqlite(-wal|-shm)?$/.test(name.name) || name.name.endsWith(".log") || name.name === "raw.json") continue;
      const text = readFileSync(full, "utf8");
      if (name.name.endsWith(".jsonl")) out[rel] = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      else if (name.name.endsWith(".json")) out[rel] = JSON.parse(text);
      else out[rel] = text;
    }
  };
  for (const dir of dirs) walk(dir, dir);
  return out;
}

export async function runScenario(name: string, scenario: Scenario, mode: Mode, label: string): Promise<{ capture: Capture; runDir: string }> {
  if (existsSync("/usr/local/bin/codex")) {
    throw new Error("本机存在 /usr/local/bin/codex：provider 链可能落到本地 codex，golden 不可复现。先移开或给 harness 加隔离。");
  }
  if (mode === "record" && !scenario.recordable) throw new Error(`${name} 只能回放`);
  const runDir = join(OUT, "runs", label, name);
  rmSync(runDir, { recursive: true, force: true });
  const workDir = join(runDir, "work");
  const dataDir = join(runDir, "data");
  const holdDir = join(runDir, "hold");
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(holdDir, { recursive: true });
  const netLog = join(runDir, "net.jsonl");
  const releaseFile = join(holdDir, "release");

  let baseEnv: Record<string, string>;
  const world = scenario.world;
  const replayTape = join(runDir, "tape");
  if (mode === "record") {
    const local = loadLocalEnv();
    for (const key of MAIL_ENV) local[key] = "";
    mkdirSync(tapeDir(world), { recursive: true });
    writeFileSync(join(tapeDir(world), "_env.json"), JSON.stringify(envManifest(local), null, 2));
    baseEnv = local;
  } else {
    // 「empty」世界没有录音：配置清单取 g01 的录音清单；还没录过就按本机配置的键名生成（值一律换假）。
    const manifestFile = join(tapeDir(world === "empty" ? "g01-mixed" : world), "_env.json");
    const manifest = existsSync(manifestFile)
      ? (JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, string>)
      : envManifest(Object.fromEntries(Object.entries(loadLocalEnv()).map(([k, v]) => [k, MAIL_ENV.includes(k) ? "" : v])));
    baseEnv = replayEnv(manifest);
    for (const base of scenario.bases ?? []) prepareReplayTape(base, replayTape, scenario.dropTapes);
    prepareReplayTape(world, replayTape, scenario.dropTapes);
  }
  scenario.seed?.(dataDir);

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    // tsx 在 TMPDIR 里建 IPC 管道；工作目录路径太长会超过 Unix socket 的 104 字节上限。
    TMPDIR: mkdtempSync(join(tmpdir(), "rhgg-")),
    HOME: workDir,
    ...baseEnv,
    ...(scenario.env ?? {}),
    DATA_DIR: dataDir,
    RHG_DB_FILE: join(dataDir, "rhg.sqlite"),
    RHG_DATA_DIR: dataDir,
    UPLOAD_DIR: join(workDir, "uploads"),
    RHG_NET_LOG: netLog,
    ...(process.env.RHG_NET_VCLOCK ? { RHG_NET_VCLOCK: process.env.RHG_NET_VCLOCK } : {}),
    ...(mode === "record"
      ? { RHG_NET_RECORD: tapeDir(world), ...(scenario.bases?.length ? { RHG_NET_BASE: scenario.bases.map(tapeDir).join(":") } : {}) }
      : { RHG_NET_REPLAY: replayTape }),
    ...(mode === "replay" && scenario.hold ? { RHG_NET_HOLD: JSON.stringify({ match: scenario.hold, releaseFile }) } : {}),
  };
  if (!("NODE_ENV" in (scenario.env ?? {}))) delete env.NODE_ENV;

  const serverLogFile = join(runDir, "server.log");
  let server: ServerHandle | null = null;
  const start = async (): Promise<ServerHandle> => {
    const port = await freePort();
    const proc = spawn(process.execPath, ["--import", TSX_LOADER, "--import", TAPE_URL, SERVER_ENTRY], {
      cwd: workDir,
      env: { ...env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer) => writeFileSync(serverLogFile, chunk, { flag: "a" });
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
    const base = `http://127.0.0.1:${port}`;
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      try {
        if ((await fetch(`${base}/health`)).ok) return { proc, port, base, exited };
      } catch {
        /* 还没起来 */
      }
      if (proc.exitCode !== null) break;
      await sleep(200);
    }
    proc.kill("SIGKILL");
    throw new Error(`服务没有起来，见 ${serverLogFile}`);
  };
  const stop = async (signal: NodeJS.Signals = "SIGTERM") => {
    if (!server) return;
    const handle = server;
    server = null;
    handle.proc.kill(signal);
    await Promise.race([handle.exited, sleep(10_000)]);
    if (handle.proc.exitCode === null) handle.proc.kill("SIGKILL");
  };

  const capture: Capture = { scenario: name, mode, steps: [], db: {}, files: {}, network: [] };
  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorbCookies = (headers: Headers) => {
    for (const raw of headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair!.indexOf("=");
      if (index <= 0) continue;
      const key = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (/max-age=0/i.test(raw) || value === "") cookies.delete(key);
      else cookies.set(key, value);
    }
  };

  const doFetch = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) => {
    if (!server) throw new Error("服务未运行");
    return fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookies.size > 0 ? { cookie: cookieHeader() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal,
    });
  };

  const readStream = async (response: Response, until?: (frame: Frame, frames: Frame[]) => boolean, controller?: AbortController) => {
    const frames: Frame[] = [];
    if (!response.body) return { frames, detached: false };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let detached = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const frame of parseSse(`${block}\n\n`)) {
            frames.push(frame);
            if (until?.(frame, frames)) {
              detached = true;
              controller?.abort();
              break;
            }
          }
          if (detached) break;
        }
        if (detached) break;
      }
    } catch (error) {
      if (!detached) throw error;
    }
    if (!detached && buffer.trim()) frames.push(...parseSse(buffer));
    return { frames, detached };
  };

  const ctx: ScenarioContext = {
    mode,
    dataDir,
    async request(label, method, path, body, options = {}) {
      const response = await doFetch(method, path, body, options.headers);
      absorbCookies(response.headers);
      const text = await response.text();
      let parsed: unknown = undefined;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      const step: StepCapture = {
        label,
        request: { method, path, ...(body === undefined ? {} : { body }) },
        status: response.status,
        headers: pickHeaders(response.headers),
        ...(parsed !== undefined ? { body: parsed } : { text }),
      };
      capture.steps.push(step);
      return step;
    },
    async orchestrate(label, payload, options = {}) {
      const controller = new AbortController();
      const response = await doFetch("POST", "/api/agent/orchestrate-stream", payload, {}, controller.signal);
      absorbCookies(response.headers);
      const contentType = response.headers.get("content-type") ?? "";
      const step: StepCapture & { runId?: string; finalReport?: Record<string, unknown>; snapshot?: Record<string, unknown> } = {
        label,
        request: { method: "POST", path: "/api/agent/orchestrate-stream", body: payload },
        status: response.status,
        headers: pickHeaders(response.headers),
      };
      if (!contentType.includes("event-stream")) {
        const text = await response.text();
        try {
          step.body = JSON.parse(text);
        } catch {
          step.text = text;
        }
      } else {
        const { frames, detached } = await readStream(response, options.until, controller);
        step.frames = frames;
        if (detached) step.note = "client detached";
        const started = frames.find((f) => f.type === "run_started");
        if (started && typeof started.runId === "string") step.runId = started.runId;
        const complete = [...frames].reverse().find((f) => f.type === "complete");
        if (complete) step.finalReport = complete.finalReport as Record<string, unknown>;
        const snap = [...frames].reverse().find((f) => f.type === "investigation_snapshot");
        if (snap) step.snapshot = snap.investigation as Record<string, unknown>;
      }
      capture.steps.push(step);
      return step;
    },
    async sse(label, path) {
      const response = await doFetch("GET", path);
      absorbCookies(response.headers);
      const step: StepCapture = { label, request: { method: "GET", path }, status: response.status, headers: pickHeaders(response.headers) };
      if ((response.headers.get("content-type") ?? "").includes("event-stream")) {
        step.frames = (await readStream(response)).frames;
      } else {
        const text = await response.text();
        try {
          step.body = JSON.parse(text);
        } catch {
          step.text = text;
        }
      }
      capture.steps.push(step);
      return step;
    },
    async login(label, email) {
      const requested = await ctx.request(`${label}:request-code`, "POST", "/api/auth/email/request", { email });
      const code = (requested.body as { devCode?: string; code?: string } | undefined)?.devCode ?? (requested.body as { code?: string } | undefined)?.code;
      if (!code) throw new Error(`没有拿到开发验证码：${JSON.stringify(requested.body)}`);
      await ctx.request(`${label}:verify`, "POST", "/api/auth/email/verify", { email, code });
    },
    release() {
      writeFileSync(releaseFile, "go");
    },
    async waitHeld(count = 1, timeoutMs = 60_000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (existsSync(netLog)) {
          const held = readFileSync(netLog, "utf8").split("\n").filter((line) => line.includes('"mode":"hold"')).length;
          if (held >= count) return;
        }
        await sleep(25);
      }
      throw new Error(`等不到第 ${count} 个被扣住的请求`);
    },
    async restart(options = {}) {
      await stop(options.kill ? "SIGKILL" : "SIGTERM");
      server = await start();
    },
    sleep,
    note(label, text) {
      capture.steps.push({ label, request: { method: "NOTE", path: "" }, note: text });
    },
  };

  server = await start();
  try {
    await scenario.run(ctx);
  } finally {
    await stop();
  }

  capture.db = dumpDatabase(join(dataDir, "rhg.sqlite"));
  capture.files = readDataFiles([dataDir, join(workDir, ".agent-memory")]);
  capture.network = existsSync(netLog)
    ? readFileSync(netLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
  writeFileSync(join(runDir, "raw.json"), JSON.stringify(capture, null, 2));
  const normalized = normalizeCapture(capture, { today: today() });
  writeFileSync(join(runDir, "normalized.json"), JSON.stringify(normalized, null, 2));
  return { capture, runDir };
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
