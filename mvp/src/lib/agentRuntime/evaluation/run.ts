/**
 * evaluation/run.ts — CLI entry point for running benchmarks.
 *
 * Usage:
 *   npx tsx src/lib/agentRuntime/evaluation/run.ts
 *   npx tsx src/lib/agentRuntime/evaluation/run.ts --case CAUSAL-001
 *   npx tsx src/lib/agentRuntime/evaluation/run.ts --format json
 */

import { runCase } from "./benchmarkRunner";
import { goldenDataset, getCase } from "./goldenDataset";
import { scoreCase } from "./evaluationMetrics";
import { appendReport, generateMarkdownReport, computeDelta, readHistory } from "./evaluationReport";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    caseId: args.find((a) => a.startsWith("--case="))?.split("=")[1],
    format: args.includes("--format=json") ? "json" : "text",
    save: !args.includes("--no-save"),
  };
}

async function main() {
  const { caseId, format, save } = parseArgs();
  const cases = caseId ? [getCase(caseId)!].filter(Boolean) : goldenDataset;

  if (caseId && cases.length === 0) {
    console.error(`Case not found: ${caseId}`);
    process.exit(1);
  }

  console.log(`Running benchmark on ${cases.length} case(s)...\n`);

  const results = [];
  for (const golden of cases) {
    const result = await runCase(golden);
    results.push(result);
  }

  const scores = results.map((r) => scoreCase(r));
  const { aggregateMetrics } = await import("./evaluationMetrics");
  const aggregate = aggregateMetrics(scores);

  if (format === "json") {
    console.log(JSON.stringify({ results, scores, aggregate }, null, 2));
  } else {
    console.log(`Total:   ${aggregate.passed}/${aggregate.totalCases} passed`);
    console.log(`Verdict: ${(aggregate.verdictAccuracy * 100).toFixed(1)}%`);
    console.log(`Routing: ${(aggregate.routingAccuracy * 100).toFixed(1)}%`);
    console.log(`Halluc:  ${(aggregate.hallucinationRate * 100).toFixed(1)}%`);
    console.log();

    for (const s of scores) {
      const icon = s.overallPass ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${s.caseId}: ${s.claim.slice(0, 40)}`);
      if (!s.overallPass) {
        const reasons = [];
        if (!s.routingCorrect) reasons.push("routing");
        if (!s.sequenceCorrect) reasons.push("sequence");
        if (!s.verdictCorrect) reasons.push("verdict");
        if (!s.credibilityInRange) reasons.push("credibility");
        if (s.hallucinationDetected) reasons.push("hallucination");
        console.log(`         fails: ${reasons.join(", ")}`);
      }
    }
    console.log();

    const history = await readHistory();
    const previous = history.length > 0 ? history[history.length - 1].aggregate : null;
    const delta = computeDelta(aggregate, previous);

    if (previous) {
      console.log("=== DELTA vs previous run ===");
      console.log(`  Passed:    ${delta.passedDelta >= 0 ? "+" : ""}${delta.passedDelta}`);
      console.log(`  Verdict:   ${delta.verdictCorrectDelta >= 0 ? "+" : ""}${(delta.verdictCorrectDelta * 100).toFixed(1)}%`);
      console.log(`  Routing:   ${delta.routingAccuracyDelta >= 0 ? "+" : ""}${(delta.routingAccuracyDelta * 100).toFixed(1)}%`);
      console.log(`  Halluc:    ${delta.hallucinationRateDelta >= 0 ? "+" : ""}${(delta.hallucinationRateDelta * 100).toFixed(1)}%`);
      console.log();
    }

    const md = generateMarkdownReport(aggregate, delta, history.length + 1);
    console.log(md);
  }

  if (save) {
    await appendReport(aggregate);
    console.log("\nReport saved to .ship/evaluation/benchmark-history.jsonl");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
