import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCase, reduce, runTurn, type CaseEvent } from "@rhg/core";
import { fakeDeps, hasLlmKey, liveDeps, loadLocalEnv, readProcessEnv } from "./env.js";
import { compareGate, formatGateLine, parseBaseline, snapshotFromSummary } from "./gate.js";
import { goldenDataset, type ScoreCaseGolden } from "./golden.js";
import { scoreCase, summarize, type CaseMetrics } from "./score.js";

type CliArgs = {
  ids?: string[];
  domain?: string;
  repeats: number;
  gate?: string;
  fake: boolean;
};

export type CaseRecord = {
  id: string;
  verdictType: string | null;
  score: number | null;
  metrics: CaseMetrics;
  elapsedMs: number;
  turnReason: string | null;
};

export type EvalOutput = {
  runId: string;
  startedAt: string;
  cases: CaseRecord[];
  summary: CaseMetrics;
};

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../runs");

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { repeats: 1, fake: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fake") {
      out.fake = true;
      continue;
    }
    if (a === "--gate") {
      out.gate = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === "--ids") {
      out.ids = (argv[i + 1] ?? "").split(",").filter(Boolean);
      i += 1;
      continue;
    }
    if (a === "--domain") {
      out.domain = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === "--repeats") {
      const n = Number(argv[i + 1]);
      out.repeats = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
      i += 1;
    }
  }
  return out;
}

function filterCases(args: CliArgs): ScoreCaseGolden[] {
  if (args.ids && args.ids.length > 0) {
    return goldenDataset.filter((item) => args.ids!.includes(item.id));
  }
  if (args.domain) {
    return goldenDataset.filter((item) => item.domain === args.domain);
  }
  return goldenDataset;
}

async function runOne(golden: ScoreCaseGolden, fake: boolean, repeat: number): Promise<CaseRecord> {
  const started = Date.now();
  const { case: start } = createCase({
    id: `${golden.id}-${repeat}-${started}`,
    text: golden.claim,
  });
  const deps = fake ? fakeDeps(golden.claim) : liveDeps(readProcessEnv());
  const events: CaseEvent[] = [];
  for await (const event of runTurn({
    case: start,
    message: { text: golden.claim },
    route: "new_claim",
    deps,
  })) {
    events.push(event);
  }
  const finished = events.reduce(reduce, start);
  const elapsedMs = Date.now() - started;
  const report = finished.report ?? null;
  const metrics = scoreCase(golden, { case: finished, events, report, elapsedMs });
  const turn = [...finished.turns].reverse().find((item) => item.reason !== undefined);
  return {
    id: golden.id,
    verdictType: finished.overall?.verdictType ?? null,
    score: finished.overall?.score ?? null,
    metrics,
    elapsedMs,
    turnReason: turn?.reason ?? null,
  };
}

function applyGate(path: string, summary: CaseMetrics): boolean {
  if (!existsSync(path)) {
    console.error(`基线文件不存在：${path}`);
    return false;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`基线不是合法 JSON：${message}`);
    return false;
  }
  let old;
  try {
    old = parseBaseline(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return false;
  }
  const { passed, rows } = compareGate(old, snapshotFromSummary(summary));
  for (const row of rows) {
    console.log(formatGateLine(row));
  }
  return passed;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.fake && !hasLlmKey(readProcessEnv())) {
    console.error("未检测到 API key。请在 mvp/.env.local 配置，或使用 --fake。");
    process.exit(1);
  }

  const selected = filterCases(args);
  const cases: CaseRecord[] = [];
  for (const golden of selected) {
    for (let r = 0; r < args.repeats; r += 1) {
      cases.push(await runOne(golden, args.fake, r));
    }
  }

  const startedAt = new Date().toISOString();
  const runId = `eval-${Date.now()}`;
  const output: EvalOutput = {
    runId,
    startedAt,
    cases,
    summary: summarize(cases),
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `${runId}.json`), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));

  if (args.gate) {
    const passed = applyGate(args.gate, output.summary);
    if (!passed) process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
