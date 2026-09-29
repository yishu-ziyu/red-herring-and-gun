/**
 * 外部世界录音 / 回放：golden 表征用，以 `--import` 预加载到服务端进程，不改任何生产代码。
 *
 *   RHG_NET_RECORD=<dir>   真实联网，并把每个外部回复录进 <dir>/<key>/<n>.json
 *   RHG_NET_BASE=<dirs>    录音时先查这些已有录音（用 : 分隔）：命中就回放、不联网，没命中才真实联网并录下
 *   RHG_NET_REPLAY=<dir>   不联网，用 <dir> 的录音回答；对不上的请求按供应商报错（503）处理
 *   RHG_NET_LOG=<file>     本次运行的网络交互日志（jsonl）：每个外部请求一行
 *   RHG_NET_HOLD=<json>    回放时扣住匹配的请求：{"match":"子串","releaseFile":"<path>"}；
 *                          releaseFile 出现前不回复（调用方中止则按中止处理）
 *
 * 虚拟时钟：录音记下每个外部请求的耗时 ms。回放（以及录音时命中已有录音）不真的等，而是把 Date.now()
 * 拨快到「请求发出时刻 + 录下的耗时」。管线里按剩余时间做的取舍（补查、质询、要不要写报告）因此与真实运行一致，
 * 回放走的是录音时走过的那条路，而不是「外部回复瞬间到达」的另一条路。setTimeout 仍是真实时间。
 *
 * 录音格式与 rhg-fix 工作区的 netTape（未提交）相同：同一目录布局、同一环境变量名。
 * 区别：本文件在进程外预加载；指纹前额外去掉 360 检索地址里每次随机的 `sid`，并把请求体里的 UUID 归一。
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RECORD = process.env.RHG_NET_RECORD?.trim() || "";
const REPLAY = process.env.RHG_NET_REPLAY?.trim() || "";
const LOG = process.env.RHG_NET_LOG?.trim() || "";
const BASES = (process.env.RHG_NET_BASE?.trim() || "").split(":").filter(Boolean);
const HOLD = (() => {
  const raw = process.env.RHG_NET_HOLD?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.match !== "string" || typeof parsed.releaseFile !== "string") {
    throw new Error("[tape] RHG_NET_HOLD 需要 {match, releaseFile}");
  }
  return parsed;
})();

const MAX_BODY = 4 * 1024 * 1024;
const SECRET_PARAMS = /^(key|api_key|apikey|token|access_token|appkey)$/i;
/** 每次请求都不同、又不影响回复的地址参数。 */
const VOLATILE_PARAMS = /^(sid)$/i;

function isLoopback(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
}

/**
 * 有的供应商把密钥放在请求体里（如 Tavily 的 api_key）。录音与指纹前把进程里所有密钥值换成占位符：
 * 录音文件里不留密钥，回放时换成假密钥也能对上同一个指纹。
 */
const SECRET_VALUES = Object.entries(process.env)
  .filter(([name, value]) => /KEY|SECRET|PASS|TOKEN$/i.test(name) && typeof value === "string" && value.trim().length >= 8)
  .map(([name, value]) => [name, value.trim()])
  .sort((a, b) => b[1].length - a[1].length);

function scrubSecrets(text) {
  let out = text;
  for (const [name, value] of SECRET_VALUES) {
    if (out.includes(value)) out = out.split(value).join(`<secret:${name}>`);
  }
  return out;
}

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()]) {
      if (VOLATILE_PARAMS.test(name)) url.searchParams.delete(name);
      else if (SECRET_PARAMS.test(name)) url.searchParams.set(name, "REDACTED");
    }
    return scrubSecrets(url.toString());
  } catch {
    return scrubSecrets(raw);
  }
}

/**
 * 提示词里带当前时刻（上下文状态栏 `time=YYYY-MM-DD HH:MM:SS`）与今天的日期：换掉，录音才能隔天回放。
 * 只换「今天」这一天的写法，别的日期（说法、来源里的日期）原样参与指纹。
 */
