/**
 * 调查流的公共活动发射器。
 *
 * 只负责顺序：先把快照写进流，再写引用它的活动。顺序错了，客户端就会拿到
 * 指向不存在对象的发现。
 *
 * 不读自由文本推测关联，不做持久化，不认识 express。
 */
import {
  createActivityLog,
  type InvestigationSnapshotV1,
} from "../../../shared/investigation/index.js";

type InvestigationEmitter = {
  /** 快照帧在前，它引出的活动在后；调用方原样一次提交。重复快照不产生新活动。 */
  snapshotEvents(snapshot: InvestigationSnapshotV1): Record<string, unknown>[];
  /** 动作类事件：没有可归属对象，只能描述动作。 */
  emitSearchStarted(atom: string): void;
};

export function createInvestigationEmitter(options: {
  runId: string;
  send: (event: Record<string, unknown>) => void;
}): InvestigationEmitter {
  const log = createActivityLog(options.runId);
  const timestamp = () => Date.now();
  let previous: InvestigationSnapshotV1 | null = null;

  return {
    snapshotEvents(snapshot) {
      const activities = log.project(previous, snapshot);
      previous = snapshot;
      return [
        { type: "investigation_snapshot", investigation: snapshot, timestamp: timestamp() },
        ...activities.map(activity => ({ type: "investigation_activity", activity, timestamp: timestamp() })),
      ];
    },
    emitSearchStarted(atom) {
      for (const activity of log.recordSearchStarted(atom)) {
        options.send({ type: "investigation_activity", activity, timestamp: timestamp() });
      }
    },
  };
}
