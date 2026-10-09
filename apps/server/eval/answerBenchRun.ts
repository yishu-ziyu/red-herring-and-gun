/**
 * eval/answerBenchRun.ts — run a pipeline over eval/answerBench.json and score it (machine only).
 * Contract: docs/evals/2026-09-29-answer-benchmark.md.
 *
 *   cd apps/server && npx tsx eval/answerBenchRun.ts --label current-pilot --limit 5
 *   npx tsx eval/answerBenchRun.ts --label current-pilot --ids RUMOR-002,NEW-403 --jobs 2
 *   npx tsx eval/answerBenchRun.ts --label current-v1 --rescore   # recompute scores + summary from stored results
 *   npx tsx eval/answerBenchRun.ts --label current-full            # resumes: done ids are skipped
 *   npx tsx eval/answerBenchRun.ts --label x --replay [--tapes-from current-pilot]  # replay recorded tapes, no network
 *
 * Each case runs in its own child process (`node --import tsx --import eval/tape.mjs ... --worker`),
 * so the tape records that case's external responses into
 * outputs/answer-bench/tapes/<label>/<id>, and the case's model/search call counts and token usage come
 * from a fetch wrapper inside that process. Real providers; keys come from apps/.env.local and are never printed.
 *
 * Output: outputs/answer-bench/<label>/results.jsonl (one row per case) and summary.json.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLocalEnv } from "./localEnv.js";
import { extractSources } from "./answerBenchSources.js";
import {
  mapToBenchLabel,
  scoreCase,
  summarize,
  type BenchCase,
  type PipelineResult,
  type PipelineSource,
  type ScoredRow,
} from "./answerBenchScore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const APPS = resolve(SERVER, "..");
const REPO = resolve(APPS, "..");
const OUT_ROOT = join(REPO, "outputs", "answer-bench");
const BENCH = join(HERE, "answerBench.json");
const TSX_LOADER = pathToFileURL(join(SERVER, "node_modules", "tsx", "dist", "loader.mjs")).href;
const TAPE_URL = pathToFileURL(join(HERE, "tape.mjs")).href;

/* ------------------------------------------------------------------ adapters */