const TODAY_FORMS = (() => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const forms = new Set();
  for (const date of [now, new Date(now.getTime() + 8 * 3600_000 + now.getTimezoneOffset() * 60_000)]) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    forms.add(`${y}-${pad(m)}-${pad(d)}`);
    forms.add(`${y}/${m}/${d}`);
    forms.add(`${y}/${pad(m)}/${pad(d)}`);
    forms.add(`${y}年${m}月${d}日`);
    forms.add(`${y}年${pad(m)}月${pad(d)}日`);
  }
  return [...forms].sort((a, b) => b.length - a.length);
})();

const TODAY_DATETIME = new RegExp(
  `(?:${TODAY_FORMS.filter((form) => /^\d{4}-\d{2}-\d{2}$/.test(form)).join("|")}) \\d{2}:\\d{2}(?::\\d{2})?`,
  "g",
);

function normalizeBody(body) {
  let text = scrubSecrets(body).replace(TODAY_DATETIME, "<datetime>");
  for (const form of TODAY_FORMS) if (text.includes(form)) text = text.split(form).join("<today>");
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
    .replace(/\b1[6-9]\d{11}\b/g, "<epoch>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>");
}

function bodyText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  return "";
}

function requestParts(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return { url, method, body: bodyText(init?.body) };
}

function keyOf(method, url, body) {
  return createHash("sha256").update(`${method} ${normalizeUrl(url)}\n${normalizeBody(body)}`).digest("hex").slice(0, 24);
}

let seq = 0;
function log(entry) {
  if (!LOG) return;
  appendFileSync(LOG, `${JSON.stringify({ seq: ++seq, ...entry })}\n`);
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("This operation was aborted", "AbortError");
}

const realFetch = globalThis.fetch.bind(globalThis);

const realNow = Date.now.bind(Date);
let clockOffset = 0;
/** 把虚拟时钟拨到至少 target（只进不退）。 */
function advanceTo(target) {
  const now = realNow() + clockOffset;
  if (Number.isFinite(target) && target > now) clockOffset += target - now;
}
/** RHG_NET_VCLOCK=0 关掉虚拟时钟：外部回复「瞬间到达」，按时间预算的取舍一律走「时间充裕」那一支。 */
const VCLOCK = process.env.RHG_NET_VCLOCK !== "0";
if ((RECORD || REPLAY) && VCLOCK) Date.now = () => realNow() + clockOffset;

if (RECORD && REPLAY) throw new Error("[tape] RHG_NET_RECORD 与 RHG_NET_REPLAY 不能同时设置");

/** 在一组录音目录里找某个指纹的录音文件（按录制顺序）。 */
function tapesFor(dirs, key) {
  for (const root of dirs) {
    const dir = join(root, key);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    if (files.length > 0) return files.map((name) => join(dir, name));
  }
  return [];
}

/** 录下来的网络错误（超时、断连）按同名错误重新抛出。 */
function recordedError(tape) {
  const { name = "Error", message = "fetch failed" } = tape.error ?? {};
  if (name === "AbortError" || name === "TimeoutError") return new DOMException(message, name);
  const error = new TypeError(message);
  if (name !== "TypeError") error.name = name;
  return error;
}

function replayResponse(file, method) {
  const tape = JSON.parse(readFileSync(file, "utf8"));
  if (tape.error) return { tape, error: recordedError(tape) };
  const nullBody = [101, 204, 205, 304].includes(tape.status) || method === "HEAD";
  const headers = { "content-type": tape.contentType };
  if (tape.abortedBody && !nullBody) {
    // 录制时调用方读正文读到一半就放弃了：回放同样在读正文时中止。
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new DOMException("This operation was aborted", "AbortError"));
      },
    });
    return { tape, response: new Response(stream, { status: tape.status, headers }) };
  }
  return { tape, response: new Response(nullBody ? null : tape.body, { status: tape.status, headers }) };
}

function writeTape(key, n, tape) {
  mkdirSync(join(RECORD, key), { recursive: true });
  writeFileSync(join(RECORD, key, `${n}.json`), JSON.stringify(tape));
}

