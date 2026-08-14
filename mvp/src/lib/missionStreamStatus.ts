export type MissionStreamStatus = "queued" | "running" | "completed" | "failed" | "final";
export type MissionRunStatus = "idle" | "running" | "completed" | "failed";

export interface MissionStreamStatusLike {
  status: MissionStreamStatus;
}

export interface MissionStreamStatusSummary {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  final: number;
  done: number;
  headline: string;
  detail: string;
}

const EMPTY_SUMMARY = {
  total: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  final: 0,
  done: 0,
};

export function summarizeMissionStreamStatus(
  items: MissionStreamStatusLike[],
  runStatus: MissionRunStatus,
): MissionStreamStatusSummary {
  const counts = items.reduce(
    (acc, item) => ({
      ...acc,
      [item.status]: acc[item.status] + 1,
      total: acc.total + 1,
    }),
    EMPTY_SUMMARY,
  );
  const done = counts.completed + counts.final;

  if (counts.total === 0) {
    if (runStatus === "running") {
      return {
        ...counts,
        done,
        headline: "确认核查问题",
        detail: "已启动，等待第一条可展示步骤",
      };
    }

    return {
      ...counts,
      done,
      headline: "暂无步骤",
      detail: runStatus === "idle" ? "尚未开始核查" : "没有收到过程记录",
    };
  }

  // Determinate when we know total steps: prefer k/N over vague activity copy.
  const parts = [
    `${done}/${counts.total}`,
    counts.running > 0 ? `${counts.running} 进行中` : null,
    counts.failed > 0 ? `${counts.failed} 失败` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    ...counts,
    done,
    headline: parts.join(" · ") || "过程记录",
    detail: `共 ${counts.total} 步${counts.queued > 0 ? ` · ${counts.queued} 待处理` : ""}`,
  };
}