export interface PipelineAdapter {
  name: string;
  run(claim: string): Promise<Omit<PipelineResult, "calls">>;
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function firstSentence(text: string): string {
  const m = text.trim().match(/^[^。！？!?\n]*[。！？!?]?/);
  return (m?.[0] ?? "").trim();
}

/** Production case pipeline, assembled exactly as eval/runCase.ts does (real providers). */
const currentAdapter: PipelineAdapter = {
  name: "current",
  async run(claim) {
    const { runCase } = await import("./runCase.js");
    const { faceVerdictFor } = await import("../src/lib/reportAssembly/index.js");
    const t0 = Date.now();
    // Subscribing to the snapshot hook is what makes the pipeline build finalReport.investigation
    // (the InvestigationSnapshotV1 the UI reads); the production HTTP path always subscribes.
    const out = await runCase(
      { claim } as never,
      { env: process.env as Record<string, string>, codexBin: process.env.CODEX_BIN || "/usr/local/bin/codex" },
      { onInvestigationSnapshot: () => undefined },
    );
    const totalMs = Date.now() - t0;
    if (out.error) {
      return { ...EMPTY, timings: { totalMs }, error: out.error };
    }
    const report = out.finalReport as Rec;
    const conclusion = asRec(asRec(report.investigation).conclusion);
    const rawVerdict = str(report.verdictType);
    const face = faceVerdictFor(rawVerdict);
    const answerText = str(conclusion.directAnswer) || str(report.conclusion);
    const lead = str(conclusion.verdictLead) || firstSentence(answerText);
    const composer = out.steps.find((s) => s.agent === "report_composer");
    const fallbackUsed = Boolean(composer && (String(composer.model ?? "").startsWith("fallback") || composer.error));
    return {
      label: mapToBenchLabel({ face, judgment: str(conclusion.judgment) }),
      rawVerdict: `${rawVerdict}|${face}|${str(conclusion.judgment)}`,
      lead,
      answerText,
      ...extractSources(report, out.atomSearchBundle),
      fallbackUsed,
      timings: { totalMs },
    };
  },
};

const EMPTY: Omit<PipelineResult, "calls" | "timings"> = {
  label: "错误", rawVerdict: "", lead: "", answerText: "", evidenceSources: [], citedSources: [], searchedSources: [], snapshotBuilt: false, fallbackUsed: false,
};

const ADAPTERS: Record<string, PipelineAdapter> = { current: currentAdapter };

/* ------------------------------------------------------- worker: call accounting */

const MODEL_HOST = /minimax|stepfun|deepseek|xiaomimimo|mimo|openai|anthropic|dashscope|moonshot|bigmodel|zhipu|aiping|siliconflow|volces/i;
const SEARCH_HOST = /tavily|metaso|anysearch|exa\.ai|bocha|serper|brave|bing\.|baidu|sogou|so\.360|search/i;

function classify(url: URL): "model" | "search" | "other" {
  const host = url.hostname;
  // Model providers also host search endpoints (minimax coding_plan/search, stepfun mcp/web_search, 360 mwebsearch).
  const isModelPath = /chat\/completions|\/messages$|\/responses$/.test(url.pathname) && !/search/i.test(url.pathname);
  if (/360\.cn$/i.test(host) || MODEL_HOST.test(host)) {
    if (isModelPath) return "model";
    return /360\.cn$/i.test(host) || /search|mcp/i.test(url.pathname) ? "search" : "other";
  }
  if (SEARCH_HOST.test(host)) return "search";
  return "other";
}

interface Usage {
  input: number;
  output: number;
  total: number;
}
function usageFromObject(u: Rec): Usage | null {
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const total = Number(u.total_tokens ?? 0) || input + output;
  return input || output || total ? { input, output, total } : null;
}
/** JSON body or SSE stream: take the max of each field over every `usage` object (Anthropic streams split it). */
export function parseUsage(text: string): Usage | null {
  const objs: unknown[] = [];
  const t = text.trim();
  try {
    objs.push(JSON.parse(t));
  } catch {
    for (const line of t.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        objs.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  let best: Usage | null = null;
  for (const o of objs) {
    const r = asRec(o);
    const cands = [r.usage, asRec(r.message).usage, asRec(r.response).usage].filter(Boolean);
    for (const c of cands) {
      const u = usageFromObject(asRec(c));
      if (!u) continue;
      best = best
        ? { input: Math.max(best.input, u.input), output: Math.max(best.output, u.output), total: Math.max(best.total, u.total) }
        : u;
    }
  }
  return best;
}

interface CallStats {
  model: number;
  search: number;
  other: number;
  failed: number;
  failedEndpoints: Record<string, number>;
  /** model/search calls per host: calls, failed (HTTP >=400, thrown, or a 200 body carrying an error code), ok. */
  byHost: Record<string, { kind: string; calls: number; failed: number; ok: number }>;
  endpoints: Record<string, number>;
  tokensByHost: Record<string, Usage>;
}

/** True when a 200 response body is really an error: `errCode` non-zero, or a top-level `error` (incl. JSON-RPC). */
export function bodyFailure(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.includes("\ndata:") && !t.startsWith("data:") && !t.startsWith("event:")) return false;
  const objs: unknown[] = [];
  try {
    objs.push(JSON.parse(t));
  } catch {
    for (const line of t.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        objs.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  return objs.some((o) => {
    const r = asRec(o);
    const code = r.errCode ?? r.err_code;
    if (code !== undefined && code !== null && code !== 0 && code !== "0" && code !== "") return true;
    return Boolean(r.error);
  });
}

function installCallCounter(stats: CallStats) {
  const secrets = Object.entries(process.env)
    .filter(([n, v]) => /KEY|SECRET|PASS|TOKEN$/i.test(n) && (v ?? "").trim().length >= 8)
    .map(([, v]) => (v as string).trim());
  const scrub = (s: string) => secrets.reduce((acc, v) => acc.split(v).join("<secret>"), s);
  const inner = globalThis.fetch.bind(globalThis);
  const pending: Promise<void>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      /* relative: not external */
    }
    if (!url || ["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return inner(input, init);
    const kind = classify(url);
    stats[kind] += 1;
    const ep = scrub(`${kind} ${url.hostname}${url.pathname}`);
    stats.endpoints[ep] = (stats.endpoints[ep] ?? 0) + 1;
    const host = (stats.byHost[`${url.hostname} [${kind}]`] ??= { kind, calls: 0, failed: 0, ok: 0 });
    host.calls += 1;
    const markFailed = () => {
      stats.failed += 1;
      host.failed += 1;
      stats.failedEndpoints[ep] = (stats.failedEndpoints[ep] ?? 0) + 1;
    };
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (e) {
      markFailed();
      throw e;
    }
    if (res.status >= 400) markFailed();
    else if (kind === "other") host.ok += 1;
    if (kind !== "other" && res.status < 400) {
      // The body decides for search/model calls: a 200 can still carry an error code (Metaso errCode 3000 余额不足).
      pending.push(
        res
          .clone()
          .text()
          .then((text) => {
            if (bodyFailure(text)) markFailed();
            else host.ok += 1;
            if (kind !== "model") return;
            const u = parseUsage(text);
            if (!u) return;
            const cur = (stats.tokensByHost[url!.hostname] ??= { input: 0, output: 0, total: 0 });
            cur.input += u.input;
            cur.output += u.output;
            cur.total += u.total;
          })
          .catch(() => undefined),
      );
    }
    return res;
  }) as typeof fetch;
  return () => Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 8000))]);
}

