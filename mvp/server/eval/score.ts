/**
 * eval/score.ts — 针对 casePipeline 的评估指标（生产路径）。
 *
 * 客户端旧 benchmark 绑定已退役的 AgentRuntime，不能作为生产评测入口。
 * 这里是 casePipeline 的唯一评分实现：输入是 PipelineStep[] + finalReport，
 * 纯函数，无 I/O，可单测。
 */

export interface CaseResult {
  case: {
    id: string;
    claim: string;
    category: string;
    difficulty: string;
    expectedVerdictType: string;
    expectedCredibilityRange: [number, number];
    expectedAgentSequence: string[];
    expectsEvidenceLoop?: boolean;
    expectedAtoms?: Array<{
      atom: string;
      expectedVerdict: string;
      requireBoundUrl?: boolean;
    }>;
    mustSearch?: string[];
  };
  steps: Array<{ agent?: string; output?: Record<string, unknown> }>;
  finalReport: Record<string, unknown>;
  /** 生产 atomSearchBundle；只读 atomsSearched */
  atomSearchBundle?: unknown;
  /** ADR-004 evidenceLoop 结果（结构兼容 EvidenceLoopOutcome） */
  evidenceLoop?: {
    ran: boolean;
    atoms: Array<{ atom: string; trigger: string; stopReason: string; rounds?: number }>;
    totalNewSources: number;
    recheckFactChecker: boolean;
  };
  error?: string;
}

export interface MetricScores {
  caseId: string;
  claim: string;
  category: string;
  difficulty: string;
  routingCorrect: boolean;
  verdictCorrect: boolean;
  credibilityInRange: boolean;
  hallucinationDetected: boolean;
  reportContractPass: boolean;
  reportReviewScore: number;
  overallPass: boolean;
  atomMatchPass: boolean;
  mustSearchPass: boolean;
  /** ADR-004 观测指标（不进门禁）：期望补查的 case 是否真触发 / 是否翻案 */
  evidenceLoopExpected: boolean;
  evidenceLoopRan: boolean;
  evidenceLoopRescued: boolean;
}

export interface AggregateMetrics {
  totalCases: number;
  passed: number;
  failed: number;
  routingAccuracy: number;
  verdictAccuracy: number;
  credibilityAccuracy: number;
  hallucinationRate: number;
  reportContractPassRate: number;
  avgReportReviewScore: number;
  byCategory: Record<string, { total: number; passed: number; verdictCorrectCount: number }>;
  failures: Array<{ caseId: string; claim: string; reason: string }>;
  /** ADR-004 观测指标：分母 = expectsEvidenceLoop 的 case 数 */
  evidenceLoopExpectedCount: number;
  evidenceLoopTriggerRate: number;
  evidenceLoopRescueRate: number;
}

function extractVerdict(report: Record<string, unknown>): string {
  return typeof report.verdictType === "string" ? report.verdictType : "unknown";
}

function extractCredibility(report: Record<string, unknown>): number {
  const score = report.credibilityScore;
  if (typeof score === "number" && Number.isFinite(score)) return score;
  return 50;
}

/** 幻觉 = 系统给出确定判定，但 golden 认为应更谨慎。语义与前端 isHallucination 对齐。 */
function isHallucination(goldenVerdict: string, actual: string): boolean {
  if (goldenVerdict === "unverified" && (actual === "true" || actual === "false")) return true;
  if (goldenVerdict === "mixed_misleading" && actual === "true") return true;
  if (goldenVerdict === "true" && actual === "false") return true;
  if (goldenVerdict === "false" && actual === "true") return true;
  return false;
}

function normalizeAtom(text: string): string {
  return text.replace(/\u3000/g, " ").trim();
}

function atomTextMatches(expected: string, actual: string): boolean {
  const e = normalizeAtom(expected);
  const a = normalizeAtom(actual);
  if (!e || !a) return false;
  return a === e || a.includes(e) || e.includes(a);
}

