/**
 * reasoningTrace.ts — Agent 推理 trace 收集器 (PR-3)
 *
 * 单例 in-process event bus。零依赖,异步 dispatch,不入关键路径。
 * 参考 peer spec §1.3 + §4 (three-site insertion model)。
 */

export type TraceStatus = "queued" | "running" | "completed" | "failed";

export interface TraceStep {
  id: number;
  sessionId: string;
  agent: string;
  action: string;
  status: TraceStatus;
  timestamp: number;
  latencyMs?: number;
  meta?: Record<string, unknown>;
}

export type TraceHandler = (step: TraceStep) => void;

export interface TraceCollector {
  emit(step: Omit<TraceStep, "id" | "sessionId"> & { sessionId?: string }): void;
  subscribe(handler: TraceHandler): () => void;
  getSteps(sessionId?: string): TraceStep[];
  clear(sessionId: string): void;
  setSessionId(id: string): void;
  getSessionId(): string | null;
}

class InProcessTraceCollector implements TraceCollector {
  private steps: TraceStep[] = [];
  private handlers = new Set<TraceHandler>();
  private counter = 0;
  private currentSessionId: string | null = null;

  emit(
    step: Omit<TraceStep, "id" | "sessionId"> & { sessionId?: string },
  ): void {
    const sessionId =
      step.sessionId ?? this.currentSessionId ?? "default-session";
    this.counter += 1;
    const fullStep: TraceStep = {
      id: this.counter,
      sessionId,
      agent: step.agent,
      action: step.action,
      status: step.status,
      timestamp: step.timestamp,
      latencyMs: step.latencyMs,
      meta: step.meta,
    };
    this.steps.push(fullStep);
    // 异步 dispatch (microtask) — 不阻塞 emit 调用方
    queueMicrotask(() => {
      for (const handler of this.handlers) {
        try {
          handler(fullStep);
        } catch {
          // handler 抛错不影响 collector
        }
      }
    });
  }

  subscribe(handler: TraceHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  getSteps(sessionId?: string): TraceStep[] {
    if (!sessionId) return [...this.steps];
    return this.steps.filter((s) => s.sessionId === sessionId);
  }

  clear(sessionId: string): void {
    this.steps = this.steps.filter((s) => s.sessionId !== sessionId);
  }

  setSessionId(id: string): void {
    this.currentSessionId = id;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }
}

let _collector: TraceCollector | null = null;

export function getTraceCollector(): TraceCollector {
  if (!_collector) {
    _collector = new InProcessTraceCollector();
  }
  return _collector;
}

export function setTraceCollector(c: TraceCollector): void {
  _collector = c;
}

// 测试用 reset (避免污染)
export function resetTraceCollector(): void {
  _collector = null;
}