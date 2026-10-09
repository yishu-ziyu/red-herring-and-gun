/**
 * 一次调查怎么收场，以及每种收场怎么结算额度（behavior-spec 第 10 节）。
 *
 * 历史上出过的事都出在这里：超时收尾先退还再计费，commit 变空操作，超时等于白嫖（handlers B2）；
 * 取消后迟到的完成帧覆盖「已停止」。判定顺序就是优先级，结算规则一处可查。
 */

export type RunOutcome =
  /** 管线正常返回。 */
  | "completed"
  /** 用户点了停止（run 的取消信号）。 */
  | "cancelled"
  /** 总时限与收尾宽限都过了，管线仍没回来：给「还没查完」的中间结论。 */
  | "timed-out"
  /** 管线因中止而退出（客户端断开时代留下的路径）：放弃不能变成免费重试入口。 */
  | "client-gone"
  /** 服务端真失败（含图片解析失败）。 */
  | "server-error";

export type FailureOutcome = Exclude<RunOutcome, "completed">;

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

/** 额度结算：commit 计入今天的次数，release 退还。 */
export const QUOTA_SETTLEMENT: Record<RunOutcome, "commit" | "release"> = {
  completed: "commit",
  cancelled: "release",
  // 超时给了中间结论，照常计费。
  "timed-out": "commit",
  "client-gone": "commit",
  "server-error": "release",
};

/** run 的终态：只有正常返回算 completed；取消是 cancelled；其余都是 interrupted。 */
export const RUN_FINAL_STATUS: Record<RunOutcome, "completed" | "cancelled" | "interrupted"> = {
  completed: "completed",
  cancelled: "cancelled",
  "timed-out": "interrupted",
  "client-gone": "interrupted",
  "server-error": "interrupted",
};
