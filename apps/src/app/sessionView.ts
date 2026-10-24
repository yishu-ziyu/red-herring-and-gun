/**
 * 当前这次调查此刻该显示什么。界面显示和结果落库都按这一份判断，不各自再读连接状态。
 */
import { interruptedInvestigationSnapshot } from "../../shared/interruptedSnapshot";
import type { InvestigationSnapshotV1 } from "../../shared/investigation";
import type { RunState } from "../goldenPath/useInvestigationRun";
import type { ActiveCase } from "./caseHistory";
import { publicTransportError } from "../goldenPath/copy";

export type SessionView =
  | { kind: "home" }
  /** 还没有可显示的内容。failure 非空：流已结束或失败，什么都没带回来；内容是给用户看的原因。 */
  | { kind: "waiting"; failure: string | null }
  | { kind: "live"; snapshot: InvestigationSnapshotV1 }
  /** 超时后管线仍在跑：连接还活着，等结果变成可选。 */
  | { kind: "timeoutPending"; snapshot: InvestigationSnapshotV1 | null }
  | { kind: "reconnecting"; snapshot: InvestigationSnapshotV1 | null }
  | { kind: "disconnected"; snapshot: InvestigationSnapshotV1 | null; runId: string | null }
  /** 这一轮已有定论（完成、中断，或历史回看）。report 是服务端报告；流断了没等到报告时为 null。 */
  | { kind: "settled"; snapshot: InvestigationSnapshotV1; report: Record<string, unknown> | null; restoredAt?: number };

export function sessionView(run: RunState, active: ActiveCase | null, connectionLost: string): SessionView {
  if (active?.restored) {
    return { kind: "settled", snapshot: active.restored.snapshot, report: active.restored.report, restoredAt: active.restored.at };
  }
  const { snapshot, connection } = run;
  if (connection === "disconnected") return { kind: "disconnected", snapshot, runId: run.runId };
  if (run.resumed && connection === "connecting") return { kind: "reconnecting", snapshot };
  if (run.timeoutPending && !run.finalReport && (connection === "live" || connection === "connecting")) {
    return { kind: "timeoutPending", snapshot };
  }
  const streamOver = connection === "ended" || connection === "failed";
  if (!snapshot) return { kind: "waiting", failure: streamOver && !run.finalReport ? publicTransportError(run.errorMessage, connectionLost) : null };
  if (!streamOver) return { kind: "live", snapshot };
  // 流结束了却没等到报告、快照也停在中途：按 interrupted 收口（保留数据、可重试），不停在「还在查」。
  const unfinished = !run.finalReport && snapshot.phase !== "complete" && snapshot.phase !== "interrupted";
  return {
    kind: "settled",
    snapshot: unfinished ? interruptedInvestigationSnapshot(snapshot, snapshot.originalClaim) : snapshot,
    report: run.finalReport,
  };
}
