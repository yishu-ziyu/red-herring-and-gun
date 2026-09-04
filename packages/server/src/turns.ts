import { EventEmitter } from "node:events";
import { replay, runTurn, type Case, type CaseEvent, type RunTurnDeps } from "@rhg/core";
import type { CaseStore } from "./store.js";

export type TurnMessage = {
  text: string;
  attachments?: { kind: "url" | "image"; value: string }[];
  pivotId?: string;
};

export class ConflictError extends Error {
  constructor() {
    super("turn in progress");
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("not found");
    this.name = "NotFoundError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class TurnRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly starting = new Set<string>();
  // ponytail: 单进程 EventEmitter 总线；多实例升级路径是 Redis pub/sub。
  private readonly buses = new Map<string, EventEmitter>();

  constructor(
    private readonly store: CaseStore,
    private readonly deps: RunTurnDeps,
  ) {}

  isRunning(caseId: string): boolean {
    return this.jobs.has(caseId) || this.starting.has(caseId);
  }

  signal(caseId: string): AbortSignal | undefined {
    return this.controllers.get(caseId)?.signal;
  }

  subscribe(caseId: string, listener: (event: CaseEvent) => void): () => void {
    const bus = this.bus(caseId);
    bus.on("event", listener);
    return () => {
      bus.off("event", listener);
    };
  }

  async start(
    caseId: string,
    message: TurnMessage,
    depsOverride?: RunTurnDeps
  ): Promise<{ turnId: string }> {
    if (this.isRunning(caseId)) throw new ConflictError();
    this.starting.add(caseId);
    try {
      const loaded = await this.store.load(caseId);
      if (loaded === null) throw new NotFoundError();
      const current = replay(loaded);
      const turnId = `t${current.turns.length + 1}`;
      const ac = new AbortController();
      this.controllers.set(caseId, ac);
      const job = this.consume(caseId, current, message, ac.signal, depsOverride ?? this.deps);
      this.jobs.set(caseId, job);
      void job.finally(() => {
        this.jobs.delete(caseId);
        this.controllers.delete(caseId);
      });
      return { turnId };
    } finally {
      this.starting.delete(caseId);
    }
  }

  abort(caseId: string): void {
    this.controllers.get(caseId)?.abort();
  }

  async abortAll(): Promise<void> {
    for (const ac of this.controllers.values()) ac.abort();
    const pending = [...this.jobs.values()];
    if (pending.length === 0) return;
    await Promise.race([Promise.allSettled(pending), sleep(5_000)]);
  }

  async wait(caseId: string): Promise<void> {
    const job = this.jobs.get(caseId);
    if (job) await job;
  }

  private bus(caseId: string): EventEmitter {
    let emitter = this.buses.get(caseId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(0);
      this.buses.set(caseId, emitter);
    }
    return emitter;
  }

  private async consume(
    caseId: string,
    current: Case,
    message: TurnMessage,
    signal: AbortSignal,
    deps: RunTurnDeps,
  ): Promise<void> {
    const stream = runTurn({
      case: current,
      message: {
        text: message.text,
        ...(message.attachments ? { attachments: message.attachments } : {}),
        ...(message.pivotId ? { pivotId: message.pivotId } : {}),
      },
      deps,
      signal,
    });
    for await (const event of stream) {
      await this.store.append(caseId, [event]);
      this.bus(caseId).emit("event", event);
    }
  }
}
