import { reduce } from "../casefile/reduce.js";
import { validateEvent, type Case, type CaseEvent } from "../casefile/schema.js";
import type { CallJobParams, CallJobResult } from "../llm/callJob.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 阶段发出的事件：seq / at 由 context 填。 */
export type EventInput = DistributiveOmit<CaseEvent, "seq" | "at">;

/** 阶段拿到的 LLM 入口；env 已由 runner 绑定。 */
export type LlmJob = (params: Omit<CallJobParams, "env">) => Promise<CallJobResult>;

export interface StageContext {
  /** 最新案件快照，每次 emit 后更新。 */
  readonly current: Case;
  /** 本 context 追加过的事件（不含初始事件）。 */
  readonly emitted: readonly CaseEvent[];
  /** 唯一写入口：校验 → 折叠 → 返回新快照。 */
  emit(event: EventInput): Case;
  /** 每次调用自动发 `llm.called`；抛错也记（ok=false）后原样抛出。 */
  llm: LlmJob;
  now(): string;
  signal?: AbortSignal;
}

export function createStageContext(init: {
  case: Case;
  llm: LlmJob;
  now?: () => string;
  signal?: AbortSignal;
}): StageContext {
  let current = init.case;
  const emitted: CaseEvent[] = [];
  const now = init.now ?? (() => new Date().toISOString());

  const emit = (event: EventInput): Case => {
    const full = validateEvent({ ...event, seq: current.seq + 1, at: now() });
    current = reduce(current, full);
    emitted.push(full);
    return current;
  };

  const llm: LlmJob = async (params) => {
    const started = Date.now();
    try {
      const result = await init.llm(params);
      emit({ type: "llm.called", job: params.job, model: result.model, latencyMs: result.latencyMs, ok: true });
      return result;
    } catch (error) {
      emit({ type: "llm.called", job: params.job, model: "", latencyMs: Date.now() - started, ok: false });
      throw error;
    }
  };

  return {
    get current() {
      return current;
    },
    get emitted() {
      return emitted;
    },
    emit,
    llm,
    now,
    signal: init.signal,
  };
}