async function workerMain(caseId: string, adapterName: string, outFile: string) {
  const bench = JSON.parse(readFileSync(BENCH, "utf8")) as BenchCase[];
  const c = bench.find((x) => x.id === caseId);
  if (!c) throw new Error(`no such case ${caseId}`);
  const adapter = ADAPTERS[adapterName];
  if (!adapter) throw new Error(`no such adapter ${adapterName}`);
  const stats: CallStats = { model: 0, search: 0, other: 0, failed: 0, failedEndpoints: {}, byHost: {}, endpoints: {}, tokensByHost: {} };
  const settle = installCallCounter(stats);
  let result: Omit<PipelineResult, "calls">;
  try {
    result = await adapter.run(c.claim);
  } catch (e) {
    result = { ...EMPTY, timings: { totalMs: 0 }, error: e instanceof Error ? e.message : String(e) };
  }
  await settle();
  writeFileSync(outFile, JSON.stringify({ result, stats }));
}

/* ------------------------------------------------------------------- parent */

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

interface Row {
  id: string;
  claim: string;
  adapter: string;
  boundary: boolean;
  derivedLabel: string | null;
  score: ScoredRow;
  result: PipelineResult;
  calls: { model: number; search: number; other: number; failed: number; failedEndpoints: Record<string, number>; byHost: CallStats["byHost"]; endpoints: Record<string, number> };
  tokensByHost: Record<string, Usage>;
  review: Record<string, unknown>;
}

function runWorker(args: { id: string; adapter: string; label: string; tapesLabel: string; replay: boolean; timeoutMs: number; tmp: string }) {
  const tapeDir = join(OUT_ROOT, "tapes", args.tapesLabel, args.id);
  const outFile = join(args.tmp, `${args.id}.json`);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.RHG_NET_RECORD;
  delete env.RHG_NET_REPLAY;
  if (args.replay) env.RHG_NET_REPLAY = tapeDir;
  else {
    rmSync(tapeDir, { recursive: true, force: true });
    env.RHG_NET_RECORD = tapeDir;
  }
  return new Promise<{ ok: boolean; outFile: string; note?: string }>((res) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_LOADER, "--import", TAPE_URL, join(HERE, "answerBenchRun.ts"), "--worker", "--id", args.id, "--adapter", args.adapter, "--out", outFile],
      { cwd: SERVER, env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let errTail = "";
    child.stderr.on("data", (d: Buffer) => (errTail = (errTail + d.toString()).slice(-600)));
    const timer = setTimeout(() => child.kill("SIGKILL"), args.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      res(existsSync(outFile) ? { ok: true, outFile } : { ok: false, outFile, note: `worker exit ${code}; ${errTail.replace(/\s+/g, " ").slice(-300)}` });
    });
  });
}

