/**
 * evaluation/evaluationReport.ts
 *
 * Generates markdown evaluation reports with trend tracking.
 * Reports are append-only files on disk — previous runs are preserved
 * and deltas are computed automatically.
 */

import type { AggregateMetrics } from "./evaluationMetrics";

export interface ReportEntry {
  timestamp: string;
  aggregate: AggregateMetrics;
}

const REPORT_DIR = ".ship/evaluation";

/**
 * Append a new benchmark result to the report file.
 * Creates the directory if it doesn't exist.
 */
export async function appendReport(aggregate: AggregateMetrics): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const reportPath = path.join(REPORT_DIR, "benchmark-history.jsonl");

  await fs.mkdir(REPORT_DIR, { recursive: true });

  const entry: ReportEntry = {
    timestamp: new Date().toISOString(),
    aggregate,
  };

  await fs.appendFile(reportPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read all historical reports from disk.
 */
export async function readHistory(): Promise<ReportEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const reportPath = path.join(REPORT_DIR, "benchmark-history.jsonl");

  try {
    const content = await fs.readFile(reportPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    return lines.map((line) => JSON.parse(line) as ReportEntry);
  } catch {
    return [];
  }
}

/**
 * Compute delta between the latest and previous report.
 */
export function computeDelta(current: AggregateMetrics, previous: AggregateMetrics | null): {
  verdictAccuracyDelta: number;
  routingAccuracyDelta: number;
  hallucinationRateDelta: number;
  passedDelta: number;
} {
  if (!previous) {
    return {
      verdictAccuracyDelta: 0,
      routingAccuracyDelta: 0,
      hallucinationRateDelta: 0,
      passedDelta: 0,
    };
  }

  return {
    verdictAccuracyDelta: current.verdictAccuracy - previous.verdictAccuracy,
    routingAccuracyDelta: current.routingAccuracy - previous.routingAccuracy,
    hallucinationRateDelta: current.hallucinationRate - previous.hallucinationRate,
    passedDelta: current.passed - previous.passed,
  };
}

/**
 * Generate a markdown report from benchmark results.
 */
export function generateMarkdownReport(
  aggregate: AggregateMetrics,
  delta: ReturnType<typeof computeDelta>,
  historyLength: number,
): string {
  const lines: string[] = [];

  lines.push(`# AgentRuntime Evaluation Report`);
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**History length:** ${historyLength} runs`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value | Delta |`);
  lines.push(`|--------|-------|-------|`);
  lines.push(`| Total cases | ${aggregate.totalCases} | — |`);
  lines.push(`| Passed | ${aggregate.passed}/${aggregate.totalCases} | ${delta.passedDelta >= 0 ? "+" : ""}${delta.passedDelta} |`);
  lines.push(`| Verdict accuracy | ${(aggregate.verdictAccuracy * 100).toFixed(1)}% | ${delta.verdictAccuracyDelta >= 0 ? "+" : ""}${(delta.verdictAccuracyDelta * 100).toFixed(1)}% |`);
  lines.push(`| Routing accuracy | ${(aggregate.routingAccuracy * 100).toFixed(1)}% | ${delta.routingAccuracyDelta >= 0 ? "+" : ""}${(delta.routingAccuracyDelta * 100).toFixed(1)}% |`);
  lines.push(`| Hallucination rate | ${(aggregate.hallucinationRate * 100).toFixed(1)}% | ${delta.hallucinationRateDelta >= 0 ? "+" : ""}${(delta.hallucinationRateDelta * 100).toFixed(1)}% |`);
  lines.push("");

  // Per-category
  lines.push("## By Claim Category");
  lines.push("");
  lines.push(`| Category | Total | Passed | Verdict Accuracy |`);
  lines.push(`|----------|-------|--------|-----------------|`);
  for (const [cat, stats] of Object.entries(aggregate.byCategory)) {
    lines.push(`| ${cat} | ${stats.total} | ${stats.passed} | ${(stats.verdictAccuracy * 100).toFixed(1)}% |`);
  }
  lines.push("");

  // By difficulty
  lines.push("## By Difficulty");
  lines.push("");
  lines.push(`| Difficulty | Total | Passed | Pass Rate |`);
  lines.push(`|------------|-------|--------|-----------|`);
  for (const [diff, stats] of Object.entries(aggregate.byDifficulty)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(1) : "N/A";
    lines.push(`| ${diff} | ${stats.total} | ${stats.passed} | ${rate}% |`);
  }
  lines.push("");

  // Failures
  if (aggregate.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    lines.push(`| Case ID | Claim | Reason |`);
    lines.push(`|---------|-------|--------|`);
    for (const f of aggregate.failures) {
      const claimShort = f.claim.length > 60 ? f.claim.slice(0, 60) + "..." : f.claim;
      lines.push(`| ${f.caseId} | ${claimShort} | ${f.reason} |`);
    }
    lines.push("");
  }

  // Thresholds
  lines.push("## Thresholds");
  lines.push("");
  lines.push(`| Metric | Threshold | Current | Status |`);
  lines.push(`|--------|-----------|---------|--------|`);
  const verdictOk = aggregate.verdictAccuracy >= 0.80;
  const hallucOk = aggregate.hallucinationRate <= 0.10;
  lines.push(`| Verdict accuracy | ≥ 80% | ${(aggregate.verdictAccuracy * 100).toFixed(1)}% | ${verdictOk ? "PASS" : "FAIL"} |`);
  lines.push(`| Hallucination rate | ≤ 10% | ${(aggregate.hallucinationRate * 100).toFixed(1)}% | ${hallucOk ? "PASS" : "FAIL"} |`);
  lines.push(`| Routing accuracy | ≥ 95% | ${(aggregate.routingAccuracy * 100).toFixed(1)}% | ${aggregate.routingAccuracy >= 0.95 ? "PASS" : "FAIL"} |`);
  lines.push("");

  return lines.join("\n");
}