if (RECORD) {
  mkdirSync(RECORD, { recursive: true });
  const counters = new Map();
  const baseServed = new Map();
  globalThis.fetch = async (input, init) => {
    const { url, method, body } = requestParts(input, init);
    if (isLoopback(new URL(url))) return realFetch(input, init);
    const key = keyOf(method, url, body);
    const base = tapesFor(BASES, key);
    if (base.length > 0) {
      const issuedAt = Date.now();
      const n = baseServed.get(key) ?? 0;
      baseServed.set(key, n + 1);
      const { tape, response, error } = replayResponse(base[Math.min(n, base.length - 1)], method);
      advanceTo(issuedAt + (tape.ms ?? 0));
      log({ mode: "base", key, n, method, url: normalizeUrl(url), status: tape.status, error: tape.error?.name });
      if (error) throw error;
      return response;
    }
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const startedAt = Date.now();
    let response;
    try {
      response = await realFetch(input, init);
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      const ms = Date.now() - startedAt;
      log({ mode: "record", key, n, method, url: normalizeUrl(url), error: name, ms });
      writeTape(key, n, { method, url: normalizeUrl(url), ms, error: { name, message: scrubSecrets(message) }, requestBody: normalizeBody(body).slice(0, 400_000) });
      throw error;
    }
    const headersMs = Date.now() - startedAt;
    log({ mode: "record", key, n, method, url: normalizeUrl(url), status: response.status, headersMs });
    // 读克隆，原回复原样交还调用方；调用方中途放弃时克隆读失败，这一条就不录（回放按未命中处理）。
    response
      .clone()
      .text()
      .then((text) => {
        // 耗时算到正文读完：模型回复是流式的，响应头很快就到，正文要流几十秒。
        const ms = Date.now() - startedAt;
        log({ mode: "record-body", key, n, ms });
        const tape = {
          method,
          url: normalizeUrl(url),
          ms,
          headersMs,
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body: scrubSecrets(text).slice(0, MAX_BODY),
          ...(text.length > MAX_BODY ? { truncated: true } : {}),
          requestBody: normalizeBody(body).slice(0, 400_000),
        };
        writeTape(key, n, tape);
      })
      .catch(() => {
        // 调用方读到一半放弃（超时、取消）：记下这一点，回放时同样在读正文时中止。
        const ms = Date.now() - startedAt;
        writeTape(key, n, {
          method,
          url: normalizeUrl(url),
          ms,
          headersMs,
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body: "",
          abortedBody: true,
          requestBody: normalizeBody(body).slice(0, 400_000),
        });
      });
    return response;
  };
  console.log(`[tape] recording external responses to ${RECORD}`);
} else if (REPLAY) {
  const replayDirs = REPLAY.split(":").filter(Boolean);
  for (const dir of replayDirs) if (!existsSync(dir)) throw new Error(`[tape] 回放目录不存在：${dir}`);
  const served = new Map();
  let held = 0;
  globalThis.fetch = async (input, init) => {
    const { url, method, body } = requestParts(input, init);
    if (isLoopback(new URL(url))) return realFetch(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw abortError(signal);
    const key = keyOf(method, url, body);
    const normalizedUrl = normalizeUrl(url);
    const issuedAt = Date.now();
    if (HOLD && `${method} ${normalizedUrl}\n${body}`.includes(HOLD.match) && !existsSync(HOLD.releaseFile)) {
      held += 1;
      log({ mode: "hold", key, method, url: normalizedUrl, held });
      await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (existsSync(HOLD.releaseFile)) {
            clearInterval(timer);
            resolve();
          }
        }, 25);
        signal?.addEventListener("abort", () => {
          clearInterval(timer);
          reject(abortError(signal));
        }, { once: true });
      });
      log({ mode: "release", key, method, url: normalizedUrl });
    }
    const tapes = tapesFor(replayDirs, key);
    if (tapes.length === 0) {
      log({ mode: "miss", key, method, url: normalizedUrl, requestBody: normalizeBody(body).slice(0, 400_000) });
      return new Response(JSON.stringify({ error: "netTape replay miss" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    // 同一请求录到多次：按录制顺序依次回放，用完后重复最后一条。
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const { tape, response, error } = replayResponse(tapes[Math.min(n, tapes.length - 1)], method);
    advanceTo(issuedAt + (tape.ms ?? 0));
    log({ mode: "hit", key, n, method, url: normalizedUrl, status: tape.status, error: tape.error?.name });
    if (error) throw error;
    return response;
  };
  console.log(`[tape] replaying external responses from ${REPLAY}`);
}
