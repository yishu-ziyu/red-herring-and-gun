/**
 * 一次调查怎么收场。判定顺序就是优先级；每种收场的 run 终态在这里查，额度结算在 quotaLedger.ts。
 */
import type { InvestigationSnapshotV1 } from "../../../../shared/investigation/index.js";

export type RunOutcome =
  /** 管线正常返回。 */
  | "completed"
  /** 同一说法的早先结果直接作答，没有跑新的核查。 */
  | "reused"
  /** 用户点了停止（run 的取消信号）。 */
  | "cancelled"
  /** 总时限与收尾宽限都过了，管线仍没回来：给「还没查完」的中间结论。 */
  | "timed-out"
  /** 管线因中止而退出（客户端断开时代留下的路径）：放弃不能变成免费重试入口。 */
  | "client-gone"
  /** 服务端真失败（含图片解析失败）。 */
  | "server-error";

type FailureOutcome = "cancelled" | "timed-out" | "client-gone" | "server-error";

/** 总时限与宽限期的超时错误都带这个标签（withTimeout 的 label）。 */
export const TIMEOUT_LABEL = "整体核查";

export function classifyFailure(error: unknown, state: { cancelled: boolean }): FailureOutcome {
  if (state.cancelled) return "cancelled";
  if (error instanceof Error && error.message.includes(TIMEOUT_LABEL)) return "timed-out";
  if (error instanceof Error && (error.message.includes("client-disconnected") || error.name === "AbortError")) {
    return "client-gone";
  }
  return "server-error";
}

/** run 的终态：正常返回与复用早先结果算 completed；取消是 cancelled；其余都是 interrupted。 */
export const RUN_FINAL_STATUS: Record<RunOutcome, "completed" | "cancelled" | "interrupted"> = {
  completed: "completed",
  reused: "completed",
  cancelled: "cancelled",
  "timed-out": "interrupted",
  "client-gone": "interrupted",
  "server-error": "interrupted",
};

/** 一次执行交给 RunService.settle 的全部材料；怎么落终态、发哪些终态帧由 settle 决定。 */
export type RunEnding = {
  outcome: RunOutcome;
  /** 「你调查的说法」；没有任何快照时中断帧用它。 */
  displayClaim: string;
  /** 这次执行最后产出的快照：完成帧，或中断前最后一帧。 */
  snapshot?: InvestigationSnapshotV1;
  report?: Record<string, unknown>;
  /** 没有任何可核查的内容：直接说明原因，不发中断快照。 */
  failure?: { code: string; message: string };
};
