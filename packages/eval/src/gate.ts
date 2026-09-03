import type { CaseMetrics } from "./score.js";

export const GATE_METRIC_NAMES = [
  "verdictAccuracy",
  "credibilityAccuracy",
  "hallucinationRate",
  "reportContractPassRate",
] as const;

export type GateMetricName = (typeof GATE_METRIC_NAMES)[number];

export type GateSnapshot = Record<GateMetricName, number>;

export type GateRow = {
  name: GateMetricName;
  old: number;
  new: number;
  delta: number;
  ok: boolean;
};

export const GATE_TOLERANCE = 0.02;

const HIGHER_IS_BETTER: Record<GateMetricName, boolean> = {
  verdictAccuracy: true,
  credibilityAccuracy: true,
  hallucinationRate: false,
  reportContractPassRate: true,
};

export function parseBaseline(raw: unknown): GateSnapshot {
  if (raw === null || typeof raw !== "object") {
    throw new Error("baseline is not an object");
  }
  const root = raw as Record<string, unknown>;
  const nested = root.summary;
  const bag: Record<string, unknown> =
    nested !== null && typeof nested === "object" ? { ...root, ...(nested as Record<string, unknown>) } : root;
  const out = {} as GateSnapshot;
  for (const name of GATE_METRIC_NAMES) {
    const value = bag[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`baseline missing numeric ${name}`);
    }
    out[name] = value;
  }
  return out;
}

export function snapshotFromSummary(summary: CaseMetrics): GateSnapshot {
  return {
    verdictAccuracy: summary.verdictAccuracy ?? 0,
    credibilityAccuracy: summary.credibilityAccuracy ?? 0,
    hallucinationRate: summary.hallucinationRate ?? 0,
    reportContractPassRate: summary.reportContractPassRate ?? 0,
  };
}

export function compareGate(old: GateSnapshot, current: GateSnapshot): { passed: boolean; rows: GateRow[] } {
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
