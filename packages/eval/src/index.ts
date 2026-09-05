export const PACKAGE = "@rhg/eval" as const;
export { goldenDataset, type ExpectedAtom, type ExpectedAtomVerdict, type ScoreCaseGolden } from "./golden.js";
export {
  credibilityAccuracy,
  groundingRate,
  citationIntegrityErrorRate,
  latencyP50,
  latencyP95,
  provenanceDepth,
  quoteFidelity,
  reportContractPassRate,
  routingAccuracy,
  scoreCase,
  summarize,
  verdictAccuracy,
  type CaseMetrics,
  type ScoreInput,
} from "./score.js";
export {
  compareGate,
  GATE_METRIC_NAMES,
  parseBaseline,
  type GateRow,
  type GateSnapshot,
} from "./gate.js";
