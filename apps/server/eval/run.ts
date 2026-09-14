/**
 * eval/run.ts — 真实模型评估 runner（tsx 脚本）。
 *
 * 用生产依赖跑 goldenDataset 全量，复用 eval/score.ts 指标，
 * 输出 JSON 报告 + 追加到 .ship/evaluation/benchmark-history.jsonl。
 *
 * 运行：
 *   cd mvp/server && npx tsx eval/run.ts            # 正常跑，输出报告
 *   npx tsx eval/run.ts --gate <baseline.json>      # 门禁：相对基线不退化
 *   npx tsx eval/run.ts --ids RUMOR-001,RUMOR-006   # 只跑指定用例
 *   npx tsx eval/run.ts --domain causal             # 只跑指定领域
 *   npx tsx eval/run.ts --repeats 3                 # 每 case 跑 3 次：verdict 多数、credibility 中位
 *
 * 需要真实 API key（从 mvp/.env.local 读取，同 runCasePipeline.real.test.ts）。
 */

import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenDataset, type ScoreCaseGolden } from "./golden.js";
import { loadLocalEnv } from "./localEnv.js";
import { runCase, type EvalEnv } from "./runCase.js";
import {
  scoreCase,
  aggregateMetrics,
  aggregateRepeats,
  compareToBaseline,
  type AggregateMetrics,
  type CaseResult,
  type RepeatRun,
} from "./score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

loadLocalEnv();

const hasAnyKey = Boolean(
  process.env.STEPFUN_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.MINIMAX_API_KEY ||
    process.env.MIMO_API_KEY
);

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]) {
  const repeatsRaw = Number(flagValue(argv, "--repeats"));
  return {
    gate: flagValue(argv, "--gate"),
    ids: flagValue(argv, "--ids")?.split(",").filter(Boolean),
    domain: flagValue(argv, "--domain"),
    repeats: Number.isFinite(repeatsRaw) && repeatsRaw >= 1 ? Math.floor(repeatsRaw) : 1,
  };
}

function filterCases(args: { ids?: string[]; domain?: string }): ScoreCaseGolden[] {
  if (args.ids && args.ids.length > 0) {
    return goldenDataset.filter((c) => args.ids!.includes(c.id));
  }
  if (args.domain) {
    return goldenDataset.filter((c) => c.domain === args.domain);
  }
  return goldenDataset;
}

