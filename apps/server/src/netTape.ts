/**
 * 网络录音 / 回放：端到端测试用的外部世界替身，只在 index.ts 这一个组装点按环境变量安装。
 *
 *   RHG_NET_RECORD=<dir>  真实联网，同时把每个外部回复录进 <dir>
 *   RHG_NET_REPLAY=<dir>  不联网，用 <dir> 里的录音回答；对不上的请求按供应商报错处理
 *
 * 失败方式与处理见 docs/evals/2026-09-28-e2e-first-testing.md（先列失败方式，再写代码）。
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Tape = { url: string; method: string; status: number; contentType: string; body: string; truncated?: boolean };

const MAX_BODY = 2 * 1024 * 1024;
const SECRET_PARAMS = /^(key|api_key|apikey|token|access_token|appkey)$/i;

function isLoopback(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
}

/** 失败方式 4：地址里的密钥参数改写后再存、再算指纹；请求头一律不存。 */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.test(name)) url.searchParams.set(name, "REDACTED");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/** 失败方式 1：去掉请求体里的时间戳与毫秒时刻，避免同一请求每次指纹不同。 */
function normalizeBody(body: string): string {
  return body
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
    .replace(/\b1[6-9]\d{11}\b/g, "<epoch>");
}

function bodyText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  return "";
}

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return { url, method, body: bodyText(init?.body) };
}

function keyOf(method: string, url: string, body: string): string {
  return createHash("sha256").update(`${method} ${redactUrl(url)}\n${normalizeBody(body)}`).digest("hex").slice(0, 24);
}

export function installNetTape(env: NodeJS.ProcessEnv = process.env): void {
  const recordDir = env.RHG_NET_RECORD?.trim();
  const replayDir = env.RHG_NET_REPLAY?.trim();
  if (!recordDir && !replayDir) return;
  if (recordDir && replayDir) throw new Error("RHG_NET_RECORD 与 RHG_NET_REPLAY 不能同时设置");
  const realFetch = globalThis.fetch.bind(globalThis);

  if (recordDir) {
    mkdirSync(recordDir, { recursive: true });
    const counters = new Map<string, number>();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method, body } = requestParts(input, init);
      const response = await realFetch(input, init);
      if (isLoopback(new URL(url))) return response;
      const key = keyOf(method, url, body);
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      // 失败方式 6：读克隆，原回复原样交还；失败方式 5：流式回复也读完整正文。
      response
        .clone()
        .text()
        .then((text) => {
          const tape: Tape = {
            url: redactUrl(url),
            method,
            status: response.status,
            contentType: response.headers.get("content-type") ?? "",
            body: text.slice(0, MAX_BODY),
            ...(text.length > MAX_BODY ? { truncated: true } : {}),
          };
          mkdirSync(join(recordDir, key), { recursive: true });
          writeFileSync(join(recordDir, key, `${n}.json`), JSON.stringify(tape));
        })
        .catch(() => {});
      return response;
    };
    console.log(`[netTape] recording external responses to ${recordDir}`);
    return;
  }

  // 失败方式 8：录音目录不存在或为空，启动即失败，不降级成真实联网。
  if (!existsSync(replayDir!) || readdirSync(replayDir!).filter((name) => !name.startsWith("_")).length === 0) {
    throw new Error(`[netTape] 回放目录不存在或为空：${replayDir}`);
  }
  const reportFile = join(replayDir!, "_replay_report.jsonl");
  const served = new Map<string, number>();
  const note = (kind: string, url: string, method: string, key: string) =>
    appendFileSync(reportFile, `${JSON.stringify({ at: new Date().toISOString(), kind, method, url: redactUrl(url), key })}\n`);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method, body } = requestParts(input, init);
    const parsed = new URL(url);
    if (isLoopback(parsed)) return realFetch(input, init);
    const key = keyOf(method, url, body);
    const dir = join(replayDir!, key);
    const tapes = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      : [];
    if (tapes.length === 0) {
      // 失败方式 1、3、7：对不上的请求不连外网，按供应商报错处理，并记入报告。
      note("miss", url, method, key);
      return new Response(JSON.stringify({ error: "netTape replay miss" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    // 失败方式 2：同一请求多次录音按顺序回放，用完后重复最后一条。
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const tape = JSON.parse(readFileSync(join(dir, tapes[Math.min(n, tapes.length - 1)]!), "utf8")) as Tape;
    note("hit", url, method, key);
    return new Response(tape.body, { status: tape.status, headers: { "content-type": tape.contentType } });
  };
  console.log(`[netTape] replaying external responses from ${replayDir}`);
}
