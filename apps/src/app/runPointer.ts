/**
 * 进行中那条 run 在本机留的座标（localStorage `rhg:active-run`）：刷新后靠它接回去，而不是重开一次调查。
 */
import type { CaseIntake } from "../lib/caseIntake";
import type { InvestigationRound, InvestigationThread } from "../lib/investigationThread";

export type StoredRunPointer = {
  runId: string;
  claim: string;
  intake: CaseIntake | null;
  lastSeq: number;
  at: number;
  localId?: string;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  thread?: InvestigationThread;
  accountScope?: string | null;
};

const RUN_POINTER_KEY = "rhg:active-run";

export function readRunPointer(): StoredRunPointer | null {
  try {
    const raw = window.localStorage.getItem(RUN_POINTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRunPointer;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRunPointer(value: StoredRunPointer | null): void {
  try {
    if (value) window.localStorage.setItem(RUN_POINTER_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(RUN_POINTER_KEY);
  } catch {
    /* 隐私模式下写不了就不写，不影响调查本身 */
  }
}
