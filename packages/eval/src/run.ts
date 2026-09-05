import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCase, reduce, runTurn, type CaseEvent } from "@rhg/core";
import { fakeDeps, hasLlmKey, liveDeps, loadLocalEnv, readProcessEnv } from "./env.js";
import {
  compareGate,
  formatGateLine,
  METRIC_SEMVER,
  parseBaseline,
  snapshotFromSummary,
} from "./gate.js";
import { goldenDataset, type ScoreCaseGolden } from "./golden.js";
import {
  judgeRanOf,
  scoreCaseWithOutcome,
  summarizeRun,
  type CaseMetrics,
  type CaseProgress,
  type QualificationExpectation,
  type RunFault,
  type RunSummary,
  type SearchHealth,
} from "./score.js";

type CliArgs = {
  ids?: string[];
  domain?: string;
  repeats: number;
  gate?: string;
  fake: boolean;
  noDump: boolean;
};

export type CaseRecord = {
  id: string;
  verdictType: string | null;
  score: number | null;
  metrics: CaseMetrics;
  elapsedMs: number;
  turnReason: string | null;
  judgeRan: boolean;
  llmCalls: number;
  progress: CaseProgress;
  faults: RunFault[];
  failureReason: string | null;
  qualification: QualificationExpectation;
  searchHealth: SearchHealth;
  failedSearchSources: string[];
};

export type { RunSummary } from "./score.js";

export type EvalOutput = {
  runId: string;
  startedAt: string;
  metricSemver: string;
  caseIds: string[];
  qualificationFingerprint: string;
  valid: boolean;
  invalidReason?: string;
  cases: CaseRecord[];
  summary: RunSummary;
};

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../runs");

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { repeats: 1, fake: false, noDump: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fake") {
      out.fake = true;
      continue;
    }
    if (a === "--no-dump") {
      out.noDump = true;
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

type CaseRun = { record: CaseRecord; events: CaseEvent[] };

async function runOne(golden: ScoreCaseGolden, fake: boolean, repeat: number): Promise<CaseRun> {
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
  const turn = [...finished.turns].reverse().find((item) => item.reason !== undefined);
  const turnReason = turn?.reason ?? null;
  const scored = scoreCaseWithOutcome(golden, { case: finished, events, report, elapsedMs }, turnReason);
  return {
    record: {
      id: golden.id,
      verdictType: finished.overall?.verdictType ?? null,
      score: finished.overall?.score ?? null,
      metrics: scored.metrics,
      elapsedMs,
      turnReason,
      judgeRan: judgeRanOf(events),
      llmCalls: events.filter((event) => event.type === "llm.called").length,
      progress: scored.progress,
      faults: scored.faults,
      failureReason: scored.failureReason,
      qualification: scored.qualification,
      searchHealth: scored.searchHealth,
      failedSearchSources: scored.failedSearchSources,
    },
    events,
  };
}

function applyGate(path: string, output: EvalOutput): boolean {
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
  if (!output.valid) {
    console.error(output.invalidReason ?? "eval run invalid");
    return false;
  }
  const { passed, rows, rejectReason } = compareGate(
    old,
    snapshotFromSummary(
      output.summary,
      output.cases.map((row) => ({ id: row.id, qualification: row.qualification })),
    ),
  );
  if (rejectReason) {
    console.error(rejectReason);
    return false;
  }
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
  const startedAt = new Date().toISOString();
  const runId = `eval-${Date.now()}`;
  const dumpDir = join(RUNS_DIR, runId);
  if (!args.noDump) mkdirSync(dumpDir, { recursive: true });

  const cases: CaseRecord[] = [];
  const eventLists: CaseEvent[][] = [];
  for (const golden of selected) {
    for (let r = 0; r < args.repeats; r += 1) {
      const { record, events } = await runOne(golden, args.fake, r);
      cases.push(record);
      eventLists.push(events);
      if (!args.noDump) {
        const lines = events.map((event) => JSON.stringify(event)).join("\n");
        writeFileSync(join(dumpDir, `${golden.id}.jsonl`), lines.length > 0 ? `${lines}\n` : "");
      }
    }
  }

  const summary = summarizeRun(cases, eventLists);
  const identities = cases.map((row) => ({ id: row.id, qualification: row.qualification }));
  const output: EvalOutput = {
    runId,
    startedAt,
    metricSemver: METRIC_SEMVER,
    caseIds: [...new Set(cases.map((row) => row.id))],
    qualificationFingerprint: snapshotFromSummary(summary, identities).qualificationFingerprint,
    valid: summary.valid,
    ...(summary.invalidReason !== undefined ? { invalidReason: summary.invalidReason } : {}),
    cases,
    summary,
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `${runId}.json`), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));

  if (args.gate) {
    const passed = applyGate(args.gate, output);
    if (!passed) process.exit(1);
  }
  if (!output.valid) process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
