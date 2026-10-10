/**
 * #145: compare the full case pipeline with the lean one on the same claims.
 *
 * Needs `npm run dev` (non-production, so the server accepts `pipeline: "lean"`).
 * Runs every lean run first, then every full run, so the dev log has one slice per mode.
 * Each run is a fresh guest (no cookie) with its own clientRequestId; the result is read
 * from the stored snapshot (read-only sqlite3).
 *
 * Usage (from apps/): node scripts/measure/compare-pipelines.mjs [path/to/dev.log]
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const api = process.env.API_URL || "http://localhost:3000";
const db = resolve(appsDir, "server/.data/rhg.sqlite");
const out = resolve(appsDir, "../out/measure/145");
const devLog = process.argv[2] || process.env.DEV_LOG || "";
const RUNS_PER_MODE = 2;
const CONCURRENCY = 3;
const RUN_CAP_MS = 15 * 60_000;

const CLAIMS = [
  { claim: "隔夜菜会致癌，等于吃毒药", expected: "false" },
  { claim: "喝气泡水会导致骨质疏松", expected: "false" },
  { claim: "喝柠檬水能治愈癌症", expected: "false" },
];
const LABEL_TEXT = {
  true: "属实", "mostly-true": "基本属实", "partly-true": "部分属实", exaggerated: "夸大了", false: "不属实",
  unresolved: "还查不清", uncheckable: "无法核对", disputed: "说法不一", opinion: "是观点，不分对错",
};

mkdirSync(out, { recursive: true });
const runsFile = resolve(out, "runs.jsonl");
writeFileSync(runsFile, "");

function logLineCount() {
  return devLog && existsSync(devLog) ? readFileSync(devLog, "utf8").split("\n").length : null;
}

function readRun(clientRequestId) {
  const sql = `select runId, status, snapshot from runs where clientRequestId = '${clientRequestId}' limit 1;`;
  const text = execFileSync("sqlite3", ["-readonly", "-json", db, sql], { encoding: "utf8" }).trim();
  return text ? JSON.parse(text)[0] : null;
}

async function runOnce(mode, { claim, expected }) {
  const clientRequestId = `m145-${mode}-${randomUUID()}`;
  const started = Date.now();
  let streamError = null;
  try {
    const res = await fetch(`${api}/api/agent/orchestrate-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim, clientRequestId, pipeline: mode }),
      signal: AbortSignal.timeout(RUN_CAP_MS),
    });
    if (!res.ok) streamError = `HTTP ${res.status}`;
    // Read the SSE stream to its end; the run is finished when the server closes it.
    for await (const _chunk of res.body) void _chunk;
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error);
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const row = readRun(clientRequestId);
  const snapshot = row?.snapshot ? JSON.parse(row.snapshot) : null;
  const parts = (snapshot?.claims ?? []).map((part) => {
    const directional = (part.evidence ?? []).filter((e) => e.role === "support" || e.role === "contradict");
    return {
      text: part.text,
      label: part.label ?? null,
      support: directional.filter((e) => e.role === "support").length,
      contradict: directional.filter((e) => e.role === "contradict").length,
      quoted: directional.filter((e) => typeof e.quote === "string" && e.quote.trim()).length,
    };
  });
  const record = {
    mode,
    claim,
    expected,
    seconds,
    status: row?.status ?? "missing",
    runId: row?.runId ?? null,
    streamError,
    label: snapshot?.conclusion?.label ?? null,
    reason: snapshot?.conclusion?.reason ?? null,
    parts,
  };
  appendFileSync(runsFile, `${JSON.stringify(record)}\n`);
  console.log(`[${mode}] ${claim} → ${record.label} (${record.status}, ${seconds}s)`);
  return record;
}

async function runPool(jobs) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      results.push(await job());
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function countLog(from, to) {
  if (from == null || to == null) return null;
  const lines = readFileSync(devLog, "utf8").split("\n").slice(from - 1, to - 1);
  const agents = {};
  lines.forEach((line, i) => {
    if (!/^\[orchestrate-provider\] start/.test(line)) return;
    const agent = /agent: '([^']+)'/.exec(lines[i + 1] ?? "")?.[1] ?? "?";
    agents[agent] = (agents[agent] ?? 0) + 1;
  });
  return {
    lines: [from, to],
    modelCalls: lines.filter((l) => /^\[orchestrate-provider\] start/.test(l)).length,
    jsonParseErrors: lines.filter((l) => /^\[orchestrate-provider\] json_parse_error/.test(l)).length,
    thinkingOnly: lines.filter((l) => /content_types=thinking|content_blocks=thinking/.test(l)).length,
    agents,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const show = (label) => (label ? `${LABEL_TEXT[label] ?? label}` : "—");

const results = {};
const logSlices = {};
// Lean first: a broken lean mode shows up in minutes, not after the slower full runs.
for (const mode of ["lean", "full"]) {
  const before = logLineCount();
  const jobs = CLAIMS.flatMap((c) => Array.from({ length: RUNS_PER_MODE }, () => () => runOnce(mode, c)));
  results[mode] = await runPool(jobs);
  logSlices[mode] = countLog(before, logLineCount());
}

const md = ["# #145 full vs lean", "", `Generated ${new Date().toISOString()}. Raw rows: runs.jsonl.`, ""];
md.push("| mode | claim | whole labels | seconds | verified quotes | status |", "|---|---|---|---|---|---|");
for (const mode of ["full", "lean"]) {
  for (const { claim } of CLAIMS) {
    const rows = results[mode].filter((r) => r.claim === claim);
    md.push(
      `| ${mode} | ${claim} | ${rows.map((r) => show(r.label)).join(" / ")} | ${rows.map((r) => r.seconds).join(" / ")} | ${rows
        .map((r) => r.parts.reduce((n, p) => n + p.quoted, 0))
        .join(" / ")} | ${rows.map((r) => r.status).join(" / ")} |`
    );
  }
}
md.push("", "| mode | accuracy | consistency | median seconds | model calls | json_parse_error | thinking-only |", "|---|---|---|---|---|---|---|");
for (const mode of ["full", "lean"]) {
  const rows = results[mode];
  const correct = rows.filter((r) => r.label === r.expected).length;
  const consistent = CLAIMS.filter(({ claim }) => {
    const labels = rows.filter((r) => r.claim === claim).map((r) => r.label);
    return labels.length === RUNS_PER_MODE && labels.every((l) => l === labels[0]);
  }).length;
  const log = logSlices[mode];
  md.push(
    `| ${mode} | ${correct}/${rows.length} | ${consistent}/${CLAIMS.length} | ${median(rows.map((r) => r.seconds))} | ${log?.modelCalls ?? "n/a"} | ${log?.jsonParseErrors ?? "n/a"} | ${log?.thinkingOnly ?? "n/a"} |`
  );
}
md.push("", "Model calls by agent (dev log slice):", "");
for (const mode of ["full", "lean"]) {
  const log = logSlices[mode];
  md.push(`- ${mode}: ${log ? `lines ${log.lines[0]}–${log.lines[1]}; ${JSON.stringify(log.agents)}` : "no dev log given"}`);
}
md.push("", "## Parts and reasons", "");
for (const mode of ["full", "lean"]) {
  for (const r of results[mode]) {
    md.push(`- **${mode}** ${r.claim} → ${show(r.label)}（${r.seconds}s）：${r.reason ?? "—"}`);
    for (const p of r.parts) {
      md.push(`  - 「${p.text}」${show(p.label)}；支持 ${p.support}，反驳 ${p.contradict}，带已核原句 ${p.quoted}`);
    }
  }
}
writeFileSync(resolve(out, "summary.md"), `${md.join("\n")}\n`);
console.log(`wrote ${runsFile} and ${resolve(out, "summary.md")}`);