function hasBoundHttpUrl(verdict: { supportingSources?: unknown; sourcesRelatedOnly?: unknown }): boolean {
  if (verdict.sourcesRelatedOnly === true) return false;
  const sources = Array.isArray(verdict.supportingSources) ? verdict.supportingSources : [];
  return sources.some((s) => {
    if (!s || typeof s !== "object") return false;
    return /^https?:\/\//i.test(String((s as { url?: unknown }).url || "").trim());
  });
}

function readSubclaimVerdicts(report: Record<string, unknown>): Array<{
  claimAtom: string;
  verdict: string;
  supportingSources?: unknown;
  sourcesRelatedOnly?: unknown;
}> {
  const raw = report.subclaimVerdicts;
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    claimAtom: string;
    verdict: string;
    supportingSources?: unknown;
    sourcesRelatedOnly?: unknown;
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.claimAtom !== "string") continue;
    out.push({
      claimAtom: rec.claimAtom,
      verdict: typeof rec.verdict === "string" ? rec.verdict : "",
      supportingSources: rec.supportingSources,
      sourcesRelatedOnly: rec.sourcesRelatedOnly,
    });
  }
  return out;
}

function readAtomsSearched(bundle: unknown): string[] {
  if (!bundle || typeof bundle !== "object") return [];
  const atoms = (bundle as { atomsSearched?: unknown }).atomsSearched;
  if (!Array.isArray(atoms)) return [];
  return atoms.filter((a): a is string => typeof a === "string");
}

function scoreAtomMatch(
  expectedAtoms: CaseResult["case"]["expectedAtoms"],
  report: Record<string, unknown>
): boolean {
  if (!expectedAtoms || expectedAtoms.length === 0) return true;
  const actuals = readSubclaimVerdicts(report);
  for (const exp of expectedAtoms) {
    const hit = actuals.find((a) => atomTextMatches(exp.atom, a.claimAtom));
    if (!hit) return false;
    if (hit.verdict !== exp.expectedVerdict) return false;
    if (exp.requireBoundUrl && !hasBoundHttpUrl(hit)) return false;
  }
  return true;
}

function scoreMustSearch(needles: string[] | undefined, bundle: unknown): boolean {
  if (!needles || needles.length === 0) return true;
  const searched = readAtomsSearched(bundle);
  return needles.every((needle) => {
    const n = normalizeAtom(needle);
    if (!n) return true;
    return searched.some((atom) => atomTextMatches(n, atom));
  });
}

