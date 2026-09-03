import { scrubPublicText, type Case, type CaseEvent, type Report } from "@rhg/core";
import type { ScoreCaseGolden } from "./golden.js";

export type ScoreInput = {
  case: Case;
  events: CaseEvent[];
  report: Report | null;
  elapsedMs: number;
};

export type CaseMetrics = {
  verdictAccuracy: number | null;
  credibilityAccuracy: number | null;
  hallucinationRate: number | null;
  reportContractPassRate: number | null;
  routingAccuracy: number | null;
  groundingRate: number | null;
  quoteFidelity: number | null;
  provenanceDepth: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
};

const CITE_RE = /\[(\d+)\]/g;
const URL_RE = /https?:\/\/[^\s<>"'）)\]]+/gi;
const TRAIL_PUNCT_RE = /[.,;:!?。，、；：！？]+$/;

export function verdictAccuracy(golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const overall = result.case.overall;
  if (!overall) return null;
  if (overall.contested === true) return 0;
  return overall.verdictType === golden.expectedVerdictType ? 1 : 0;
}

export function credibilityAccuracy(golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const overall = result.case.overall;
  if (!overall) return null;
  const [lo, hi] = golden.expectedCredibilityRange;
  return overall.score >= lo && overall.score <= hi ? 1 : 0;
}

export function hallucinationRate(_golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const report = result.report;
  if (!report) return null;
  const citeByN = new Map(report.citations.map((row) => [row.n, row.evidenceId]));
  const evidenceIds = new Set(result.case.evidence.map((item) => item.id));
  const knownUrls = evidenceUrlSet(result.case);
  const texts = [report.conclusion, ...report.claimItems.map((item) => item.line)];
  for (const text of texts) {
    for (const n of citationMarkers(text)) {
      const evidenceId = citeByN.get(n);
      if (evidenceId === undefined) return 1;
      if (!evidenceIds.has(evidenceId)) return 1;
    }
    for (const url of urlsIn(text)) {
      if (!knownUrls.has(url)) return 1;
    }
  }
  for (const row of report.citations) {
    if (!evidenceIds.has(row.evidenceId)) return 1;
  }
  return 0;
}

export function reportContractPassRate(_golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const report = result.report;
  if (!report) return null;
  if (report.conclusion.trim() === "") return 0;
  if (scrubPublicText(report.conclusion) !== report.conclusion) return 0;
  const verifiable = result.case.claims.filter((claim) => claim.checkable);
  const counts = new Map<string, number>();
  for (const item of report.claimItems) {
    if (item.citations.length === 0) return 0;
    counts.set(item.claimId, (counts.get(item.claimId) ?? 0) + 1);
  }
  for (const claim of verifiable) {
    if (counts.get(claim.id) !== 1) return 0;
  }
  return 1;
}

export function routingAccuracy(golden: ScoreCaseGolden, result: ScoreInput): number | null {
  if (golden.expectsEvidenceLoop !== true) return null;
  const hit = result.events.some((event) => event.type === "investigator.step");
  return hit ? 1 : 0;
}

export function groundingRate(_golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const verifiable = result.case.claims.filter((claim) => claim.checkable);
  if (verifiable.length === 0) return null;
  let hit = 0;
  for (const claim of verifiable) {
    const verdict = result.case.verdicts.find((row) => row.claimId === claim.id);
    if (!verdict || verdict.verdict === "unverified") continue;
    const tally = verdict.tally;
    if ((tally?.sup ?? 0) + (tally?.ref ?? 0) >= 1) hit += 1;
  }
  return hit / verifiable.length;
}

export function quoteFidelity(_golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const quoted = result.case.stances.filter((stance) => stance.quote.trim() !== "");
  if (quoted.length === 0) return null;
  let hit = 0;
  for (const stance of quoted) {
    const evidence = result.case.evidence.find((item) => item.id === stance.evidenceId);
    if (!evidence) continue;
    const needle = fold(stance.quote);
    const text = evidence.text !== undefined ? fold(evidence.text) : "";
    const snippet = fold(evidence.excerpt);
    if ((text !== "" && text.includes(needle)) || (snippet !== "" && snippet.includes(needle))) {
      hit += 1;
    }
  }
  return hit / quoted.length;
}

export function provenanceDepth(_golden: ScoreCaseGolden, result: ScoreInput): number | null {
  const report = result.report;
  if (!report) return null;
  const cited: string[] = [];
  for (const row of report.citations) {
    if (result.case.evidence.some((item) => item.id === row.evidenceId)) cited.push(row.evidenceId);
  }
  if (cited.length === 0) return null;
  const aCount = cited.filter((id) => result.case.evidence.find((item) => item.id === id)?.tier === "A").length;
  return aCount / cited.length;
}

/** 逐例不适用；分位数在 summarize 里算。 */
export function latencyP50(_golden: ScoreCaseGolden, _result: ScoreInput): number | null {
  return null;
}

/** 逐例不适用；分位数在 summarize 里算。 */
export function latencyP95(_golden: ScoreCaseGolden, _result: ScoreInput): number | null {
  return null;
}

export function scoreCase(golden: ScoreCaseGolden, result: ScoreInput): CaseMetrics {
  return {
    verdictAccuracy: verdictAccuracy(golden, result),
    credibilityAccuracy: credibilityAccuracy(golden, result),
    hallucinationRate: hallucinationRate(golden, result),
    reportContractPassRate: reportContractPassRate(golden, result),
    routingAccuracy: routingAccuracy(golden, result),
    groundingRate: groundingRate(golden, result),
    quoteFidelity: quoteFidelity(golden, result),
    provenanceDepth: provenanceDepth(golden, result),
    latencyP50: latencyP50(golden, result),
    latencyP95: latencyP95(golden, result),
  };
}

export type LlmJobStat = { calls: number; failed: number; p50Ms: number | null };

export type TurnReasonCounts = { done: number; timeout: number; aborted: number; error: number };

export type RunSummary = CaseMetrics & {
  turnReasons: TurnReasonCounts;
  judgeRan: { ok: number; total: number };
  llmByJob: Record<string, LlmJobStat>;
  errorsByStage: Record<string, number>;
};

export function judgeRanOf(events: CaseEvent[]): boolean {
  return events.some(
    (event) => event.type === "stage.finished" && event.stage === "judge" && event.outcome === "ok",
  );
}

export function summarizeRun(
  cases: ReadonlyArray<{ metrics: CaseMetrics; elapsedMs: number; turnReason: string | null; judgeRan: boolean }>,
  eventLists: CaseEvent[][],
): RunSummary {
  const turnReasons: TurnReasonCounts = { done: 0, timeout: 0, aborted: 0, error: 0 };
  for (const row of cases) {
    const reason = row.turnReason;
    if (reason === "done" || reason === "timeout" || reason === "aborted" || reason === "error") {
      turnReasons[reason] += 1;
    }
  }
  const latencies = new Map<string, number[]>();
  const llmByJob: Record<string, LlmJobStat> = {};
  const errorsByStage: Record<string, number> = {};
  for (const events of eventLists) {
    for (const event of events) {
      if (event.type === "llm.called") {
        const cur = llmByJob[event.job] ?? { calls: 0, failed: 0, p50Ms: null };
        cur.calls += 1;
        if (!event.ok) cur.failed += 1;
        llmByJob[event.job] = cur;
        const list = latencies.get(event.job) ?? [];
        list.push(event.latencyMs);
        latencies.set(event.job, list);
      }
      if (event.type === "error") {
        const stage = event.stage ?? "unknown";
        errorsByStage[stage] = (errorsByStage[stage] ?? 0) + 1;
      }
    }
  }
  for (const [job, stat] of Object.entries(llmByJob)) {
    const nums = (latencies.get(job) ?? []).slice().sort((a, b) => a - b);
    stat.p50Ms = nums.length === 0 ? null : nums[Math.floor((nums.length - 1) * 0.5)] ?? null;
  }
  return {
    ...summarize(cases),
    turnReasons,
    judgeRan: { ok: cases.filter((row) => row.judgeRan).length, total: cases.length },
    llmByJob,
    errorsByStage,
  };
}

export function summarize(rows: ReadonlyArray<{ metrics: CaseMetrics; elapsedMs: number }>): CaseMetrics {
  return {
    verdictAccuracy: average(rows.map((row) => row.metrics.verdictAccuracy)),
    credibilityAccuracy: average(rows.map((row) => row.metrics.credibilityAccuracy)),
    hallucinationRate: average(rows.map((row) => row.metrics.hallucinationRate)),
    reportContractPassRate: average(rows.map((row) => row.metrics.reportContractPassRate)),
    routingAccuracy: average(rows.map((row) => row.metrics.routingAccuracy)),
    groundingRate: average(rows.map((row) => row.metrics.groundingRate)),
    quoteFidelity: average(rows.map((row) => row.metrics.quoteFidelity)),
    provenanceDepth: average(rows.map((row) => row.metrics.provenanceDepth)),
    latencyP50: quantile(
      rows.map((row) => row.elapsedMs),
      0.5,
    ),
    latencyP95: quantile(
      rows.map((row) => row.elapsedMs),
      0.95,
    ),
  };
}

function average(values: ReadonlyArray<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

function citationMarkers(text: string): number[] {
  const out: number[] = [];
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITE_RE.exec(text)) !== null) {
    out.push(Number(match[1]));
  }
  return out;
}

function urlsIn(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return found.map((url) => url.replace(TRAIL_PUNCT_RE, ""));
}

function evidenceUrlSet(c: Case): Set<string> {
  const urls = new Set<string>();
  for (const item of c.evidence) {
    urls.add(item.url);
    urls.add(item.canonicalUrl);
  }
  return urls;
}

function fold(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}
