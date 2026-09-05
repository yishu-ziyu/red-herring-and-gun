import type { CaseMetrics, QualificationExpectation } from "./score.js";

/** 指标语义版本。分母规则或案例集合含义变了必须加一，旧基线不得再比数字。 */
export const METRIC_SEMVER = "4.0.0";

export const GATE_METRIC_NAMES = [
  "verdictAccuracy",
  "credibilityAccuracy",
  "citationIntegrityErrorRate",
  "reportContractPassRate",
] as const;

export type GateMetricName = (typeof GATE_METRIC_NAMES)[number];

export type GateSnapshot = Record<GateMetricName, number> & {
  metricSemver: string;
  caseIds: string[];
  qualificationFingerprint: string;
};

export type CaseIdentity = { id: string; qualification: QualificationExpectation };

export type GateRow = {
  name: GateMetricName;
  old: number;
  new: number;
  delta: number;
  ok: boolean;
};

export type GateCompare = {
  passed: boolean;
  rows: GateRow[];
  rejectReason?: string;
};

export const GATE_TOLERANCE = 0.02;

const HIGHER_IS_BETTER: Record<GateMetricName, boolean> = {
  verdictAccuracy: true,
  credibilityAccuracy: true,
  citationIntegrityErrorRate: false,
  reportContractPassRate: true,
};

export function uniqueCaseIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function caseSetKey(ids: readonly string[]): string {
  return [...ids].sort().join("\0");
}

export function qualificationFingerprintOf(rows: readonly CaseIdentity[]): string {
  const first = new Map<string, QualificationExpectation>();
  for (const row of rows) {
    if (!first.has(row.id)) first.set(row.id, row.qualification);
  }
  return [...first.keys()]
    .sort()
    .map((id) => `${id}:${first.get(id)}`)
    .join(",");
}

function fingerprintHasUnlabeled(fingerprint: string): boolean {
  return fingerprint.split(",").some((part) => part.endsWith(":unlabeled"));
}

export function parseBaseline(raw: unknown): GateSnapshot {
  if (raw === null || typeof raw !== "object") {
    throw new Error("baseline is not an object");
  }
  const root = raw as Record<string, unknown>;
  const nested = root.summary;
  const bag: Record<string, unknown> =
    nested !== null && typeof nested === "object" ? { ...root, ...(nested as Record<string, unknown>) } : root;
  const metricSemver = bag.metricSemver;
  if (typeof metricSemver !== "string" || metricSemver.length === 0) {
    throw new Error("baseline missing metricSemver");
  }
  const caseIdsRaw = bag.caseIds;
  if (!Array.isArray(caseIdsRaw) || caseIdsRaw.some((id) => typeof id !== "string")) {
    throw new Error("baseline missing caseIds");
  }
  const qualificationFingerprint = bag.qualificationFingerprint;
  if (typeof qualificationFingerprint !== "string" || qualificationFingerprint.length === 0) {
    throw new Error("baseline missing qualificationFingerprint");
  }
  const out = {
    metricSemver,
    caseIds: uniqueCaseIds(caseIdsRaw),
    qualificationFingerprint,
  } as GateSnapshot;
  for (const name of GATE_METRIC_NAMES) {
    const value = bag[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`baseline missing numeric ${name}`);
    }
    out[name] = value;
  }
  return out;
}

export function snapshotFromSummary(summary: CaseMetrics, cases: readonly CaseIdentity[]): GateSnapshot {
  return {
    metricSemver: METRIC_SEMVER,
    caseIds: uniqueCaseIds(cases.map((row) => row.id)),
    qualificationFingerprint: qualificationFingerprintOf(cases),
    verdictAccuracy: summary.verdictAccuracy ?? 0,
    credibilityAccuracy: summary.credibilityAccuracy ?? 0,
    citationIntegrityErrorRate: summary.citationIntegrityErrorRate ?? 0,
    reportContractPassRate: summary.reportContractPassRate ?? 0,
  };
}

export function compareGate(old: GateSnapshot, current: GateSnapshot): GateCompare {
  if (old.metricSemver !== current.metricSemver) {
    return {
      passed: false,
      rows: [],
      rejectReason: `metricSemver mismatch: baseline ${old.metricSemver} vs current ${current.metricSemver}`,
    };
  }
  if (caseSetKey(old.caseIds) !== caseSetKey(current.caseIds)) {
    return {
      passed: false,
      rows: [],
      rejectReason: `case set mismatch: baseline [${old.caseIds.join(",")}] vs current [${current.caseIds.join(",")}]`,
    };
  }
  if (old.qualificationFingerprint !== current.qualificationFingerprint) {
    return {
      passed: false,
      rows: [],
      rejectReason: `qualification fingerprint mismatch: baseline ${old.qualificationFingerprint} vs current ${current.qualificationFingerprint}`,
    };
  }
  if (fingerprintHasUnlabeled(old.qualificationFingerprint) || fingerprintHasUnlabeled(current.qualificationFingerprint)) {
    return {
      passed: false,
      rows: [],
      rejectReason: "unlabeled qualification",
    };
  }
  const rows: GateRow[] = GATE_METRIC_NAMES.map((name) => {
    const prev = old[name];
    const next = current[name];
    const delta = next - prev;
    const regress = HIGHER_IS_BETTER[name] ? prev - next : next - prev;
    return { name, old: prev, new: next, delta, ok: regress <= GATE_TOLERANCE + 1e-9 };
  });
  return { passed: rows.every((row) => row.ok), rows };
}

export function formatGateLine(row: GateRow): string {
  return `${row.name} ${row.old} ${row.new} ${row.delta}`;
}