export function scoreCase(result: CaseResult): MetricScores {
  const golden = result.case;
  const loopExpected = golden.expectsEvidenceLoop === true;
  const loop = result.evidenceLoop;
  const loopRan = loop?.ran === true;
  // 翻案 = 补查命中新证据（任一原子 evidence-found）
  const loopRescued = loopRan && (loop?.atoms?.some((a) => a.stopReason === "evidence-found") ?? false);
  if (result.error) {
    return {
      caseId: golden.id,
      claim: golden.claim,
      category: golden.category,
      difficulty: golden.difficulty,
      routingCorrect: false,
      verdictCorrect: false,
      credibilityInRange: false,
      hallucinationDetected: false,
      reportContractPass: false,
      reportReviewScore: 0,
      overallPass: false,
      atomMatchPass: true,
      mustSearchPass: true,
      evidenceLoopExpected: loopExpected,
      evidenceLoopRan: false,
      evidenceLoopRescued: false,
    };
  }

  const actualAgents = result.steps.map((s) => s.agent).filter(Boolean) as string[];
  // routing：非 concept 需包含 rumor/fact/source/report 四个主链 agent
  let routingCorrect: boolean;
  if (golden.category === "concept") {
    routingCorrect = actualAgents.filter((a) => a !== "report_composer").length === 0;
  } else {
    routingCorrect =
      actualAgents.includes("rumor_detector") &&
      actualAgents.includes("fact_checker") &&
      actualAgents.includes("source_validator") &&
      actualAgents.includes("report_composer");
  }

  const actualVerdict = extractVerdict(result.finalReport);
  const actualCredibility = extractCredibility(result.finalReport);
  const verdictCorrect = actualVerdict === golden.expectedVerdictType;
  const credibilityInRange =
    actualCredibility >= golden.expectedCredibilityRange[0] &&
    actualCredibility <= golden.expectedCredibilityRange[1];
  const hallucinationDetected = isHallucination(golden.expectedVerdictType, actualVerdict);
  const atomMatchPass = scoreAtomMatch(golden.expectedAtoms, result.finalReport);
  const mustSearchPass = scoreMustSearch(golden.mustSearch, result.atomSearchBundle);

  // 报告契约：确定性 reviewer 检查（与生产 reviewAndRepairReport 同源，写入 finalReport._review）
  const review = result.finalReport._review as
    | { passed?: boolean; errorCount?: number; issueCount?: number; score?: number }
    | undefined;
  const reportContractPass = review?.passed === true;
  // reviewer 不写 score，用与 production 一致的 errorCount*25 + warnCount*8 推导
  const errorCount = typeof review?.errorCount === "number" ? review.errorCount : 0;
  const issueCount = typeof review?.issueCount === "number" ? review.issueCount : 0;
  const warnCount = Math.max(0, issueCount - errorCount);
  const reportReviewScore =
    typeof review?.score === "number"
      ? review.score
      : Math.max(0, Math.min(100, 100 - errorCount * 25 - warnCount * 8));

  const overallPass =
    routingCorrect &&
    verdictCorrect &&
    credibilityInRange &&
    !hallucinationDetected &&
    reportContractPass &&
    atomMatchPass &&
    mustSearchPass;

  return {
    caseId: golden.id,
    claim: golden.claim,
    category: golden.category,
    difficulty: golden.difficulty,
    routingCorrect,
    verdictCorrect,
    credibilityInRange,
    hallucinationDetected,
    reportContractPass,
    reportReviewScore,
    overallPass,
    atomMatchPass,
    mustSearchPass,
    evidenceLoopExpected: loopExpected,
    evidenceLoopRan: loopRan,
    evidenceLoopRescued: loopRescued,
  };
}

/** 多次重复跑同一 case 后的聚合输入（每轮一次）。 */
export interface RepeatRun {
  verdict: string;
  credibility: number;
  error?: string;
}

/**
 * 对同一 case 的多次结果做稳定聚合：
 * - verdict：多数票（并列时取字典序最小，保证确定性）
 * - credibility：中位数（抗单次极端值）
 * - error：仅当全部轮次都 error 时保留
 */
export function aggregateRepeats(runs: RepeatRun[]): {
  verdict: string;
  credibility: number;
  error?: string;
  verdictVotes: Record<string, number>;
  credibilitySamples: number[];
} {
  if (runs.length === 0) {
    return { verdict: "unknown", credibility: 50, error: "no runs", verdictVotes: {}, credibilitySamples: [] };
  }

  const ok = runs.filter((r) => !r.error);
  if (ok.length === 0) {
    return {
      verdict: "ERROR",
      credibility: 50,
      error: runs[0]?.error ?? "all repeats failed",
      verdictVotes: {},
      credibilitySamples: [],
    };
  }

  const votes: Record<string, number> = {};
  for (const r of ok) {
    votes[r.verdict] = (votes[r.verdict] ?? 0) + 1;
  }
  const majorityVerdict = Object.entries(votes).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0][0];

  const samples = ok.map((r) => r.credibility).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 1 ? samples[mid] : Math.round((samples[mid - 1] + samples[mid]) / 2);

  return {
    verdict: majorityVerdict,
    credibility: median,
    verdictVotes: votes,
    credibilitySamples: samples,
  };
}

