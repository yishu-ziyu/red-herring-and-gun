/**
 * 调查流的公共活动发射器（IMPLEMENTATION_PLAN §5.1）。
 *
 * 只负责顺序：先把快照写进流，再写引用它的活动。顺序错了，客户端就会拿到
 * 指向不存在对象的发现。所以这段逻辑独立成模块并被测试，而不是留在 HTTP 处理器里。
 *
 * 不读自由文本推测关联，不做持久化，不认识 express。
 */
import {
  createActivityLog,
  type InvestigationSnapshotV1,
  type PublicActivity,
} from "./investigation/index.js";

export type InvestigationEmitter = {
  readonly runId: string;
  /** 快照先落，活动后发。重复快照不产生新活动。 */
  emitSnapshot(snapshot: InvestigationSnapshotV1): void;
  /** 动作类事件：没有可归属对象，只能描述动作。 */
  emitSearchStarted(atom: string): void;
  /** 已发过的活动，供测试与运维查看，不参与客户端语义。 */
  activities(): PublicActivity[];
};

export function createInvestigationEmitter(options: {
  runId: string;
  send: (event: Record<string, unknown>) => void;
  /** 追加活动时回调（持久化用）；失败不抛，不挡流。 */
  onActivities?: (activities: PublicActivity[]) => void;
  now?: () => Date;
  timestamp?: () => number;
}): InvestigationEmitter {
  const log = createActivityLog({ runId: options.runId, ...(options.now ? { now: options.now } : {}) });
  const timestamp = options.timestamp ?? (() => Date.now());
  let previous: InvestigationSnapshotV1 | null = null;

  const sendActivities = (activities: PublicActivity[]) => {
    if (activities.length === 0) return;
    for (const activity of activities) {
      options.send({ type: "investigation_activity", activity, timestamp: timestamp() });
    }
    try {
      options.onActivities?.(activities);
    } catch (error) {
      // 活动落库失败不影响已经发出去的帧。
      console.error("[activity] 落库失败", error);
    }
  };

  return {
    runId: options.runId,
    emitSnapshot(snapshot) {
      options.send({ type: "investigation_snapshot", investigation: snapshot, timestamp: timestamp() });
      sendActivities(log.project(previous, snapshot));
      previous = snapshot;
    },
    emitSearchStarted(atom) {
      sendActivities(log.recordSearchStarted(atom));
    },
    activities: () => log.all(),
  };
}