function historyPath(): string {
  // 项目根 .ship/evaluation/benchmark-history.jsonl
  return join(__dirname, "../../../.ship/evaluation/benchmark-history.jsonl");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function searchedAtoms(bundle: unknown): string[] {
  const rec = asRecord(bundle);
  return Array.isArray(rec.atomsSearched) ? rec.atomsSearched.filter((a) => typeof a === "string") : [];
}

function sourceUrls(bundle: unknown): string[] {
  const rec = asRecord(bundle);
  const aggregate = asRecord(rec.aggregate);
  const sources = Array.isArray(aggregate.sources)
    ? aggregate.sources
    : Array.isArray(rec.forAgent)
      ? (rec.forAgent as Array<{ sources?: unknown[] }>).flatMap((item) => item.sources ?? [])
      : [];
  return sources
    .map((s) => {
      if (!s || typeof s !== "object") return "";
      return String((s as { url?: unknown }).url || "").trim();
    })
    .filter((u) => /^https?:\/\//i.test(u));
}

function faceFromReport(report: Record<string, unknown>): string {
  if (typeof report.faceVerdict === "string" && report.faceVerdict) return report.faceVerdict;
  const conclusion = String(report.conclusion || report.summaryForPublic || report.faceVerdict || "");
  if (/只能信一部分/.test(conclusion)) return "只能信一部分";
  if (/还查不清/.test(conclusion)) return "还查不清";
  if (/不能信/.test(conclusion)) return "不能信";
  if (/能信/.test(conclusion)) return "能信";
  return "missing";
}

function summarizeSearch(bundle: unknown, report: Record<string, unknown>) {
  const atoms = searchedAtoms(bundle);
  const urls = sourceUrls(bundle);
  return {
    searched: atoms.length > 0,
    atoms,
    urlCount: urls.length,
    sampleUrls: urls.slice(0, 3),
    face: faceFromReport(report),
  };
}

function oneRepeat(
  error: string | undefined,
  finalReport: Record<string, unknown>,
  steps: Awaited<ReturnType<typeof runCase>>["steps"],
  runIndex: number
): { run: RepeatRun; detail: Record<string, unknown> } {
  const verdict = error ? "ERROR" : String(finalReport.verdictType ?? "?");
  const cred =
    error || typeof finalReport.credibilityScore !== "number" ? 50 : (finalReport.credibilityScore as number);
  return {
    run: { verdict, credibility: cred, error },
    detail: {
      run: runIndex,
      verdict,
      credibility: error ? null : finalReport.credibilityScore,
      error: error ?? null,
      scoreBreakdown: finalReport._scoreBreakdown ?? null,
      agents: steps.map((s) => s.agent),
    },
  };
}

function writeCaseProgress(
  repeats: number,
  verdict: string,
  cred: number | string,
  searchMeta: ReturnType<typeof summarizeSearch>,
  ms: number
): void {
  const searchBit = `search=${searchMeta.searched ? "yes" : "no"} urls=${searchMeta.urlCount} face=${searchMeta.face} (${ms}ms)\n`;
  process.stdout.write(
    repeats > 1 ? `→ majority=${verdict} medianCred=${cred} ${searchBit}` : `verdict=${verdict} credibility=${cred} ${searchBit}`
  );
}

async function collectRepeats(golden: ScoreCaseGolden, evalEnv: EvalEnv, repeats: number) {
  const repeatRuns: RepeatRun[] = [];
  const perRunDetails: Array<Record<string, unknown>> = [];
  let lastSteps: Awaited<ReturnType<typeof runCase>>["steps"] = [];
  let lastReport: Record<string, unknown> = {};
  let lastError: string | undefined;
  let lastBundle: Awaited<ReturnType<typeof runCase>>["atomSearchBundle"];
  let lastLoop: Awaited<ReturnType<typeof runCase>>["evidenceLoop"];

  for (let r = 0; r < repeats; r++) {
    const { steps, finalReport, error, atomSearchBundle, evidenceLoop } = await runCase(golden, evalEnv);
    lastSteps = steps;
    lastReport = finalReport;
    lastError = error;
    lastBundle = atomSearchBundle;
    lastLoop = evidenceLoop;
    const { run, detail } = oneRepeat(error, finalReport, steps, r + 1);
    repeatRuns.push(run);
    perRunDetails.push(detail);
    if (repeats > 1) {
      process.stdout.write(`r${r + 1}=${run.verdict}/${error ? "-" : finalReport.credibilityScore} `);
    }
  }

  return { repeatRuns, perRunDetails, lastSteps, lastReport, lastError, lastBundle, lastLoop };
}

function scoreCollected(golden: ScoreCaseGolden, collected: Awaited<ReturnType<typeof collectRepeats>>) {
  const agg = aggregateRepeats(collected.repeatRuns);
  const verdict = agg.error ? "ERROR" : agg.verdict;
  const cred = agg.error ? "-" : agg.credibility;
  const scoredReport: Record<string, unknown> = {
    ...collected.lastReport,
    verdictType: verdict === "ERROR" ? collected.lastReport.verdictType : verdict,
    credibilityScore: typeof cred === "number" ? cred : collected.lastReport.credibilityScore,
  };
  return {
    agg,
    verdict,
    cred,
    searchMeta: summarizeSearch(collected.lastBundle, collected.lastReport),
    score: scoreCase({
      case: {
        id: golden.id,
        claim: golden.claim,
        category: golden.category,
        difficulty: golden.difficulty,
        expectedVerdictType: golden.expectedVerdictType,
        expectedCredibilityRange: golden.expectedCredibilityRange,
        expectedAgentSequence: golden.expectedAgentSequence,
        expectsEvidenceLoop: golden.expectsEvidenceLoop,
        expectedAtoms: golden.expectedAtoms,
        mustSearch: golden.mustSearch,
      },
      steps: collected.lastSteps,
      finalReport: scoredReport,
      atomSearchBundle: collected.lastBundle,
      evidenceLoop: collected.lastLoop as CaseResult["evidenceLoop"],
      error: agg.error,
    }),
  };
}

async function evaluateGolden(golden: ScoreCaseGolden, evalEnv: EvalEnv, repeats: number) {
  const t0 = Date.now();
  process.stdout.write(`  ${golden.id} ${golden.claim.slice(0, 30)}... `);
  const collected = await collectRepeats(golden, evalEnv, repeats);
  const scored = scoreCollected(golden, collected);
  const ms = Date.now() - t0;
  writeCaseProgress(repeats, scored.verdict, scored.cred, scored.searchMeta, ms);
  return {
    score: scored.score,
    row: {
      id: golden.id,
      claim: golden.claim,
      verdict: scored.verdict,
      credibility: scored.cred,
      error: scored.agg.error ?? collected.lastError,
      latencyMs: ms,
      agents: collected.lastSteps.map((s) => s.agent),
      search: scored.searchMeta,
      evidenceLoop: collected.lastLoop ?? undefined,
      scoreBreakdown: collected.lastReport._scoreBreakdown ?? null,
      repeats: repeats > 1
        ? { n: repeats, votes: scored.agg.verdictVotes, samples: scored.agg.credibilitySamples, runs: collected.perRunDetails }
        : undefined,
    },
  };
}

function searchMetaOf(row: { search?: unknown }): { searched?: boolean; urlCount?: number; face?: string } {
  return row.search && typeof row.search === "object"
    ? (row.search as { searched?: boolean; urlCount?: number; face?: string })
    : {};
}

function printTinySummary(results: Array<{ id: unknown; verdict: unknown; search?: unknown }>): void {
  const tiny = results.filter((r) => String(r.id).startsWith("TINY-"));
  if (tiny.length === 0) return;
  const searched = tiny.filter((r) => searchMetaOf(r).searched).length;
  const withUrl = tiny.filter((r) => (searchMetaOf(r).urlCount ?? 0) > 0).length;
  const faceOk = tiny.filter((r) => {
    const face = searchMetaOf(r).face;
    return face && face !== "missing";
  }).length;
  const directionOk = tiny.filter((r) => r.verdict === "false" || r.verdict === "mixed_misleading").length;
  console.log("\n===== 微博级短谣 =====");
  console.log(
    JSON.stringify(
      {
        total: tiny.length,
        searchedShare: searched / tiny.length,
        boundUrlShare: withUrl / tiny.length,
        faceShare: faceOk / tiny.length,
        correctDirectionShare: directionOk / tiny.length,
      },
      null,
      2
    )
  );
}

function printEvidenceLoop(aggregate: AggregateMetrics): void {
  if (aggregate.evidenceLoopExpectedCount <= 0) return;
  console.log("\n===== Evidence Loop（翻案案例） =====");
  console.log(
    JSON.stringify(
      {
        expected: aggregate.evidenceLoopExpectedCount,
        triggerRate: aggregate.evidenceLoopTriggerRate,
        rescueRate: aggregate.evidenceLoopRescueRate,
      },
      null,
      2
    )
  );
}

function appendHistory(results: unknown[], aggregate: AggregateMetrics): void {
  const entry = {
    timestamp: new Date().toISOString(),
    runId: `eval-${Date.now()}`,
    cases: results,
    aggregate,
  };
  const hp = historyPath();
  appendFileSync(hp, JSON.stringify(entry) + "\n");
  console.log(`\n已追加到 ${hp}`);
}

function logGateCheck(check: { name: string; baseline: number; current: number; ok: boolean }): void {
  if (check.name === "totalCases") {
    console.log(`  totalCases: baseline=${check.baseline} now=${check.current} ${check.ok ? "PASS" : "FAIL"}`);
    return;
  }
  const delta = check.current - check.baseline;
  console.log(
    `  ${check.name}: baseline=${check.baseline.toFixed(3)} now=${check.current.toFixed(3)} delta=${delta.toFixed(3)} ${check.ok ? "PASS" : "FAIL"}`
  );
}

function maybeRunGate(gatePath: string | undefined, aggregate: AggregateMetrics): void {
  if (!gatePath) return;
  if (!existsSync(gatePath)) {
    console.error(`基线文件不存在：${gatePath}`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(gatePath, "utf8")) as AggregateMetrics;
  const comparison = compareToBaseline(baseline, aggregate);
  for (const check of comparison.checks) logGateCheck(check);
  if (!comparison.passed) {
    const casesMismatch = comparison.checks.some((c) => c.name === "totalCases" && !c.ok);
    console.error(
      casesMismatch
        ? "\n门禁失败：黄金集条数与基线不一致，禁止用旧聚合当门禁。"
        : "\n门禁失败：核心指标相对基线退化超过 5 个点。"
    );
    process.exit(1);
  }
  console.log("\n门禁通过。");
}

function maybeWriteBaseline(
  args: { gate?: string; ids?: string[]; domain?: string },
  aggregate: AggregateMetrics
): void {
  if (args.gate || args.ids || args.domain) return;
  const baselinePath = join(__dirname, "baseline.json");
  writeFileSync(baselinePath, JSON.stringify(aggregate, null, 2));
  console.log(`\n首次基线已写入 ${baselinePath}（后续 --gate baseline.json 校验）`);
}

async function main() {
  if (!hasAnyKey) {
    console.error("未检测到任何 API key（STEPFUN/DEEPSEEK/MINIMAX/MIMO）。请先在 mvp/.env.local 配置。");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const cases = filterCases(args);
  const evalEnv: EvalEnv = {
    env: process.env as Record<string, string>,
    codexBin: process.env.CODEX_BIN || "/usr/local/bin/codex",
  };

  const repeats = args.repeats;
  console.log(
    `跑 ${cases.length} 个 golden case（含真实模型 + 真实搜索）${repeats > 1 ? `，每 case ×${repeats} 次（verdict 多数 / credibility 中位）` : ""}...`
  );
  const results = [];
  const scores = [];
  for (const golden of cases) {
    const { score, row } = await evaluateGolden(golden, evalEnv, repeats);
    scores.push(score);
    results.push(row);
  }

  const aggregate: AggregateMetrics = aggregateMetrics(scores);
  console.log("\n===== 聚合指标 =====");
  console.log(JSON.stringify(aggregate, null, 2));
  printTinySummary(results);
  printEvidenceLoop(aggregate);
  appendHistory(results, aggregate);
  maybeRunGate(args.gate, aggregate);
  maybeWriteBaseline(args, aggregate);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});