export function aggregateMetrics(scores: MetricScores[]): AggregateMetrics {
  const total = scores.length;
  const passed = scores.filter((s) => s.overallPass).length;

  const routingCorrect = scores.filter((s) => s.routingCorrect).length;
  const verdictCorrect = scores.filter((s) => s.verdictCorrect).length;
  const credibilityCorrect = scores.filter((s) => s.credibilityInRange).length;
  const hallucinations = scores.filter((s) => s.hallucinationDetected).length;
  const contractPass = scores.filter((s) => s.reportContractPass).length;
  const reviewScoreSum = scores.reduce((acc, s) => acc + s.reportReviewScore, 0);

  const byCategory: Record<string, { total: number; passed: number; verdictCorrectCount: number }> = {};
  for (const s of scores) {
    if (!byCategory[s.category]) byCategory[s.category] = { total: 0, passed: 0, verdictCorrectCount: 0 };
    byCategory[s.category].total++;
    if (s.overallPass) byCategory[s.category].passed++;
    if (s.verdictCorrect) byCategory[s.category].verdictCorrectCount++;
  }

  // ADR-004 观测指标：分母 = expectsEvidenceLoop 的 case
  const loopExpectedScores = scores.filter((s) => s.evidenceLoopExpected);
  const loopExpectedCount = loopExpectedScores.length;
  const loopTriggeredCount = loopExpectedScores.filter((s) => s.evidenceLoopRan).length;
  const loopRescuedCount = loopExpectedScores.filter((s) => s.evidenceLoopRescued).length;

  const failures = scores
    .filter((s) => !s.overallPass)
    .map((s) => ({
      caseId: s.caseId,
      claim: s.claim,
      reason: [
        !s.routingCorrect && "routing wrong",
        !s.verdictCorrect && "verdict mismatch",
        !s.credibilityInRange && "credibility out of range",
        s.hallucinationDetected && "hallucination detected",
        !s.reportContractPass && `report contract fail (score ${s.reportReviewScore})`,
        !s.atomMatchPass && "atom verdict mismatch",
        !s.mustSearchPass && "mustSearch miss",
      ]
        .filter(Boolean)
        .join("; "),
    }));

  return {
    totalCases: total,
    passed,
    failed: total - passed,
    routingAccuracy: total > 0 ? routingCorrect / total : 0,
    verdictAccuracy: total > 0 ? verdictCorrect / total : 0,
    credibilityAccuracy: total > 0 ? credibilityCorrect / total : 0,
    hallucinationRate: total > 0 ? hallucinations / total : 0,
    reportContractPassRate: total > 0 ? contractPass / total : 0,
    avgReportReviewScore: total > 0 ? reviewScoreSum / total : 0,
    byCategory,
    failures,
    evidenceLoopExpectedCount: loopExpectedCount,
    evidenceLoopTriggerRate: loopExpectedCount > 0 ? loopTriggeredCount / loopExpectedCount : 0,
    evidenceLoopRescueRate: loopExpectedCount > 0 ? loopRescuedCount / loopExpectedCount : 0,
  };
}

const GATE_METRICS = ["verdictAccuracy", "routingAccuracy", "reportContractPassRate"] as const;

export type BaselineGateInput = {
  totalCases: number;
  verdictAccuracy?: number;
  routingAccuracy?: number;
  reportContractPassRate?: number;
};

export type BaselineCheck = {
  name: string;
  baseline: number;
  current: number;
  ok: boolean;
};

/** 先比 totalCases（条数变了旧聚合不能当门禁），再比三项准确率，容忍 5 个点。 */
export function compareToBaseline(
  baseline: BaselineGateInput,
  current: BaselineGateInput,
  tolerance = 0.05
): { passed: boolean; checks: BaselineCheck[] } {
  const checks: BaselineCheck[] = [
    {
      name: "totalCases",
      baseline: baseline.totalCases,
      current: current.totalCases,
      ok: baseline.totalCases === current.totalCases,
    },
  ];
  for (const name of GATE_METRICS) {
    const base = baseline[name] ?? 0;
    const cur = current[name] ?? 0;
    checks.push({
      name,
      baseline: base,
      current: cur,
      ok: cur - base >= -tolerance,
    });
  }
  return { passed: checks.every((c) => c.ok), checks };
}