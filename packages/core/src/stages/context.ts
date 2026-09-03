import { reduce } from "../casefile/reduce.js";
import { validateEvent, type Case, type CaseEvent } from "../casefile/schema.js";
import type { CallJobParams, CallJobResult, JobAttempt } from "../llm/callJob.js";

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
  clock(): number;
  signal?: AbortSignal;
  deadline?: number;
}

export function createStageContext(init: {
  case: Case;
  llm: LlmJob;
  now?: () => string;
  clock?: () => number;
  signal?: AbortSignal;
  deadline?: number;
  /** 每个已折叠事件同步回调一次；运行器用它把事件流给 SSE / 存储。 */
  onEvent?: (event: CaseEvent) => void;
}): StageContext {
  let current = init.case;
  const emitted: CaseEvent[] = [];
  const now = init.now ?? (() => new Date().toISOString());
  const clock = init.clock ?? Date.now;

  const emit = (event: EventInput): Case => {
    const full = validateEvent({ ...event, seq: current.seq + 1, at: now() });
    current = reduce(current, full);
    emitted.push(full);
    init.onEvent?.(full);
    return current;
  };

  const llm: LlmJob = async (params) => {
    const started = Date.now();
    // 默认绑 context deadline；调用方显式传的 deadlineMs 优先（compose 用轮次硬截止）。
    const bound = {
      ...params,
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.deadline !== undefined ? { deadlineMs: init.deadline } : {}),
      ...(params.deadlineMs !== undefined ? { deadlineMs: params.deadlineMs } : {}),
    };
    try {
      const result = await init.llm(bound);
      emit({
        type: "llm.called",
        job: params.job,
        model: result.model,
        latencyMs: result.latencyMs,
        ok: true,
        ...(result.attempts && result.attempts.length > 0 ? { attempts: result.attempts } : {}),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = attemptsOf(error);
      emit({
        type: "llm.called",
        job: params.job,
        model: "",
        latencyMs: Date.now() - started,
        ok: false,
        error: message.slice(0, 300),
        ...(attempts ? { attempts } : {}),
      });
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
    clock,
    signal: init.signal,
    deadline: init.deadline,
  };
}

function attemptsOf(error: unknown): JobAttempt[] | undefined {
  if (!error || typeof error !== "object" || !("attempts" in error)) return undefined;
  const value = (error as { attempts?: unknown }).attempts;
  return Array.isArray(value) && value.length > 0 ? (value as JobAttempt[]) : undefined;
}
