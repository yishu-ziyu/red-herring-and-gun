/**
 * 刷新接回的座标：进行中的 run 记在 localStorage `rhg:active-run`，终态或回首页时清掉。
 */
import type { CaseIntake } from "../lib/caseIntake";
import { readInvestigationThread, type InvestigationRound, type InvestigationThread } from "../../shared/investigationThread";
import type { ActiveCase } from "./caseHistory";

export type RunPointer = {
  runId: string;
  claim: string;
  intake: CaseIntake | null;
  lastSeq: number;
  at: number;
  localId?: string;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  thread?: InvestigationThread;
};

const RUN_POINTER_KEY = "rhg:active-run";

export function readRunPointer(): RunPointer | null {
  try {
    const raw = window.localStorage.getItem(RUN_POINTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunPointer;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRunPointer(value: RunPointer | null): void {
  try {
    if (value) window.localStorage.setItem(RUN_POINTER_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(RUN_POINTER_KEY);
  } catch {
    /* 隐私模式下写不了就不写，不影响调查本身 */
  }
}

export function activeCaseFromPointer(pointer: RunPointer): ActiveCase {
  return {
    localId: pointer.localId ?? `case-${pointer.at}`,
    roundId: pointer.roundId,
    roundKind: pointer.roundKind,
    thread: readInvestigationThread({ investigationThread: pointer.thread }),
    claim: pointer.claim,
    intake: pointer.intake,
    restored: null,
  };
}

export function pointerForRun(active: ActiveCase, runId: string, lastSeq: number): RunPointer {
  return {
    runId,
    claim: active.claim,
    intake: active.intake,
    lastSeq,
    at: Date.now(),
    localId: active.localId,
    roundId: active.roundId,
    roundKind: active.roundKind,
    thread: active.thread,
  };
}