function loadRows(file: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Row;
      rows.set(r.id, r);
    } catch {
      /* skip torn line */
    }
  }
  return rows;
}

const pad = (s: string, n: number) => {
  const w = [...s].reduce((a, ch) => a + (/[^\x00-\xff]/.test(ch) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - w));
};

function printTable(rows: Row[]) {
  console.log(["id", "expected", "got", "ok", "sec", "model", "search", "fb", "keyS", "keyC", "rel"].map((h, i) => pad(h, [14, 10, 10, 4, 6, 6, 7, 3, 5, 5, 4][i]!)).join(" "));
  for (const r of rows) {
    const s = r.score;
    const ok = s.labelCorrect === null ? "人评" : s.labelCorrect ? "Y" : "N";
    console.log(
      [r.id, s.derivedLabel ?? "边界", s.label, ok, s.seconds.toFixed(0), String(s.modelCalls), String(s.searchCalls), s.fallbackUsed ? "Y" : "-", s.keyInSearch ? "Y" : "-", s.keyInCited ? "Y" : "-", s.usedReliablePrimary ? "Y" : "-"]
        .map((v, i) => pad(v, [14, 10, 10, 4, 6, 6, 7, 3, 5, 5, 4][i]!))
        .join(" "),
    );
  }
}

async function parentMain(argv: string[]) {
  const label = flag(argv, "--label");
  if (!label || !/^[\w.\-]+$/.test(label)) throw new Error("--label <name> is required (letters, digits, . _ -)");
  const adapterName = flag(argv, "--adapter") ?? "current";
  if (!ADAPTERS[adapterName]) throw new Error(`unknown adapter ${adapterName}; have: ${Object.keys(ADAPTERS).join(", ")}`);
  const replay = argv.includes("--replay");
  const tapesLabel = flag(argv, "--tapes-from") ?? label; // replay recorded tapes from another label
  const jobs = Math.max(1, Number(flag(argv, "--jobs") ?? 2) || 2);
  const limit = Number(flag(argv, "--limit") ?? 0) || 0;
  const idsArg = flag(argv, "--ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const timeoutMs = (Number(flag(argv, "--timeout-min") ?? 15) || 15) * 60_000;

  loadLocalEnv();
  if (!replay && !(process.env.STEPFUN_API_KEY || process.env.MINIMAX_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.MIMO_API_KEY)) {
    throw new Error("no provider key found in apps/.env.local");
  }

  const bench = JSON.parse(readFileSync(BENCH, "utf8")) as BenchCase[];
  let todo = idsArg ? bench.filter((c) => idsArg.includes(c.id)) : bench;
  if (idsArg) {
    const missing = idsArg.filter((id) => !bench.some((c) => c.id === id));
    if (missing.length) throw new Error(`unknown ids: ${missing.join(", ")}`);
  }
  if (limit > 0) todo = todo.slice(0, limit);

  const dir = join(OUT_ROOT, label);
  mkdirSync(dir, { recursive: true });
  const resultsFile = join(dir, "results.jsonl");
  const tmp = join(dir, ".work");
  mkdirSync(tmp, { recursive: true });
  const done = loadRows(resultsFile);
  const rescore = argv.includes("--rescore"); // recompute scores from stored results, run nothing
  if (rescore) {
    for (const r of done.values()) {
      const c = bench.find((x) => x.id === r.id);
      if (c) r.score = scoreCase(c, r.result);
    }
    writeFileSync(resultsFile, [...done.values()].map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  const queue = rescore ? [] : todo.filter((c) => !(done.has(c.id) && !done.get(c.id)!.result.error));
  console.log(`label=${label} adapter=${adapterName} jobs=${jobs} cases=${todo.length} skipping=${todo.length - queue.length}${replay ? " (replay)" : ""}`);

  const benchById = new Map(bench.map((c) => [c.id, c]));
  const runOne = async (c: BenchCase) => {
    const w = await runWorker({ id: c.id, adapter: adapterName, label, tapesLabel, replay, timeoutMs, tmp });
    let result: PipelineResult;
    let stats: CallStats = { model: 0, search: 0, other: 0, failed: 0, failedEndpoints: {}, byHost: {}, endpoints: {}, tokensByHost: {} };
    if (w.ok) {
      const parsed = JSON.parse(readFileSync(w.outFile, "utf8")) as { result: Omit<PipelineResult, "calls">; stats: CallStats };
      stats = parsed.stats;
      result = { ...parsed.result, calls: { model: stats.model, search: stats.search } };
    } else {
      result = { ...EMPTY, timings: { totalMs: 0 }, calls: { model: 0, search: 0 }, error: w.note ?? "worker failed" };
    }
    const score = scoreCase(c, result);
    const row: Row = {
      id: c.id,
      claim: c.claim,
      adapter: adapterName,
      boundary: c.boundary,
      derivedLabel: c.derivedLabel,
      score,
      result,
      calls: { model: stats.model, search: stats.search, other: stats.other, failed: stats.failed, failedEndpoints: stats.failedEndpoints, byHost: stats.byHost, endpoints: stats.endpoints },
      tokensByHost: stats.tokensByHost,
      review: {
        expectedLead: c.expectedLead,
        keyFact: c.keyFact,
        acceptIf: c.acceptIf,
        mustMention: c.mustMention,
        requiredCorrection: c.requiredCorrection,
        note: "compare answerText against these by hand; no LLM judging",
      },
    };
    done.set(c.id, row);
    writeFileSync(resultsFile, [...done.values()].map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`  done ${c.id}: ${score.label} (expected ${score.derivedLabel ?? "边界"}) ${score.seconds.toFixed(0)}s model=${score.modelCalls} search=${score.searchCalls}${result.error ? ` ERROR ${result.error.slice(0, 120)}` : ""}`);
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (next < queue.length) await runOne(queue[next++]!);
    }),
  );
  rmSync(tmp, { recursive: true, force: true });

  const all = [...done.values()].filter((r) => benchById.has(r.id));
  const summary = { label, adapter: adapterName, ...summarize(all.map((r) => r.score)) };
  const hosts: Record<string, { kind: string; calls: number; failed: number; ok: number }> = {};
  for (const r of all) for (const [h, v] of Object.entries(r.calls.byHost ?? {})) {
    const t = (hosts[h] ??= { kind: v.kind, calls: 0, failed: 0, ok: 0 });
    t.calls += v.calls; t.failed += v.failed; t.ok += v.ok;
  }
  const tokens: Record<string, Usage> = {};
  for (const r of all) for (const [h, u] of Object.entries(r.tokensByHost)) {
    const t = (tokens[h] ??= { input: 0, output: 0, total: 0 });
    t.input += u.input; t.output += u.output; t.total += u.total;
  }
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, callsByHost: hosts, tokensByHost: tokens }, null, 2));
  console.log("");
  printTable(all.filter((r) => todo.some((c) => c.id === r.id)));
  console.log("\n" + JSON.stringify({ ...summary, callsByHost: hosts, tokensByHost: tokens }, null, 2));
  console.log(`\nresults: ${resultsFile}`);
}

const argv = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const run = argv.includes("--worker")
    ? workerMain(flag(argv, "--id")!, flag(argv, "--adapter") ?? "current", flag(argv, "--out")!)
    : parentMain(argv);
  run.then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
