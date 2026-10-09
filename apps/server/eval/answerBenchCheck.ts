/**
 * Re-fetch every quote marked fetched=true and check the quote text appears in the page text.
 * Usage: npx tsx eval/answerBenchCheck.ts [input.json ...]   (default: eval/answerBench.json)
 * Writes outputs/answer-bench/quote-check.json. Blocked network => "not-run", never a silent pass.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[。｡]/g, ".")
    .replace(/[、，]/g, ",")
    .replace(/[「」『』“”‘’《》'"`]/g, "")
    .replace(/[—–―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\s ​﻿]+/g, "")
    .toLowerCase();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export type FetchResult = { ok: true; text: string } | { ok: false; reason: string; blocked: boolean };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function decodeBody(buf: Uint8Array, headerCharset?: string): string {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
  const cs = headerCharset ?? /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(cs.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/** curl honours http(s)_proxy env vars, which Node's fetch ignores; used as a fallback. */
function curlBytes(url: string): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    execFile("curl", ["-sSL", "--max-time", "25", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", "--fail", url], { encoding: "buffer", maxBuffer: 30_000_000 }, (err, out) =>
      err ? rej(err) : res(new Uint8Array(out)),
    ),
  );
}

export async function fetchPageText(url: string): Promise<FetchResult> {
  let firstErr = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9" },
    });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      const cs = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
      return { ok: true, text: htmlToText(decodeBody(buf, cs)) };
    }
    firstErr = `HTTP ${res.status}`;
  } catch (e) {
    firstErr = e instanceof Error ? e.message : String(e);
  }
  try {
    return { ok: true, text: htmlToText(decodeBody(await curlBytes(url))) };
  } catch (e) {
    const msg = e instanceof Error ? e.message.trim().split("\n").pop()! : String(e);
    // HTTP errors from curl --fail carry "error: NNN"; anything else is treated as network-blocked.
    const http = /error: (\d{3})/.exec(msg);
    return { ok: false, reason: `fetch: ${firstErr}; curl: ${msg}`.slice(0, 300), blocked: !http };
  }
}

export type QuoteCheck = {
  id: string;
  partIndex: number;
  url: string;
  quote: string;
  result: "verified" | "failed" | "not-run";
  detail?: string;
};

type Part = { quotes?: { url: string; quote: string; fetched: boolean }[] };
type Case = { id: string; parts?: Part[] };

export async function checkCases(cases: Case[]): Promise<QuoteCheck[]> {
  const pageCache = new Map<string, FetchResult>();
  const out: QuoteCheck[] = [];
  for (const c of cases) {
    (c.parts ?? []).forEach((p, partIndex) => {
      for (const q of p.quotes ?? []) if (q.fetched) out.push({ id: c.id, partIndex, url: q.url, quote: q.quote, result: "not-run" });
    });
  }
  for (const url of new Set(out.map((o) => o.url))) pageCache.set(url, await fetchPageText(url));
  for (const o of out) {
    const page = pageCache.get(o.url)!;
    if (!page.ok) {
      o.detail = page.reason;
      o.result = page.blocked ? "not-run" : "failed";
      continue;
    }
    const q = normalize(o.quote);
    if (!q) {
      o.result = "failed";
      o.detail = "empty quote with fetched=true";
    } else if (normalize(page.text).includes(q)) o.result = "verified";
    else {
      o.result = "failed";
      o.detail = "quote text not found in page";
    }
  }
  return out;
}

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) inputs.push(resolve(HERE, "answerBench.json"));
  const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), inputs: {} };
  for (const f of inputs) {
    const cases = JSON.parse(readFileSync(f, "utf8")) as Case[];
    const checks = await checkCases(cases);
    const count = (r: string) => checks.filter((c) => c.result === r).length;
    (report.inputs as Record<string, unknown>)[f] = {
      total: checks.length,
      verified: count("verified"),
      failed: count("failed"),
      notRun: count("not-run"),
      checks,
    };
    console.log(`${f}: total=${checks.length} verified=${count("verified")} failed=${count("failed")} not-run=${count("not-run")}`);
  }
  const outFile = resolve(ROOT, "outputs/answer-bench/quote-check.json");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`wrote ${outFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
