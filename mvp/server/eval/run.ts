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
import { runCase } from "./runCase.js";
import {
  scoreCase,
  aggregateMetrics,
  aggregateRepeats,
  type AggregateMetrics,
  type RepeatRun,
} from "./score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env 加载（与 runCasePipeline.real.test.ts 同款）──
function loadLocalEnv() {
  const cwd = process.cwd();
  const candidates = [".env.local", "server/.env.local", "../.env.local", ".env.local.example"];
  const found = candidates.map((p) => join(cwd, p)).find((p) => existsSync(p));
  if (!found) return;
  const text = readFileSync(found, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const hasAnyKey = Boolean(
  process.env.STEPFUN_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.MINIMAX_API_KEY ||
    process.env.MIMO_API_KEY
);

function parseArgs(argv: string[]) {
  const out: { gate?: string; ids?: string[]; domain?: string; repeats: number } = { repeats: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--gate") out.gate = argv[i + 1];
    if (a === "--ids") out.ids = (argv[i + 1] ?? "").split(",").filter(Boolean);
    if (a === "--domain") out.domain = argv[i + 1];
    if (a === "--repeats") {
      const n = Number(argv[i + 1]);
      out.repeats = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    }
  }
  return out;
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

async function main() {
  if (!hasAnyKey) {
    console.error("未检测到任何 API key（STEPFUN/DEEPSEEK/MINIMAX/MIMO）。请先在 mvp/.env.local 配置。");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const cases = filterCases(args);
  const evalEnv = {
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
    const t0 = Date.now();
    process.stdout.write(`  ${golden.id} ${golden.claim.slice(0, 30)}... `);

    const repeatRuns: RepeatRun[] = [];
    const perRunDetails: Array<Record<string, unknown>> = [];
    let lastSteps: Awaited<ReturnType<typeof runCase>>["steps"] = [];
    let lastReport: Record<string, unknown> = {};
    let lastError: string | undefined;

    for (let r = 0; r < repeats; r++) {
      const { steps, finalReport, error } = await runCase(golden, evalEnv);
      lastSteps = steps;
      lastReport = finalReport;
      lastError = error;
      const verdict = error ? "ERROR" : String(finalReport.verdictType ?? "?");
      const cred =
        error || typeof finalReport.credibilityScore !== "number"
          ? 50
          : (finalReport.credibilityScore as number);
      repeatRuns.push({ verdict, credibility: cred, error });
      perRunDetails.push({
        run: r + 1,
        verdict,
        credibility: error ? null : finalReport.credibilityScore,
        error: error ?? null,
        scoreBreakdown: (finalReport as Record<string, unknown>)._scoreBreakdown ?? null,
        agents: steps.map((s) => s.agent),
      });
      if (repeats > 1) {
        process.stdout.write(`r${r + 1}=${verdict}/${error ? "-" : finalReport.credibilityScore} `);
      }
    }

    const ms = Date.now() - t0;
    const agg = aggregateRepeats(repeatRuns);
    const verdict = agg.error ? "ERROR" : agg.verdict;
    const cred = agg.error ? "-" : agg.credibility;

    // 用聚合后的 verdict/credibility 覆盖 lastReport，供 scoreCase 打分
    const scoredReport: Record<string, unknown> = {
      ...lastReport,
      verdictType: verdict === "ERROR" ? lastReport.verdictType : verdict,
      credibilityScore: typeof cred === "number" ? cred : lastReport.credibilityScore,
    };
    process.stdout.write(
      repeats > 1
        ? `→ majority=${verdict} medianCred=${cred} (${ms}ms)\n`
        : `verdict=${verdict} credibility=${cred} (${ms}ms)\n`
    );

    const score = scoreCase({
      case: {
        id: golden.id,
        claim: golden.claim,
        category: golden.category,
        difficulty: golden.difficulty,
        expectedVerdictType: golden.expectedVerdictType,
        expectedCredibilityRange: golden.expectedCredibilityRange,
        expectedAgentSequence: golden.expectedAgentSequence,
      },
      steps: lastSteps,
      finalReport: scoredReport,
      error: agg.error,
    });
    scores.push(score);
    results.push({
      id: golden.id,
      claim: golden.claim,
      verdict,
      credibility: cred,
      error: agg.error ?? lastError,
      latencyMs: ms,
      agents: lastSteps.map((s) => s.agent),
      scoreBreakdown: (lastReport as Record<string, unknown>)._scoreBreakdown ?? null,
      repeats: repeats > 1 ? { n: repeats, votes: agg.verdictVotes, samples: agg.credibilitySamples, runs: perRunDetails } : undefined,
    });
  }

  const aggregate: AggregateMetrics = aggregateMetrics(scores);
  console.log("\n===== 聚合指标 =====");
  console.log(JSON.stringify(aggregate, null, 2));

  // 写历史
  const entry = {
    timestamp: new Date().toISOString(),
    runId: `eval-${Date.now()}`,
    cases: results,
    aggregate,
  };
  const hp = historyPath();
  appendFileSync(hp, JSON.stringify(entry) + "\n");
  console.log(`\n已追加到 ${hp}`);

  // 门禁
  if (args.gate) {
    if (!existsSync(args.gate)) {
      console.error(`基线文件不存在：${args.gate}`);
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(args.gate, "utf8")) as AggregateMetrics;
    const TOLERANCE = 0.05;
    const checks = [
      ["verdictAccuracy", baseline.verdictAccuracy, aggregate.verdictAccuracy],
      ["routingAccuracy", baseline.routingAccuracy, aggregate.routingAccuracy],
      ["reportContractPassRate", baseline.reportContractPassRate, aggregate.reportContractPassRate],
    ];
    let failed = false;
    for (const [name, base, cur] of checks) {
      const delta = (cur ?? 0) - (base ?? 0);
      const ok = delta >= -TOLERANCE;
      console.log(`  ${name}: baseline=${base?.toFixed(3)} now=${cur?.toFixed(3)} delta=${delta.toFixed(3)} ${ok ? "PASS" : "FAIL"}`);
      if (!ok) failed = true;
    }
    if (failed) {
      console.error("\n门禁失败：核心指标相对基线退化超过 5 个点。");
      process.exit(1);
    }
    console.log("\n门禁通过。");
  }

  // 写基线示例（非 gate 时）
  if (!args.gate) {
    const baselinePath = join(__dirname, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(aggregate, null, 2));
    console.log(`\n首次基线已写入 ${baselinePath}（后续 --gate baseline.json 校验）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});